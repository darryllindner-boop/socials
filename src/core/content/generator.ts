import { buildSystemPrompt } from "../brand/voice";
import type { LLMProvider } from "../llm/provider";
import type { GenerationRequest, Platform, PostVariant } from "../types";
import { newId } from "../util/id";
import { buildUserPrompt } from "./prompt";
import { clampToPlatform, validateForPlatform } from "./platform-rules";

/**
 * Generate one post variant per requested platform from brand context + topic.
 *
 * Output always lands in `pending_review` — never auto-published — to honour
 * the "review every morning before publishing" workflow.
 */
export async function generateVariants(
  provider: LLMProvider,
  request: GenerationRequest,
): Promise<PostVariant[]> {
  const system = buildSystemPrompt(request.brand);

  const results = await Promise.all(
    request.platforms.map((platform) =>
      generateOne(provider, request, platform, system),
    ),
  );

  return results;
}

async function generateOne(
  provider: LLMProvider,
  request: GenerationRequest,
  platform: Platform,
  system: string,
): Promise<PostVariant> {
  const userPrompt = buildUserPrompt(request.brand, platform, request.topic, request.instruction);

  const completion = await provider.complete(
    [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
    { json: true, temperature: 0.7, seed: request.seed },
  );

  const parsed = parseVariantJson(completion.text);
  const hashtags = normaliseHashtags(parsed.hashtags);
  const clamped = clampToPlatform(platform, parsed.body.trim(), hashtags);
  const validation = validateForPlatform(platform, clamped.body, clamped.hashtags);

  return {
    id: newId("var"),
    platform,
    status: "pending_review",
    body: clamped.body,
    hashtags: clamped.hashtags,
    // Surface validation issues to the reviewer without blocking the draft.
    error: validation.ok ? undefined : validation.issues.join(" "),
  };
}

interface RawVariant {
  body: string;
  hashtags: string[];
}

/**
 * Robustly extract {body, hashtags} from a model response that may be wrapped
 * in prose or code fences.
 */
export function parseVariantJson(text: string): RawVariant {
  const candidate = extractJsonObject(text);
  if (candidate) {
    try {
      const obj = JSON.parse(candidate) as Partial<RawVariant>;
      return {
        body: typeof obj.body === "string" ? obj.body : "",
        hashtags: Array.isArray(obj.hashtags) ? obj.hashtags.map(String) : [],
      };
    } catch {
      /* fall through */
    }
  }
  // Last resort: treat the whole response as the body.
  return { body: text.trim(), hashtags: [] };
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = fenced?.[1] ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return source.slice(start, end + 1);
}

/** Normalise hashtags: ensure single leading #, strip spaces, dedupe, drop empties. */
export function normaliseHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const cleaned = raw.trim().replace(/\s+/g, "");
    if (!cleaned) continue;
    const withHash = cleaned.startsWith("#") ? cleaned : `#${cleaned}`;
    const key = withHash.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(withHash);
  }
  return out;
}
