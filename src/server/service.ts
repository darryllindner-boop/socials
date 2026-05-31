/**
 * Server-side domain service: the seam between the database and the
 * dependency-free core. API routes / server actions call these functions; they
 * never reach into Prisma or the core directly. Keeping the orchestration here
 * means the review/publish rules stay consistent everywhere.
 */
import { prisma } from "@/lib/db";
import { getLLMProvider } from "@/lib/llm";
import { enqueuePublish } from "@/lib/queue";
import { generateVariants } from "@/core/content/generator";
import { applyReviewAction, type ReviewAction } from "@/core/review/queue";
import { planSchedule } from "@/core/schedule/planner";
import type { Brand, BrandVoice, Platform, PostStatus, PostVariant } from "@/core/types";
import { parseSlotHours, tzOffsetMinutes } from "@/server/time";

const DEMO_BRAND_ID = "brand_demo";

/** Load a brand into the core's domain shape (voice JSON -> typed BrandVoice). */
async function loadDomainBrand(brandId: string): Promise<Brand> {
  const brand = await prisma.brand.findUniqueOrThrow({
    where: { id: brandId },
    include: { assets: true },
  });
  return {
    id: brand.id,
    name: brand.name,
    voice: brand.voice as unknown as BrandVoice,
    assets: brand.assets.map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      tags: a.tags,
    })),
  };
}

/** Generate a batch of drafts for a topic and persist them in pending_review. */
export async function generateBatch(input: {
  brandId?: string;
  topic: string;
  platforms: Platform[];
  instruction?: string;
}): Promise<{ postId: string; count: number }> {
  const brandId = input.brandId ?? DEMO_BRAND_ID;
  const brand = await loadDomainBrand(brandId);
  const provider = getLLMProvider();

  const variants = await generateVariants(provider, {
    brand,
    topic: input.topic,
    platforms: input.platforms,
    instruction: input.instruction,
  });

  const post = await prisma.post.create({
    data: {
      brandId,
      topic: input.topic,
      instruction: input.instruction,
      llmProvider: provider.name,
      llmModel: provider.model,
      variants: {
        create: variants.map((v) => ({
          platform: v.platform,
          status: v.status,
          body: v.body,
          hashtags: v.hashtags,
          validationNote: v.error,
          events: { create: { type: "generated", detail: { provider: provider.name } } },
        })),
      },
    },
    include: { variants: true },
  });

  return { postId: post.id, count: post.variants.length };
}

export interface ReviewQueueItem {
  id: string;
  platform: Platform;
  status: PostStatus;
  body: string;
  hashtags: string[];
  validationNote: string | null;
  scheduledFor: string | null;
  topic: string;
  createdAt: string;
  accountConnected: boolean;
}

/** Load everything the morning review dashboard needs, grouped by status. */
export async function getReviewQueue(brandId: string = DEMO_BRAND_ID): Promise<{
  pending: ReviewQueueItem[];
  approved: ReviewQueueItem[];
  scheduled: ReviewQueueItem[];
  recent: ReviewQueueItem[];
}> {
  const variants = await prisma.variant.findMany({
    where: { post: { brandId } },
    include: { post: true, socialAccount: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const map = (v: (typeof variants)[number]): ReviewQueueItem => ({
    id: v.id,
    platform: v.platform,
    status: v.status,
    body: v.body,
    hashtags: v.hashtags,
    validationNote: v.validationNote,
    scheduledFor: v.scheduledFor ? v.scheduledFor.toISOString() : null,
    topic: v.post.topic,
    createdAt: v.createdAt.toISOString(),
    accountConnected: Boolean(v.socialAccount?.accessToken),
  });

  const pending: ReviewQueueItem[] = [];
  const approved: ReviewQueueItem[] = [];
  const scheduled: ReviewQueueItem[] = [];
  const recent: ReviewQueueItem[] = [];

  for (const v of variants) {
    const item = map(v);
    if (v.status === "pending_review" || v.status === "draft") pending.push(item);
    else if (v.status === "approved") approved.push(item);
    else if (v.status === "scheduled" || v.status === "publishing") scheduled.push(item);
    else recent.push(item);
  }

  return { pending, approved, scheduled, recent: recent.slice(0, 20) };
}

/** Build the core PostVariant view of a DB row so we can reuse the state machine. */
function toCoreVariant(row: {
  id: string;
  platform: Platform;
  status: PostStatus;
  body: string;
  hashtags: string[];
  scheduledFor: Date | null;
}): PostVariant {
  return {
    id: row.id,
    platform: row.platform,
    status: row.status,
    body: row.body,
    hashtags: row.hashtags,
    scheduledFor: row.scheduledFor?.toISOString(),
  };
}

/**
 * Apply a reviewer action to a single variant, enforcing the core state machine
 * and recording an audit event. Scheduling immediately enqueues the publish job.
 */
export async function applyAction(
  variantId: string,
  action: ReviewAction,
  actor = "reviewer",
): Promise<PostVariant> {
  const row = await prisma.variant.findUniqueOrThrow({ where: { id: variantId } });
  const next = applyReviewAction(toCoreVariant(row), action);

  const updated = await prisma.variant.update({
    where: { id: variantId },
    data: {
      status: next.status,
      body: next.body,
      hashtags: next.hashtags,
      scheduledFor: next.scheduledFor ? new Date(next.scheduledFor) : row.scheduledFor,
      validationNote: action.type === "edit" ? null : row.validationNote,
    },
  });

  await prisma.variantEvent.create({
    data: {
      variantId,
      type: action.type === "edit" ? "edited" : next.status,
      actor,
      detail: action.scheduledFor ? { scheduledFor: action.scheduledFor } : undefined,
    },
  });

  if (next.status === "scheduled" && next.scheduledFor) {
    await enqueuePublish(variantId, new Date(next.scheduledFor));
  }

  return toCoreVariant(updated);
}

/**
 * Approve-if-needed, then schedule a single variant for a specific time. This
 * is the one-click "approve and schedule from the morning queue" path: it walks
 * the state machine pending_review -> approved -> scheduled so the transition
 * rules are still honoured.
 */
export async function scheduleVariant(variantId: string, when: Date): Promise<void> {
  const row = await prisma.variant.findUniqueOrThrow({ where: { id: variantId } });
  let current = toCoreVariant(row);

  if (current.status === "pending_review" || current.status === "draft") {
    current = applyReviewAction(current, { type: "approve" });
  }
  const scheduled = applyReviewAction(current, {
    type: "schedule",
    scheduledFor: when.toISOString(),
  });

  await prisma.variant.update({
    where: { id: variantId },
    data: { status: scheduled.status, scheduledFor: when },
  });
  await prisma.variantEvent.create({
    data: {
      variantId,
      type: "scheduled",
      actor: "reviewer",
      detail: { scheduledFor: scheduled.scheduledFor },
    },
  });
  await enqueuePublish(variantId, when);
}

/**
 * Schedule every approved variant for a brand across the configured daily slots
 * (the "approve in the morning, drip through the day" action). Returns how many
 * were scheduled and how many overflowed the horizon.
 */
export async function scheduleApproved(brandId: string = DEMO_BRAND_ID): Promise<{
  scheduled: number;
  unscheduled: number;
}> {
  const rows = await prisma.variant.findMany({
    where: { post: { brandId }, status: "approved" },
    orderBy: { createdAt: "asc" },
  });

  const now = new Date();
  const tz = process.env.REVIEW_TIMEZONE ?? "Europe/Oslo";
  const plan = planSchedule(rows.map(toCoreVariant), {
    slotHours: parseSlotHours(process.env.POSTING_SLOT_HOURS, [9, 13, 17]),
    tzOffsetMinutes: tzOffsetMinutes(tz, now),
    now,
    horizonDays: 7,
  });

  let scheduled = 0;
  for (const v of plan.scheduled) {
    if (v.status === "scheduled" && v.scheduledFor) {
      await prisma.variant.update({
        where: { id: v.id },
        data: { status: "scheduled", scheduledFor: new Date(v.scheduledFor) },
      });
      await prisma.variantEvent.create({
        data: { variantId: v.id, type: "scheduled", actor: "reviewer", detail: { scheduledFor: v.scheduledFor } },
      });
      await enqueuePublish(v.id, new Date(v.scheduledFor));
      scheduled += 1;
    }
  }

  return { scheduled, unscheduled: plan.unscheduled.length };
}
