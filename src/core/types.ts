/**
 * Shared domain types for Social Autopilot.
 *
 * This module is intentionally dependency-free so it can be imported by both
 * the Next.js app (client + server) and the BullMQ worker, and so the core
 * business logic can be type-checked and executed without installing any
 * third-party packages.
 */

/** Social platforms supported in Phase 0. */
export const PLATFORMS = ["linkedin", "facebook", "x", "instagram"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  x: "X",
  instagram: "Instagram",
};

/**
 * Lifecycle of a single post variant.
 *
 *   draft ──▶ pending_review ──▶ approved ──▶ scheduled ──▶ publishing ──▶ published
 *                   │                                            │
 *                   └────────▶ rejected                          └────────▶ failed
 *
 * The "review-before-publish every morning" workflow means nothing ever moves
 * past `pending_review` without an explicit human action.
 */
export const POST_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "rejected",
  "failed",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** How much autonomy a channel is granted. Phase 0 defaults everything to review_required. */
export const AUTONOMY_LEVELS = ["manual", "review_required", "auto"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/** A brand whose social presence we manage (internal tool: usually just yours). */
export interface Brand {
  id: string;
  name: string;
  voice: BrandVoice;
  /** Free-text knowledge snippets used as a lightweight RAG corpus. */
  assets: BrandAsset[];
}

/** Structured brand-voice definition that drives the system prompt. */
export interface BrandVoice {
  /** Short description of the brand and what it does. */
  description: string;
  /** Adjectives describing tone, e.g. ["friendly", "expert", "concise"]. */
  toneAdjectives: string[];
  /** Primary audience, e.g. "indie founders and small marketing teams". */
  audience: string;
  /** Recurring content themes / pillars. */
  contentPillars: string[];
  /** Hard rules the model must always follow. */
  dos: string[];
  /** Hard rules the model must never violate. */
  donts: string[];
  /** Optional emoji policy. */
  emojiUsage: "none" | "sparing" | "liberal";
  /** Default call-to-action style, e.g. "invite a reply" or "link in comments". */
  ctaStyle?: string;
}

export interface BrandAsset {
  id: string;
  title: string;
  /** Raw text content (product notes, past high-performing posts, FAQs, etc.). */
  content: string;
  /** Optional tags for retrieval. */
  tags?: string[];
}

/** A generated piece of content for a single platform, awaiting/through review. */
export interface PostVariant {
  id: string;
  platform: Platform;
  status: PostStatus;
  body: string;
  hashtags: string[];
  /** When the publisher should post it (ISO 8601). Set at scheduling time. */
  scheduledFor?: string;
  /** Populated after a successful publish. */
  externalId?: string;
  /** Populated on failure. */
  error?: string;
}

/** Input describing what to generate. */
export interface GenerationRequest {
  brand: Brand;
  /** Topic or angle for the post. */
  topic: string;
  /** Which platforms to produce variants for. */
  platforms: Platform[];
  /** Optional extra instruction for this specific batch. */
  instruction?: string;
  /** Optional seed for deterministic output (used by the mock provider/tests). */
  seed?: number;
}
