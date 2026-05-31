/**
 * Background worker. Run with: npm run worker
 *
 * Responsibilities:
 *   1. publish queue  -> publish an approved+scheduled variant at its time.
 *   2. review queue   -> assemble the daily "morning review" digest (logs the
 *      count of pending variants; hook email/Slack here later).
 *
 * Publishing is intentionally defensive: it re-checks the variant is still in a
 * publishable state, refuses to publish without a connected account, and writes
 * an audit event for every outcome.
 */
import { Worker, type Job } from "bullmq";
import { prisma } from "@/lib/db";
import { getRedis, PUBLISH_QUEUE, REVIEW_QUEUE, type PublishJobData } from "@/lib/queue";
import { getPublisher } from "@/server/publishers";
import { getValidAccessToken } from "@/server/tokens";

const connection = getRedis();

const publishWorker = new Worker<PublishJobData>(
  PUBLISH_QUEUE,
  async (job: Job<PublishJobData>) => {
    const { variantId } = job.data;
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
    const accessToken = await getValidAccessToken(account);
    const publisher = getPublisher(variant.platform);

    try {
      const result = await publisher.publish({
        body: variant.body,
        hashtags: variant.hashtags,
        accessToken,
        externalId: account.externalId,
        metadata: (account.metadata as Record<string, unknown>) ?? undefined,
        mediaUrls: variant.mediaUrls,
      });

      if (result.ok) {
        await prisma.variant.update({
          where: { id: variantId },
          data: { status: "published", externalId: result.externalId, publishedAt: new Date(), error: null },
        });
        await event(variantId, "published", { externalId: result.externalId });
        console.log(`[publish] ${variant.platform} variant ${variantId} published (${result.externalId ?? "n/a"}).`);
      } else {
        // notConfigured failures are terminal (don't retry); transient ones throw to retry.
        if (result.notConfigured) {
          await fail(variantId, result.error ?? "Not configured.");
        } else {
          throw new Error(result.error ?? "Publish failed.");
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Let BullMQ retry; only mark failed on the final attempt.
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await fail(variantId, message);
      }
      throw err;
    }
  },
  { connection, concurrency: 4 },
);

const reviewWorker = new Worker(
  REVIEW_QUEUE,
  async () => {
    const pending = await prisma.variant.count({ where: { status: "pending_review" } });
    console.log(`[review] Morning digest: ${pending} variant(s) awaiting your review.`);
    // TODO: send email/Slack notification with a link to the review dashboard.
  },
  { connection },
);

async function fail(variantId: string, message: string): Promise<void> {
  await prisma.variant.update({
    where: { id: variantId },
    data: { status: "failed", error: message },
  });
  await event(variantId, "failed", { error: message });
  console.error(`[publish] variant ${variantId} failed: ${message}`);
}

async function event(variantId: string, type: string, detail?: Record<string, unknown>): Promise<void> {
  await prisma.variantEvent.create({ data: { variantId, type, detail: detail ?? undefined } });
}

console.log("Worker started. Listening on queues:", PUBLISH_QUEUE, REVIEW_QUEUE);

async function shutdown(): Promise<void> {
  console.log("Shutting down worker…");
  await Promise.allSettled([publishWorker.close(), reviewWorker.close()]);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
