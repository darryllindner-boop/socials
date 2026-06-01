/**
 * Boot the in-process scheduler: register the publish/metrics handlers, start
 * the safety-net poller, arm the daily morning-review timer, and re-hydrate
 * scheduled publishes from the database.
 *
 * Called from:
 *   * src/instrumentation.ts  — when the Next.js server starts (desktop default);
 *   * src/worker/index.ts     — when running the scheduler as a separate process
 *                               (server deployments with RUN_INPROCESS_SCHEDULER=0).
 *
 * Guarded so it only ever boots once per process (survives Next dev hot-reload).
 */
import { getScheduler } from "@/lib/scheduler";
import { nextReviewWindow } from "@/core/schedule/planner";
import { tzOffsetMinutes } from "@/server/time";
import {
  collectMetricsJob,
  hydrateSchedules,
  pollDueWork,
  publishVariant,
  runMorningReview,
} from "@/server/runtime/publish";

const globalForBoot = globalThis as unknown as { schedulerBooted?: boolean };

export async function bootScheduler(): Promise<void> {
  if (globalForBoot.schedulerBooted) return;
  globalForBoot.schedulerBooted = true;

  const scheduler = getScheduler();
  scheduler.registerHandlers({
    onPublish: publishVariant,
    onMetrics: collectMetricsJob,
    onPoll: pollDueWork,
    onMorningReview: runMorningReview,
  });
  scheduler.start();

  // Daily "morning review" digest at REVIEW_HOUR (brand-local), self-rescheduling.
  const tz = process.env.REVIEW_TIMEZONE ?? "Europe/Oslo";
  const parsedHour = Number(process.env.REVIEW_HOUR ?? "7");
  const reviewHour = Number.isFinite(parsedHour) ? parsedHour : 7;
  const computeNext = (after: Date) =>
    nextReviewWindow(after, reviewHour, tzOffsetMinutes(tz, after));
  scheduler.scheduleMorningReview(computeNext(new Date()), computeNext);

  // Re-arm timers for anything already scheduled (handlers/poller are ready now).
  await hydrateSchedules();

  console.log("[scheduler] in-process scheduler started (publish + metrics + morning review).");
}
