/**
 * Server-side eval integration: pulls the recent post history a variant should
 * be compared against (for repetition) and runs the dependency-free evaluator.
 * The service layer calls these to score variants at generation/edit time and
 * to gate autonomous publishing.
 */
import { prisma } from "@/lib/db";
import { evaluateVariant, type EvalResult } from "@/core/eval/evaluator";
import type { BrandVoice, Platform } from "@/core/types";

const PRIOR_LIMIT = 50;

/**
 * Recent post bodies for a brand+platform, used as the repetition corpus. Only
 * content that was approved or beyond counts (drafts/rejected don't represent
 * what the brand actually says).
 */
export async function loadPriorTexts(
  brandId: string,
  platform: Platform,
  excludeVariantId?: string,
): Promise<string[]> {
  const rows = await prisma.variant.findMany({
    where: {
      platform,
      post: { brandId },
      status: { in: ["approved", "scheduled", "publishing", "published"] },
      ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: PRIOR_LIMIT,
    select: { body: true },
  });
  return rows.map((r) => r.body);
}

/** Evaluate a piece of content against brand voice + recent history. */
export async function evaluateText(args: {
  brandId: string;
  platform: Platform;
  voice: BrandVoice;
  body: string;
  hashtags: string[];
  excludeVariantId?: string;
}): Promise<EvalResult> {
  const priorTexts = await loadPriorTexts(args.brandId, args.platform, args.excludeVariantId);
  return evaluateVariant({
    platform: args.platform,
    body: args.body,
    hashtags: args.hashtags,
    voice: args.voice,
    priorTexts,
  });
}
