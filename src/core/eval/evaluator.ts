/**
 * Content evaluation: catch repetitive or off-brand output BEFORE it reaches
 * the review queue (and especially before an "auto" channel publishes it).
 *
 * Dependency-free + deterministic so it runs under `npm run verify:core`. Each
 * check appends zero or more EvalIssues; the result aggregates them into a
 * quality score and a hard `blocked` flag. The server layer supplies recent
 * posts for the repetition check and persists the result.
 */
import type { BrandVoice, Platform } from "../types";
import { maxSimilarity } from "./similarity";

export type EvalSeverity = "info" | "warn" | "block";

export interface EvalIssue {
  /** Stable machine code, e.g. "repetition", "banned_term", "off_brand_tone". */
  code: string;
  severity: EvalSeverity;
  message: string;
  detail?: Record<string, unknown>;
}

export interface EvalResult {
  /** 0..1 quality score (1 = clean). */
  score: number;
  issues: EvalIssue[];
  /** True if any block-severity issue is present (must not auto-publish). */
  blocked: boolean;
  /** Index of the most similar prior post, when repetition was checked. */
  mostSimilarIndex?: number;
}

export interface EvalOptions {
  /** Similarity at/above which repetition is a warning. Default 0.6. */
  repetitionWarn?: number;
  /** Similarity at/above which repetition is blocked. Default 0.82. */
  repetitionBlock?: number;
}

export interface EvalInput {
  platform: Platform;
  body: string;
  hashtags: string[];
  voice: BrandVoice;
  /** Recent post texts for the same brand/platform, for repetition detection. */
  priorTexts?: string[];
  options?: EvalOptions;
}

/** Marketing clichés that read as generic/off-brand for most voices. */
const BUZZWORDS = [
  "synergy", "game-changer", "game changer", "revolutionary", "cutting-edge",
  "cutting edge", "best-in-class", "world-class", "leverage", "unlock",
  "supercharge", "disrupt", "disruptive", "paradigm", "next-level", "10x",
  "seamless", "turnkey", "ninja", "rockstar", "guru", "thought leader",
];

/** Phrases suggesting unsupported claims (health/finance/guarantees). */
const CLAIM_PATTERNS: RegExp[] = [
  /\bclinically proven\b/i,
  /\bfda[- ]approved\b/i,
  /\bguaranteed?\b/i,
  /\brisk[- ]free\b/i,
  /\bmiracle\b/i,
  /\bcures?\b/i,
  /\blose weight fast\b/i,
  /\bdouble your (?:income|revenue|sales)\b/i,
];

/** Template/placeholder leakage that indicates broken generation. */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[[^\]]*\]/, // [insert ...], [brand], [link]
  /\{\{.*?\}\}/, // {{handlebars}}
  /\blorem ipsum\b/i,
  /\bTODO\b/,
  /\binsert\b[^.]*\bhere\b/i,
  /\bas an ai\b/i,
  /\b(?:i am|i'm) an ai\b/i,
  /\blanguage model\b/i,
  /\bi (?:cannot|can'?t) (?:help|assist|comply)\b/i,
  /\bxxxx+\b/i,
];

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export function evaluateVariant(input: EvalInput): EvalResult {
  const issues: EvalIssue[] = [];
  const body = input.body ?? "";
  const text = body.trim();

  // --- structural ---
  if (text.length === 0) {
    issues.push({ code: "empty", severity: "block", message: "Post body is empty." });
  } else if (text.length < 12) {
    issues.push({
      code: "too_short",
      severity: "warn",
      message: "Post is very short and may read as low-effort.",
    });
  }

  // --- placeholder / template leakage ---
  for (const re of PLACEHOLDER_PATTERNS) {
    const m = body.match(re);
    if (m) {
      issues.push({
        code: "placeholder",
        severity: "block",
        message: `Looks like unfinished/template text: "${truncate(m[0], 40)}".`,
        detail: { match: m[0] },
      });
      break;
    }
  }

  // --- banned terms (hard brand rule) ---
  for (const term of input.voice.bannedTerms ?? []) {
    if (!term.trim()) continue;
    if (containsPhrase(body, term)) {
      issues.push({
        code: "banned_term",
        severity: "block",
        message: `Contains banned term "${term}".`,
        detail: { term },
      });
    }
  }

  // --- buzzwords / off-brand tone ---
  const foundBuzz = BUZZWORDS.filter((w) => containsPhrase(body, w));
  if (foundBuzz.length >= 2) {
    issues.push({
      code: "off_brand_buzzwords",
      severity: "warn",
      message: `Heavy marketing clichés: ${foundBuzz.slice(0, 5).join(", ")}.`,
      detail: { buzzwords: foundBuzz },
    });
  } else if (foundBuzz.length === 1) {
    issues.push({
      code: "off_brand_buzzwords",
      severity: "info",
      message: `Marketing cliché: ${foundBuzz[0]}.`,
      detail: { buzzwords: foundBuzz },
    });
  }

  // --- unsupported claims ---
  const claim = CLAIM_PATTERNS.find((re) => re.test(body));
  if (claim) {
    issues.push({
      code: "unsupported_claim",
      severity: "warn",
      message: "Possible unsupported claim (health/finance/guarantee). Verify before posting.",
      detail: { pattern: claim.source },
    });
  }

  // --- emoji policy ---
  const emojiCount = (body.match(EMOJI_RE) ?? []).length;
  if (input.voice.emojiUsage === "none" && emojiCount > 0) {
    issues.push({
      code: "emoji_policy",
      severity: "warn",
      message: `Brand voice is emoji-free but post has ${emojiCount} emoji.`,
    });
  } else if (input.voice.emojiUsage === "sparing" && emojiCount > 4) {
    issues.push({
      code: "emoji_policy",
      severity: "warn",
      message: `Brand voice uses emoji sparingly but post has ${emojiCount}.`,
    });
  }

  // --- shouting / punctuation ---
  const words = text.split(/\s+/).filter(Boolean);
  const capsWords = words.filter((w) => /^[A-Z]{3,}$/.test(w));
  if (words.length >= 5 && capsWords.length / words.length > 0.3) {
    issues.push({
      code: "shouting",
      severity: "warn",
      message: "Excessive ALL-CAPS reads as shouting.",
    });
  }
  if ((body.match(/!/g) ?? []).length >= 4) {
    issues.push({
      code: "excessive_punctuation",
      severity: "warn",
      message: "Excessive exclamation marks.",
    });
  }

  // --- repetition ---
  const warnAt = input.options?.repetitionWarn ?? 0.6;
  const blockAt = input.options?.repetitionBlock ?? 0.82;
  let mostSimilarIndex: number | undefined;
  if (input.priorTexts && input.priorTexts.length > 0) {
    const match = maxSimilarity(body, input.priorTexts);
    mostSimilarIndex = match.index >= 0 ? match.index : undefined;
    const pct = Math.round(match.score * 100);
    if (match.score >= blockAt) {
      issues.push({
        code: "repetition",
        severity: "block",
        message: `Near-duplicate of a recent post (${pct}% similar).`,
        detail: { similarity: match.score, index: match.index },
      });
    } else if (match.score >= warnAt) {
      issues.push({
        code: "repetition",
        severity: "warn",
        message: `Similar to a recent post (${pct}% similar).`,
        detail: { similarity: match.score, index: match.index },
      });
    }
  }

  return {
    score: scoreFromIssues(issues),
    issues,
    blocked: issues.some((i) => i.severity === "block"),
    mostSimilarIndex,
  };
}

const SEVERITY_PENALTY: Record<EvalSeverity, number> = {
  info: 0.03,
  warn: 0.15,
  block: 0.5,
};

function scoreFromIssues(issues: EvalIssue[]): number {
  let score = 1;
  for (const issue of issues) {
    score -= SEVERITY_PENALTY[issue.severity];
  }
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

/** Case-insensitive whole-phrase match with word boundaries where possible. */
function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // \b only works around word chars; for phrases with non-word edges fall back
  // to a plain includes check.
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  return re.test(haystack);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
