/**
 * Runtime job handlers for the in-process scheduler (desktop build).
 *
 * This is the logic that used to live in the BullMQ worker (src/worker), now
 * expressed as plain async functions the scheduler invokes:
 *
 *   * publishVariant   — publish one approved+scheduled variant at its time.
 *   * collectMetricsJob— pull engagement metrics for a published variant.
 *   * pollDueWork      — safety-net: re-discover due publishes from the DB.
 *   * hydrateSchedules — on startup, re-arm timers from `scheduled` variants.
 *   * runMorningReview — assemble the daily review digest (logs the count).
 *
 * Publishing stays defensive: it re-checks the variant is still publishable,
 * refuses to publish without a connected account, writes an audit event for
 * every outcome, and leaves bounded retry/backoff to the scheduler.
 */
import { prisma } from "@/lib/db";
import { getScheduler, type MetricsContext, type PublishContext } from "@/lib/scheduler";
import { enqueueMetrics } from "@/lib/queue";
import { getPublisher } from "@/server/publishers";
import { getValidAccessToken } from "@/server/tokens";
import { collectMetrics } from "@/server/service";
import { asPlatform, unpackList } from "@/lib/serialize";

/** Pull metrics at these offsets after publishing (early signal + settled view). */
const METRIC_PULL_OFFSETS_MS = [60 * 60_000, 24 * 60 * 60_000];

/** Must match the scheduler's maxPublishAttempts so terminal failures are recorded. */
export const MAX_PUBLISH_ATTEMPTS = 3;

/**
 * Publish a single scheduled variant. Throws on a retryable failure (the
 * scheduler applies exponential backoff); records a terminal "failed" state on
 * the final attempt or for non-retryable (misconfiguration) errors.
 */
export async function publishVariant({ variantId, attempt }: PublishContext): Promise<void> {
  const variant = await prisma.variant.findUnique({
    where: { id: variantId },
    include: { socialAccount: true },
  });

  if (!variant) {
    console.warn(`[publish] variant ${variantId} not found; skipping.`);
    return;
  }
  if (variant.status !== "scheduled") {
    console.warn(`[publish] variant ${variantId} is ${variant.status}, not scheduled; skipping.`);
    return;
  }
  if (!variant.socialAccount) {
    await fail(variantId, "No connected social account for this variant.");
    return;
  }
  if (!variant.socialAccount.accessToken) {
    await fail(variantId, `${variant.platform} account is not connected (no token).`);
    return;
  }

  await prisma.variant.update({ where: { id: variantId }, data: { status: "publishing" } });
  await event(variantId, "publishing");

  const account = variant.socialAccount;
  const platform = asPlatform(variant.platform);
  const accessToken = await getValidAccessToken({
    id: account.id,
    platform: asPlatform(account.platform),
    accessToken: account.accessToken,
    refreshToken: account.refreshToken,
    tokenExpiresAt: account.tokenExpiresAt,
  });
  const publisher = getPublisher(platform);

  try {
    const result = await publisher.publish({
      body: variant.body,
      hashtags: unpackList(variant.hashtags),
      accessToken,
      externalId: account.externalId,
      metadata: (account.metadata as Record<string, unknown>) ?? undefined,
      mediaUrls: unpackList(variant.mediaUrls),
    });

    if (result.ok) {
      await prisma.variant.update({
        where: { id: variantId },
        data: {
          status: "published",
          externalId: result.externalId,
          publishedAt: new Date(),
          error: null,
        },
      });
      await event(variantId, "published", { externalId: result.externalId });
      console.log(
        `[publish] ${platform} variant ${variantId} published (${result.externalId ?? "n/a"}).`,
      );
      // Close the loop: schedule analytics pull-backs at a few offsets.
      for (const offset of METRIC_PULL_OFFSETS_MS) {
        await enqueueMetrics(variantId, offset);
      }
      return;
    }

    // notConfigured failures are terminal (don't retry); transient ones throw to retry.
    if (result.notConfigured) {
      await fail(variantId, result.error ?? "Not configured.");
      return;
    }
    throw new Error(result.error ?? "Publish failed.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (attempt >= MAX_PUBLISH_ATTEMPTS) {
      await fail(variantId, message);
    } else {
      // Roll back to "scheduled" so the scheduler's retry can re-publish it.
      await prisma.variant.update({ where: { id: variantId }, data: { status: "scheduled" } });
    }
    throw err;
  }
}

/** Pull + persist engagement metrics for a published variant. */
export async function collectMetricsJob({ variantId }: MetricsContext): Promise<void> {
  const metrics = await collectMetrics(variantId);
  if (metrics) {
    console.log(
      `[metrics] ${variantId}: ${metrics.likes ?? 0} likes, ${metrics.comments ?? 0} comments`,
    );
  }
}

/**
 * Safety-net poll: publish anything that is due but whose in-memory timer was
 * lost (process restart, missed timer, far-future re-arm). Idempotent — the
 * scheduler's in-flight guard and the `status === "scheduled"` check prevent
 * double publishing.
 */
export async function pollDueWork(): Promise<void> {
  const scheduler = getScheduler();
  const due = await prisma.variant.findMany({
    where: { status: "scheduled", scheduledFor: { lte: new Date(Date.now() + 5_000) } },
    select: { id: true },
    take: 200,
  });
  for (const v of due) {
    if (!scheduler.isInFlight(v.id)) {
      void scheduler.firePublish(v.id, 1);
    }
  }
}

/** On startup, re-arm in-memory timers for every still-scheduled variant. */
export async function hydrateSchedules(): Promise<void> {
  const scheduler = getScheduler();
  const scheduled = await prisma.variant.findMany({
    where: { status: "scheduled", scheduledFor: { not: null } },
    select: { id: true, scheduledFor: true },
  });
  for (const v of scheduled) {
    if (v.scheduledFor) scheduler.enqueuePublish(v.id, v.scheduledFor);
  }
  console.log(
    `[scheduler] hydrated ${scheduled.length} scheduled publish(es) from the database.`,
  );
}

/** Assemble the daily "morning review" digest (hook email/Slack here later). */
export async function runMorningReview(): Promise<void> {
  const pending = await prisma.variant.count({ where: { status: "pending_review" } });
  console.log(`[review] Morning digest: ${pending} variant(s) awaiting your review.`);
}

async function fail(variantId: string, message: string): Promise<void> {
  await prisma.variant.update({
    where: { id: variantId },
    data: { status: "failed", error: message },
  });
  await event(variantId, "failed", { error: message });
  console.error(`[publish] variant ${variantId} failed: ${message}`);
}

async function event(
  variantId: string,
  type: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await prisma.variantEvent.create({ data: { variantId, type, detail: detail ?? undefined } });
}
