/**
 * Provider-agnostic LLM abstraction.
 *
 * Every concrete provider (mock, OpenAI, Anthropic, ...) implements `LLMProvider`.
 * The rest of the codebase only ever depends on this interface, so swapping or
 * adding a provider never touches business logic.
 */

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  /** 0 = deterministic, higher = more varied. */
  temperature?: number;
  /** Hard cap on output tokens. */
  maxTokens?: number;
  /** Ask the provider for a JSON object response when supported. */
  json?: boolean;
  /** Optional per-call seed for reproducibility (provider support varies). */
  seed?: number;
  /** Abort signal for timeouts/cancellation. */
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  /** Provider + model actually used, for logging/eval. */
  model: string;
  /** Token accounting when the provider returns it. */
  usage?: { promptTokens: number; completionTokens: number };
}

export interface LLMProvider {
  /** Stable identifier, e.g. "mock", "openai", "anthropic". */
  readonly name: string;
  /** Model id this instance targets. */
  readonly model: string;
  complete(messages: LLMMessage[], options?: CompletionOptions): Promise<CompletionResult>;
}

/** Error type all providers should throw on failure, for uniform handling. */
export class LLMError extends Error {
  readonly provider: string;
  readonly status?: number;

  constructor(provider: string, message: string, status?: number) {
    super(message);
    this.name = "LLMError";
    this.provider = provider;
    this.status = status;
  }
}
