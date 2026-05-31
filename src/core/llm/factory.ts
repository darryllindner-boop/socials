import { AnthropicProvider } from "./anthropic";
import { MockLLMProvider } from "./mock";
import { OpenAIProvider } from "./openai";
import type { LLMProvider } from "./provider";

export const PROVIDER_KINDS = ["mock", "openai", "anthropic"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export interface ProviderConfig {
  kind: ProviderKind;
  model?: string;
  openai?: { apiKey: string; baseUrl?: string };
  anthropic?: { apiKey: string; baseUrl?: string };
}

/**
 * Construct the configured provider. Throws a clear error if credentials for
 * the selected provider are missing, so misconfiguration fails fast at startup
 * rather than at first generation.
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.kind) {
    case "mock":
      return new MockLLMProvider(config.model ?? "mock-1");
    case "openai":
      if (!config.openai?.apiKey) {
        throw new Error("LLM_PROVIDER=openai but OPENAI_API_KEY is not set.");
      }
      return new OpenAIProvider({
        apiKey: config.openai.apiKey,
        baseUrl: config.openai.baseUrl,
        model: config.model,
      });
    case "anthropic":
      if (!config.anthropic?.apiKey) {
        throw new Error("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.");
      }
      return new AnthropicProvider({
        apiKey: config.anthropic.apiKey,
        baseUrl: config.anthropic.baseUrl,
        model: config.model,
      });
    default: {
      // Exhaustiveness guard.
      const _never: never = config.kind;
      throw new Error(`Unknown LLM provider: ${String(_never)}`);
    }
  }
}

/** Build a ProviderConfig from a plain env record (no direct process.env access in core). */
export function providerConfigFromEnv(env: Record<string, string | undefined>): ProviderConfig {
  const kindRaw = (env.LLM_PROVIDER ?? "mock").toLowerCase();
  const kind: ProviderKind = (PROVIDER_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as ProviderKind)
    : "mock";

  return {
    kind,
    model: env.LLM_MODEL || undefined,
    openai: {
      apiKey: env.OPENAI_API_KEY ?? "",
      baseUrl: env.OPENAI_BASE_URL || undefined,
    },
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY ?? "",
      baseUrl: env.ANTHROPIC_BASE_URL || undefined,
    },
  };
}
