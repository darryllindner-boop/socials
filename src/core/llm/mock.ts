import type {
  CompletionOptions,
  CompletionResult,
  LLMMessage,
  LLMProvider,
} from "./provider";

/**
 * Deterministic, offline LLM provider.
 *
 * It requires no network/API key, which makes it ideal for local development,
 * automated tests, and `npm run verify:core`. Given the same prompt + seed it
 * always returns the same output.
 *
 * It looks for a fenced ```json ... ``` context block in the prompt (emitted by
 * the prompt builder) and synthesises a plausible, on-brand post from it. Real
 * providers see the same block as ordinary context and simply follow the
 * natural-language instructions instead.
 */
interface PromptContext {
  platform: string;
  topic: string;
  audience?: string;
  tone?: string[];
  pillars?: string[];
  recommendedHashtags?: number;
  targetLength?: number;
  emojiUsage?: "none" | "sparing" | "liberal";
}

const HOOKS = [
  "Here's something we keep coming back to:",
  "A quick thought for anyone building right now:",
  "Most teams get this wrong, so let's fix it:",
  "We learned this the hard way:",
  "Small change, surprisingly big payoff:",
  "If you only read one thing today, make it this:",
];

const CLOSERS = [
  "What's worked for you?",
  "Curious how you'd approach it.",
  "Reply if this resonates.",
  "Worth a try this week.",
  "Tell us where you land on this.",
];

export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";
  readonly model: string;

  constructor(model = "mock-1") {
    this.model = model;
  }

  async complete(
    messages: LLMMessage[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const userText = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n\n");

    const ctx = extractJsonContext(userText);
    const seed = options?.seed ?? 0;

    if (!ctx) {
      // No structured context: echo a deterministic stub.
      return {
        text: JSON.stringify({ body: "Draft unavailable: missing context.", hashtags: [] }),
        model: this.model,
      };
    }

    const rng = mulberry32(hashString(`${ctx.topic}|${ctx.platform}|${seed}`));
    const hook = pick(HOOKS, rng);
    const closer = pick(CLOSERS, rng);
    const pillar = ctx.pillars && ctx.pillars.length > 0 ? pick(ctx.pillars, rng) : undefined;

    const emoji =
      ctx.emojiUsage === "liberal" ? "✨ " : ctx.emojiUsage === "sparing" ? "" : "";

    const audienceLine = ctx.audience ? ` for ${ctx.audience}` : "";
    const pillarLine = pillar ? ` It ties back to ${pillar.toLowerCase()}.` : "";

    let body: string;
    if (ctx.platform === "x") {
      body = `${emoji}${ctx.topic}. ${shorten(hook)} ${closer}`;
    } else if (ctx.platform === "instagram") {
      body =
        `${emoji}${capitalize(ctx.topic)}${audienceLine}.\n\n` +
        `${hook} we break down what actually matters and skip the noise.${pillarLine}\n\n` +
        `Save this for later. ${closer}`;
    } else {
      // linkedin / facebook
      body =
        `${hook}\n\n` +
        `${capitalize(ctx.topic)}${audienceLine} doesn't have to be complicated. ` +
        `Here's the version that works without a big team behind it.${pillarLine}\n\n` +
        `${closer}`;
    }

    const hashtags = buildHashtags(ctx, rng);

    return {
      text: JSON.stringify({ body, hashtags }),
      model: this.model,
      usage: { promptTokens: userText.length, completionTokens: body.length },
    };
  }
}

function buildHashtags(ctx: PromptContext, rng: () => number): string[] {
  const count = ctx.recommendedHashtags ?? 3;
  const pool = new Set<string>();
  for (const word of ctx.topic.split(/\s+/)) {
    const clean = word.replace(/[^a-zA-Z0-9]/g, "");
    if (clean.length > 2) pool.add(`#${clean.toLowerCase()}`);
  }
  for (const p of ctx.pillars ?? []) {
    const clean = p.replace(/[^a-zA-Z0-9]/g, "");
    if (clean.length > 2) pool.add(`#${clean.toLowerCase()}`);
  }
  pool.add("#smallbusiness");
  pool.add("#marketing");
  pool.add("#growth");

  const arr = Array.from(pool);
  // Deterministic shuffle.
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr.slice(0, Math.max(0, count));
}

function extractJsonContext(text: string): PromptContext | null {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1]) as PromptContext;
  } catch {
    return null;
  }
}

function shorten(s: string): string {
  return s.replace(/[:.]$/, "");
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** Deterministic 32-bit PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple string hash -> uint32. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
