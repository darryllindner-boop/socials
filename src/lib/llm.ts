import { createProvider, providerConfigFromEnv } from "@/core/llm/factory";
import type { LLMProvider } from "@/core/llm/provider";

/**
 * Build the configured LLM provider from environment variables. Centralised so
 * every server entrypoint (API routes, worker, seed) resolves the provider the
 * same way. Defaults to the offline `mock` provider when LLM_PROVIDER is unset.
 */
let cached: LLMProvider | undefined;

export function getLLMProvider(): LLMProvider {
  if (!cached) {
    cached = createProvider(providerConfigFromEnv(process.env));
  }
  return cached;
}
