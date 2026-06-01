/**
 * In-process scheduler — the desktop build's replacement for Redis + BullMQ.
 *
 * The desktop app is a single Node process (the Next.js server embedded in
 * Electron), so durable cross-process queueing is unnecessary. Instead we:
 *
 *   1. arm an in-memory timer for each scheduled publish / metrics pull, and
 *   2. run a periodic "safety-net" poller that re-discovers anything due in the
 *      database — which makes the system resilient to process restarts, missed
 *      timers, and the 32-bit `setTimeout` ceiling (~24.8 days).
 *
 * Durability comes from the database itself (the canonical source of truth):
 * `scheduledFor` on a `scheduled` variant is the real schedule. On startup we
 * re-hydrate timers from it (see `hydrate`), and the poller catches the rest.
 *
 * The scheduler is intentionally free of app-specific imports: the publish /
 * metrics behaviour is injected via `registerHandlers` (see
 * src/server/runtime/publish.ts and src/instrumentation.ts), so there are no
 * import cycles between the scheduler and the domain services.
 */

/** Largest delay a single setTimeout can represent (2^31 - 1 ms). */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** How often the safety-net poller scans the DB for due work. */
const DEFAULT_POLL_INTERVAL_MS = 30_000;

export interface PublishContext {
  variantId: string;
  /** 1-based attempt counter; used to drive bounded retries with backoff. */
  attempt: number;
}

export interface MetricsContext {
  variantId: string;
}

export interface SchedulerHandlers {
  /** Publish a single scheduled variant. Throwing triggers a bounded retry. */
  onPublish: (ctx: PublishContext) => Promise<void>;
  /** Pull engagement metrics for a published variant. */
  onMetrics: (ctx: MetricsContext) => Promise<void>;
  /**
   * Re-discover due work from the database (the safety net). Should return the
   * set of variantIds it kicked off so the scheduler can avoid double-arming.
   */
  onPoll?: () => Promise<void>;
  /** Optional: assemble the daily "morning review" digest. */
  onMorningReview?: () => Promise<void>;
}

interface TimerEntry {
  timeout: ReturnType<typeof setTimeout>;
  /** Absolute fire time (epoch ms) so we can re-arm across the MAX_TIMEOUT ceiling. */
  fireAt: number;
}

/**
 * Schedule `fn` to run at an absolute time, transparently re-arming for delays
 * beyond the setTimeout ceiling. Returns a handle whose `.timeout` can be
 * cleared at any point.
 */
function setLongTimeout(fireAt: number, fn: () => void): TimerEntry {
  const entry = { fireAt } as TimerEntry;
  const arm = () => {
    const remaining = entry.fireAt - Date.now();
    if (remaining <= MAX_TIMEOUT_MS) {
      entry.timeout = setTimeout(fn, Math.max(0, remaining));
    } else {
      entry.timeout = setTimeout(arm, MAX_TIMEOUT_MS);
    }
    // Don't keep the event loop alive solely for a pending job.
    entry.timeout.unref?.();
  };
  arm();
  return entry;
}

export class InProcessScheduler {
  private handlers: SchedulerHandlers | null = null;
  private readonly timers = new Map<string, TimerEntry>();
  /** variantIds currently being published, so the poller never double-fires. */
  private readonly inFlight = new Set<string>();
  private poller: ReturnType<typeof setInterval> | null = null;
  private morningTimer: TimerEntry | null = null;
  private started = false;
  private readonly maxPublishAttempts: number;
  private readonly pollIntervalMs: number;

  constructor(opts: { maxPublishAttempts?: number; pollIntervalMs?: number } = {}) {
    this.maxPublishAttempts = opts.maxPublishAttempts ?? 3;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  registerHandlers(handlers: SchedulerHandlers): void {
    this.handlers = handlers;
  }

  /** Start the safety-net poller. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.poller = setInterval(() => {
      void this.runPoll();
    }, this.pollIntervalMs);
    this.poller.unref?.();
  }

  /** Stop all timers and the poller (used on shutdown / hot-reload). */
  stop(): void {
    for (const entry of this.timers.values()) clearTimeout(entry.timeout);
    this.timers.clear();
    if (this.morningTimer) clearTimeout(this.morningTimer.timeout);
    this.morningTimer = null;
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
    this.started = false;
  }

  private key(prefix: string, id: string, suffix?: string | number): string {
    return suffix === undefined ? `${prefix}:${id}` : `${prefix}:${id}:${suffix}`;
  }

  /**
   * Arm (or re-arm) a publish for a variant at `when`. A past time fires almost
   * immediately. Re-arming for the same variant replaces the previous timer.
   */
  enqueuePublish(variantId: string, when: Date, attempt = 1): void {
    const key = this.key("publish", variantId);
    this.clear(key);
    const entry = setLongTimeout(when.getTime(), () => {
      this.timers.delete(key);
      void this.firePublish(variantId, attempt);
    });
    this.timers.set(key, entry);
  }

  /** Arm a metrics pull `delayMs` from now. Distinct delays don't collide. */
  enqueueMetrics(variantId: string, delayMs: number): void {
    const bucket = Math.round(Math.max(0, delayMs));
    const key = this.key("metrics", variantId, bucket);
    this.clear(key);
    const entry = setLongTimeout(Date.now() + bucket, () => {
      this.timers.delete(key);
      void this.fireMetrics(variantId);
    });
    this.timers.set(key, entry);
  }

  private clear(key: string): void {
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing.timeout);
      this.timers.delete(key);
    }
  }

  /**
   * Run a publish through the registered handler with the in-flight guard and
   * bounded exponential-backoff retry. Public so the poller/hydration can reuse
   * the exact same path.
   */
  async firePublish(variantId: string, attempt = 1): Promise<void> {
    if (!this.handlers) return;
    if (this.inFlight.has(variantId)) return;
    this.inFlight.add(variantId);
    try {
      await this.handlers.onPublish({ variantId, attempt });
    } catch (err) {
      if (attempt < this.maxPublishAttempts) {
        // Exponential backoff: 60s, 120s, 240s, ... (matches the old BullMQ config).
        const backoff = 60_000 * 2 ** (attempt - 1);
        console.warn(
          `[scheduler] publish ${variantId} failed (attempt ${attempt}/${this.maxPublishAttempts}); ` +
            `retrying in ${Math.round(backoff / 1000)}s.`,
        );
        this.inFlight.delete(variantId);
        this.enqueuePublish(variantId, new Date(Date.now() + backoff), attempt + 1);
        return;
      }
      console.error(`[scheduler] publish ${variantId} exhausted retries:`, err);
    } finally {
      this.inFlight.delete(variantId);
    }
  }

  private async fireMetrics(variantId: string): Promise<void> {
    if (!this.handlers) return;
    try {
      await this.handlers.onMetrics({ variantId });
    } catch (err) {
      console.error(`[scheduler] metrics ${variantId} failed:`, err);
    }
  }

  private async runPoll(): Promise<void> {
    if (!this.handlers?.onPoll) return;
    try {
      await this.handlers.onPoll();
    } catch (err) {
      console.error("[scheduler] poll failed:", err);
    }
  }

  /** True while a variant's publish is executing (used by the poller/handlers). */
  isInFlight(variantId: string): boolean {
    return this.inFlight.has(variantId);
  }

  /**
   * Arm a self-rescheduling daily "morning review" at `nextRun`. The handler is
   * responsible for computing the following day's time and calling this again.
   */
  scheduleMorningReview(nextRun: Date, computeNext: (after: Date) => Date): void {
    if (!this.handlers?.onMorningReview) return;
    if (this.morningTimer) clearTimeout(this.morningTimer.timeout);
    this.morningTimer = setLongTimeout(nextRun.getTime(), () => {
      void (async () => {
        try {
          await this.handlers?.onMorningReview?.();
        } catch (err) {
          console.error("[scheduler] morning review failed:", err);
        } finally {
          this.scheduleMorningReview(computeNext(new Date()), computeNext);
        }
      })();
    });
  }
}

/**
 * Process-wide singleton, cached on globalThis so Next.js hot-reload (dev) and
 * server-action invocations all share the one scheduler instance.
 */
const globalForScheduler = globalThis as unknown as { scheduler?: InProcessScheduler };

export function getScheduler(): InProcessScheduler {
  if (!globalForScheduler.scheduler) {
    globalForScheduler.scheduler = new InProcessScheduler();
  }
  return globalForScheduler.scheduler;
}
