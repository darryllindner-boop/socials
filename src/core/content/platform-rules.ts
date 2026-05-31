import type { Platform } from "../types";

/**
 * Per-platform authoring constraints. These are used in two places:
 *   1. To instruct the LLM how to format each variant.
 *   2. To validate/repair generated output before it enters the review queue.
 *
 * Limits are deliberately conservative; tune as platform APIs evolve.
 */
export interface PlatformRule {
  /** Hard maximum body length the platform accepts. */
  maxLength: number;
  /** Length we aim for to keep posts punchy (<= maxLength). */
  targetLength: number;
  /** Suggested number of hashtags. */
  recommendedHashtags: number;
  /** Hard cap on hashtags before it looks spammy / gets penalised. */
  maxHashtags: number;
  /** Whether the platform supports rich line breaks / paragraphs well. */
  supportsLineBreaks: boolean;
  /** Short formatting guidance injected into the prompt. */
  styleHint: string;
}

export const PLATFORM_RULES: Record<Platform, PlatformRule> = {
  linkedin: {
    maxLength: 3000,
    targetLength: 1200,
    recommendedHashtags: 3,
    maxHashtags: 5,
    supportsLineBreaks: true,
    styleHint:
      "Professional but human. Open with a hook line, use short paragraphs, end with a question or CTA. Avoid hype.",
  },
  facebook: {
    maxLength: 2000,
    targetLength: 500,
    recommendedHashtags: 2,
    maxHashtags: 4,
    supportsLineBreaks: true,
    styleHint:
      "Conversational and warm. A short story or relatable framing works well. Keep it skimmable.",
  },
  x: {
    maxLength: 280,
    targetLength: 240,
    recommendedHashtags: 1,
    maxHashtags: 2,
    supportsLineBreaks: false,
    styleHint:
      "Punchy and concise. One clear idea. Lead with the most interesting point. Minimal hashtags.",
  },
  instagram: {
    maxLength: 2200,
    targetLength: 800,
    recommendedHashtags: 8,
    maxHashtags: 15,
    supportsLineBreaks: true,
    styleHint:
      "Visual-first caption. Strong first line (it shows before 'more'), then value, then a block of relevant hashtags at the end.",
  },
};

/** Result of validating a variant body against a platform's rules. */
export interface ValidationResult {
  ok: boolean;
  issues: string[];
}

export function validateForPlatform(
  platform: Platform,
  body: string,
  hashtags: string[],
): ValidationResult {
  const rule = PLATFORM_RULES[platform];
  const issues: string[] = [];

  const fullLength = body.length + hashtags.join(" ").length + (hashtags.length > 0 ? 1 : 0);
  if (fullLength > rule.maxLength) {
    issues.push(
      `Exceeds ${platform} max length (${fullLength}/${rule.maxLength} chars).`,
    );
  }
  if (hashtags.length > rule.maxHashtags) {
    issues.push(
      `Too many hashtags for ${platform} (${hashtags.length}/${rule.maxHashtags}).`,
    );
  }
  if (body.trim().length === 0) {
    issues.push("Body is empty.");
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Best-effort repair so a slightly-too-long draft still makes it into the
 * review queue (a human can always edit). Trims the body and drops excess
 * hashtags rather than rejecting outright.
 */
export function clampToPlatform(
  platform: Platform,
  body: string,
  hashtags: string[],
): { body: string; hashtags: string[] } {
  const rule = PLATFORM_RULES[platform];
  let trimmedHashtags = hashtags.slice(0, rule.maxHashtags);

  const reserved = trimmedHashtags.join(" ").length + (trimmedHashtags.length > 0 ? 1 : 0);
  const maxBody = rule.maxLength - reserved;

  let trimmedBody = body;
  if (trimmedBody.length > maxBody) {
    const slice = trimmedBody.slice(0, Math.max(0, maxBody - 1));
    const lastSpace = slice.lastIndexOf(" ");
    trimmedBody = (lastSpace > maxBody * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd();
    trimmedBody = `${trimmedBody}…`;
  }

  return { body: trimmedBody, hashtags: trimmedHashtags };
}
