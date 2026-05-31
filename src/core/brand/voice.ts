import type { Brand, BrandAsset, BrandVoice } from "../types";

/**
 * Turn a structured BrandVoice into a system prompt. Centralising this means
 * every provider and every platform gets a consistent brand-voice contract,
 * which is the main lever against off-brand or generic output.
 */
export function buildSystemPrompt(brand: Brand): string {
  const v: BrandVoice = brand.voice;
  const lines: string[] = [];

  lines.push(
    `You are the social media voice of "${brand.name}". Write posts that sound authentically like this brand.`,
  );
  lines.push("");
  lines.push(`About the brand: ${v.description}`);
  lines.push(`Primary audience: ${v.audience}`);
  if (v.toneAdjectives.length > 0) {
    lines.push(`Tone: ${v.toneAdjectives.join(", ")}.`);
  }
  if (v.contentPillars.length > 0) {
    lines.push(`Content pillars: ${v.contentPillars.join("; ")}.`);
  }
  lines.push(`Emoji usage: ${v.emojiUsage}.`);
  if (v.ctaStyle) {
    lines.push(`Preferred call-to-action style: ${v.ctaStyle}.`);
  }

  if (v.dos.length > 0) {
    lines.push("");
    lines.push("Always:");
    for (const d of v.dos) lines.push(`- ${d}`);
  }
  if (v.donts.length > 0) {
    lines.push("");
    lines.push("Never:");
    for (const d of v.donts) lines.push(`- ${d}`);
  }

  lines.push("");
  lines.push(
    "Write original copy. Do not fabricate statistics, customer quotes, or claims. " +
      "If you lack a specific fact, stay general rather than inventing one.",
  );

  return lines.join("\n");
}

/**
 * Lightweight lexical retrieval over brand assets (a stand-in for the
 * pgvector-backed semantic search used in the running app). Scores each asset
 * by keyword overlap with the topic and returns the top matches.
 */
export function selectRelevantAssets(
  assets: BrandAsset[],
  topic: string,
  limit = 3,
): BrandAsset[] {
  const terms = tokenize(topic);
  if (terms.size === 0) return assets.slice(0, limit);

  const scored = assets.map((asset) => {
    const haystack = tokenize(`${asset.title} ${asset.content} ${(asset.tags ?? []).join(" ")}`);
    let score = 0;
    for (const t of terms) {
      if (haystack.has(t)) score += 1;
    }
    return { asset, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.asset);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}
