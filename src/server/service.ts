/**
 * Server-side domain service: the seam between the database and the
 * dependency-free core. API routes / server actions call these functions; they
 * never reach into Prisma or the core directly. Keeping the orchestration here
 * means the review/publish rules stay consistent everywhere.
 */
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getLLMProvider } from "@/lib/llm";
import { enqueuePublish } from "@/lib/queue";
import { generateVariants } from "@/core/content/generator";
import { applyReviewAction, type ReviewAction } from "@/core/review/queue";
import { planSchedule } from "@/core/schedule/planner";
import type { Brand, BrandVoice, Platform, PostStatus, PostVariant } from "@/core/types";
import { getPublisher } from "@/server/publishers";
import type { PostMetrics } from "@/server/publishers/publisher";
import { getValidAccessToken } from "@/server/tokens";
import { evaluateText } from "@/server/eval";
import type { EvalResult } from "@/core/eval/evaluator";
import { parseSlotHours, tzOffsetMinutes } from "@/server/time";

const DEMO_BRAND_ID = "brand_demo";

/** The single active, connected account for a (brand, platform), or null. */
async function getActiveAccountId(brandId: string, platform: Platform): Promise<string | null> {
  const account = await prisma.socialAccount.findFirst({
    where: { brandId, platform, isActive: true, accessToken: { not: null } },
    select: { id: true },
  });
  return account?.id ?? null;
}

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

  // Evaluate every variant against brand voice + recent history BEFORE it lands
  // in the queue. The result is persisted so reviewers see the score/issues and
  // so blocked content can be held back from autonomous publishing.
  const evaluated = await Promise.all(
    variants.map(async (v) => ({
      v,
      result: await evaluateText({
        brandId,
        platform: v.platform,
        voice: brand.voice,
        body: v.body,
        hashtags: v.hashtags,
      }),
    })),
  );

  const post = await prisma.post.create({
    data: {
      brandId,
      topic: input.topic,
      instruction: input.instruction,
      llmProvider: provider.name,
      llmModel: provider.model,
      variants: {
        create: evaluated.map(({ v, result }) => ({
          platform: v.platform,
          status: v.status,
          body: v.body,
          hashtags: v.hashtags,
          validationNote: v.error,
          evalScore: result.score,
          evalIssues: result as unknown as Prisma.InputJsonValue,
          events: {
            create: {
              type: "generated",
              detail: { provider: provider.name, evalScore: result.score, blocked: result.blocked },
            },
          },
        })),
      },
    },
    include: { variants: true },
  });

  // Which platforms produced eval-blocked content (must not auto-publish).
  const blockedByPlatform = new Map(evaluated.map((e) => [e.v.platform, e.result.blocked]));

  // Auto channels (account autonomy = "auto") skip the morning review: their
  // variants are approved and scheduled immediately. Channels without a
  // connected account, or set to manual/review_required, stay in pending_review.
  // Eval-blocked variants are ALWAYS held for human review, even on auto.
  const autoPlatforms = await getAutoPlatforms(brandId);
  const approvedCore: PostVariant[] = [];
  for (const v of post.variants) {
    if (!autoPlatforms.has(v.platform)) continue;
    if (blockedByPlatform.get(v.platform)) {
      await prisma.variantEvent.create({
        data: {
          variantId: v.id,
          type: "held_for_review",
          actor: "autopilot",
          detail: { reason: "eval_blocked" },
        },
      });
      continue;
    }
    await prisma.variant.update({ where: { id: v.id }, data: { status: "approved" } });
    await prisma.variantEvent.create({
      data: { variantId: v.id, type: "approved", actor: "autopilot" },
    });
    approvedCore.push({ ...toCoreVariant(v), status: "approved" });
  }
  if (approvedCore.length > 0) {
    await scheduleCoreVariants(approvedCore, brandId, "autopilot");
  }

  return { postId: post.id, count: post.variants.length };
}

/** Platforms whose active account is set to fully-autonomous posting. */
async function getAutoPlatforms(brandId: string): Promise<Set<Platform>> {
  const accounts = await prisma.socialAccount.findMany({
    where: { brandId, isActive: true, autonomy: "auto" },
    select: { platform: true },
  });
  return new Set(accounts.map((a) => a.platform));
}

/**
 * Schedule a set of already-approved variants across the configured daily slots,
 * linking each to its platform's active account and enqueuing the publish job.
 * Shared by the manual "schedule all approved" action and the autonomy path.
 */
async function scheduleCoreVariants(
  approved: PostVariant[],
  brandId: string,
  actor: string,
): Promise<{ scheduled: number; unscheduled: number }> {
  const now = new Date();
  const tz = process.env.REVIEW_TIMEZONE ?? "Europe/Oslo";
  const plan = planSchedule(approved, {
    slotHours: parseSlotHours(process.env.POSTING_SLOT_HOURS, [9, 13, 17]),
    tzOffsetMinutes: tzOffsetMinutes(tz, now),
    now,
    horizonDays: 7,
  });

  const accountCache = new Map<Platform, string | null>();
  let scheduled = 0;
  for (const v of plan.scheduled) {
    if (v.status !== "scheduled" || !v.scheduledFor) continue;
    if (!accountCache.has(v.platform)) {
      accountCache.set(v.platform, await getActiveAccountId(brandId, v.platform));
    }
    await prisma.variant.update({
      where: { id: v.id },
      data: {
        status: "scheduled",
        scheduledFor: new Date(v.scheduledFor),
        socialAccountId: accountCache.get(v.platform) ?? null,
      },
    });
    await prisma.variantEvent.create({
      data: { variantId: v.id, type: "scheduled", actor, detail: { scheduledFor: v.scheduledFor } },
    });
    await enqueuePublish(v.id, new Date(v.scheduledFor));
    scheduled += 1;
  }
  return { scheduled, unscheduled: plan.unscheduled.length };
}

export interface ReviewQueueItem {
  id: string;
  platform: Platform;
  status: PostStatus;
  body: string;
  hashtags: string[];
  mediaUrls: string[];
  validationNote: string | null;
  scheduledFor: string | null;
  topic: string;
  createdAt: string;
  accountConnected: boolean;
  metrics: PostMetrics | null;
  evalScore: number | null;
  eval: EvalResult | null;
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
    mediaUrls: v.mediaUrls,
    validationNote: v.validationNote,
    scheduledFor: v.scheduledFor ? v.scheduledFor.toISOString() : null,
    topic: v.post.topic,
    createdAt: v.createdAt.toISOString(),
    accountConnected: Boolean(v.socialAccount?.accessToken),
    metrics: (v.metrics as unknown as PostMetrics | null) ?? null,
    evalScore: v.evalScore ?? null,
    eval: (v.evalIssues as unknown as EvalResult | null) ?? null,
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

  // Editing the copy invalidates the previous eval; re-score against history.
  if (action.type === "edit") {
    await reevaluateVariant(variantId);
  }

  return toCoreVariant(updated);
}

/**
 * Re-run the eval tool for a single variant and persist the result. Used after
 * an edit and by the manual "re-check" action. Returns the result (or null if
 * the brand voice can't be loaded).
 */
export async function reevaluateVariant(variantId: string): Promise<EvalResult | null> {
  const row = await prisma.variant.findUniqueOrThrow({
    where: { id: variantId },
    include: { post: { include: { brand: true } } },
  });
  const voice = row.post.brand.voice as unknown as BrandVoice;

  const result = await evaluateText({
    brandId: row.post.brandId,
    platform: row.platform,
    voice,
    body: row.body,
    hashtags: row.hashtags,
    excludeVariantId: variantId,
  });

  await prisma.variant.update({
    where: { id: variantId },
    data: {
      evalScore: result.score,
      evalIssues: result as unknown as Prisma.InputJsonValue,
    },
  });
  return result;
}

/**
 * Attach (or clear) media URLs on a variant. Instagram requires at least one
 * image/video; this is how a reviewer satisfies that before approving. Basic
 * http(s) validation only — hosting/upload is out of scope for now.
 */
export async function setMedia(variantId: string, urls: string[]): Promise<void> {
  const cleaned = urls
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\/\S+$/i.test(u));

  await prisma.variant.update({
    where: { id: variantId },
    data: { mediaUrls: cleaned },
  });
  await prisma.variantEvent.create({
    data: { variantId, type: "media_set", actor: "reviewer", detail: { count: cleaned.length } },
  });
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
    data: {
      status: scheduled.status,
      scheduledFor: when,
      socialAccountId: await getActiveAccountId(DEMO_BRAND_ID, row.platform),
    },
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
  return scheduleCoreVariants(rows.map(toCoreVariant), brandId, "reviewer");
}

/**
 * Fetch and persist engagement metrics for a published variant. Stores the
 * latest snapshot on the variant and appends to its metric history. No-ops
 * gracefully when the variant isn't published, has no account, or the platform
 * doesn't support metrics.
 */
export async function collectMetrics(variantId: string): Promise<PostMetrics | null> {
  const variant = await prisma.variant.findUnique({
    where: { id: variantId },
    include: { socialAccount: true },
  });
  if (!variant || variant.status !== "published" || !variant.externalId) return null;
  if (!variant.socialAccount?.accessToken) return null;

  const publisher = getPublisher(variant.platform);
  if (!publisher.fetchMetrics) return null;

  const accessToken = await getValidAccessToken(variant.socialAccount);
  const metrics = await publisher.fetchMetrics({
    accessToken,
    accountExternalId: variant.socialAccount.externalId,
    postExternalId: variant.externalId,
    metadata: (variant.socialAccount.metadata as Record<string, unknown>) ?? undefined,
  });

  await prisma.variant.update({
    where: { id: variantId },
    data: {
      metrics: metrics as unknown as Prisma.InputJsonValue,
      metricsUpdatedAt: new Date(metrics.fetchedAt),
    },
  });
  await prisma.variantMetricSnapshot.create({
    data: { variantId, data: metrics as unknown as Prisma.InputJsonValue },
  });

  return metrics;
}
