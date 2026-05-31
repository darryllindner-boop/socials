import {
  LLMError,
  type CompletionOptions,
  type CompletionResult,
  type LLMMessage,
  type LLMProvider,
} from "./provider";

/**
 * OpenAI Chat Completions adapter built on the global `fetch` (no SDK), so it
 * adds zero dependencies to the core. Compatible with any OpenAI-style endpoint
 * via OPENAI_BASE_URL (Azure OpenAI, local gateways, etc.).
 */
export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: OpenAIConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "gpt-4o-mini";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  }

  async complete(
    messages: LLMMessage[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 800,
        ...(options?.seed !== undefined ? { seed: options.seed } : {}),
        ...(options?.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: options?.signal,
    });

    if (!res.ok) {
      const detail = await safeText(res);
      throw new LLMError("openai", `OpenAI request failed: ${detail}`, res.status);
    }

    const data = (await res.json()) as OpenAIResponse;
    const text = data.choices?.[0]?.message?.content ?? "";
    return {
      text,
      model: data.model ?? this.model,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
          }
        : undefined,
    };
  }
}

interface OpenAIResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return `HTTP ${res.status}`;
  }
}
