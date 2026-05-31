import { Queue } from "bullmq";
import IORedis from "ioredis";

/**
 * Shared BullMQ wiring. Two responsibilities:
 *   1. `publishQueue` holds jobs to publish an approved+scheduled variant.
 *   2. A repeatable "morning review" job assembles the daily digest.
 *
 * The Redis connection is cached on globalThis to survive Next.js hot reloads.
 */
export const PUBLISH_QUEUE = "publish";
export const REVIEW_QUEUE = "morning-review";
export const METRICS_QUEUE = "metrics";

export interface PublishJobData {
  variantId: string;
}

export interface MetricsJobData {
  variantId: string;
}

const globalForQueue = globalThis as unknown as {
  redis?: IORedis;
  publishQueue?: Queue<PublishJobData>;
  metricsQueue?: Queue<MetricsJobData>;
};

export function getRedis(): IORedis {
  if (!globalForQueue.redis) {
    globalForQueue.redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      // Required by BullMQ.
      maxRetriesPerRequest: null,
    });
  }
  return globalForQueue.redis;
}

export function getPublishQueue(): Queue<PublishJobData> {
  if (!globalForQueue.publishQueue) {
    globalForQueue.publishQueue = new Queue<PublishJobData>(PUBLISH_QUEUE, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return globalForQueue.publishQueue;
}

export function getMetricsQueue(): Queue<MetricsJobData> {
  if (!globalForQueue.metricsQueue) {
    globalForQueue.metricsQueue = new Queue<MetricsJobData>(METRICS_QUEUE, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5 * 60_000 },
        removeOnComplete: 2000,
        removeOnFail: 1000,
      },
    });
  }
  return globalForQueue.metricsQueue;
}

/**
 * Enqueue a publish job at the variant's scheduled time. BullMQ's `delay` is
 * relative, so we compute the delay from now; past times publish immediately.
 */
export async function enqueuePublish(variantId: string, scheduledFor: Date): Promise<void> {
  const delay = Math.max(0, scheduledFor.getTime() - Date.now());
  await getPublishQueue().add(
    "publish-variant",
    { variantId },
    { delay, jobId: `publish:${variantId}` },
  );
}

/**
 * Enqueue a metrics-collection job after `delayMs`. A distinct jobId per delay
 * bucket lets us schedule several pulls (e.g. +1h, +24h) without collisions.
 */
export async function enqueueMetrics(variantId: string, delayMs: number): Promise<void> {
  await getMetricsQueue().add(
    "collect-metrics",
    { variantId },
    { delay: Math.max(0, delayMs), jobId: `metrics:${variantId}:${Math.round(delayMs)}` },
  );
}
