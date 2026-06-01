/**
 * Queue compatibility shim.
 *
 * The desktop build replaced Redis + BullMQ with an in-process scheduler (see
 * src/lib/scheduler.ts). This module preserves the original `enqueuePublish` /
 * `enqueueMetrics` API so the domain service layer (src/server/service.ts) did
 * not have to change — it still "enqueues" work; that work is now handled by an
 * in-memory timer plus a database-backed safety-net poller in the same process.
 */
import { getScheduler } from "@/lib/scheduler";

export interface PublishJobData {
  variantId: string;
}

export interface MetricsJobData {
  variantId: string;
}

/**
 * Schedule a publish at the variant's scheduled time. Past times publish almost
 * immediately. The work runs in-process; durability is provided by the DB
 * (`scheduledFor`) plus the scheduler's poller, not by Redis.
 */
export async function enqueuePublish(variantId: string, scheduledFor: Date): Promise<void> {
  getScheduler().enqueuePublish(variantId, scheduledFor);
}

/** Schedule a metrics-collection pull `delayMs` from now. */
export async function enqueueMetrics(variantId: string, delayMs: number): Promise<void> {
  getScheduler().enqueueMetrics(variantId, delayMs);
}
