import { selectRelevantAssets } from "../brand/voice";
import type { Brand, Platform } from "../types";
import { PLATFORM_RULES } from "./platform-rules";

/**
 * Build the user message for a single platform variant.
 *
 * The message contains:
 *   1. A human-readable instruction (what real LLMs follow).
 *   2. A fenced ```json context block. Real providers treat it as extra
 *      grounding; the deterministic mock parses it to synthesise output. Using
 *      one format for both keeps dev/prod behaviour aligned.
 */
export function buildUserPrompt(
  brand: Brand,
  platform: Platform,
  topic: string,
  instruction?: string,
): string {
  const rule = PLATFORM_RULES[platform];
  const assets = selectRelevantAssets(brand.assets, topic, 3);

  const context = {
    platform,
    topic,
    audience: brand.voice.audience,
    tone: brand.voice.toneAdjectives,
    pillars: brand.voice.contentPillars,
    recommendedHashtags: rule.recommendedHashtags,
    targetLength: rule.targetLength,
    emojiUsage: brand.voice.emojiUsage,
  };

  const lines: string[] = [];
  lines.push(`Write one ${platform} post about: ${topic}.`);
  lines.push(rule.styleHint);
  lines.push(
    `Keep it around ${rule.targetLength} characters (hard max ${rule.maxLength}). ` +
      `Use about ${rule.recommendedHashtags} relevant hashtags (max ${rule.maxHashtags}).`,
  );
  if (instruction) {
    lines.push(`Extra instruction for this post: ${instruction}`);
  }

  if (assets.length > 0) {
    lines.push("");
    lines.push("Relevant brand knowledge you may draw on (do not copy verbatim):");
    for (const a of assets) {
      lines.push(`- ${a.title}: ${truncate(a.content, 280)}`);
    }
  }

  lines.push("");
  lines.push(
    'Respond ONLY with a JSON object of the form {"body": string, "hashtags": string[]}. ' +
      "Do not include the hashtags inside body; put them in the array (with or without leading #).",
  );
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(context));
  lines.push("```");

  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
