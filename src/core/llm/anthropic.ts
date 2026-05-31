import {
  LLMError,
  type CompletionOptions,
  type CompletionResult,
  type LLMMessage,
  type LLMProvider,
} from "./provider";

/**
 * Anthropic Messages API adapter built on the global `fetch` (no SDK).
 *
 * Anthropic separates the system prompt from the message list and does not
 * support a JSON response mode, so we fold the system messages into the
 * top-level `system` field and (when JSON is requested) nudge via the prompt.
 */
export interface AnthropicConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "claude-3-5-sonnet-latest";
    this.baseUrl = (config.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
  }

  async complete(
    messages: LLMMessage[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const convo = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        system: options?.json
          ? `${system}\n\nRespond with a single valid JSON object and nothing else.`
          : system,
        messages: convo,
        max_tokens: options?.maxTokens ?? 800,
        temperature: options?.temperature ?? 0.7,
      }),
      signal: options?.signal,
    });

    if (!res.ok) {
      const detail = await safeText(res);
      throw new LLMError("anthropic", `Anthropic request failed: ${detail}`, res.status);
    }

    const data = (await res.json()) as AnthropicResponse;
    const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
    return {
      text,
      model: data.model ?? this.model,
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
          }
        : undefined,
    };
  }
}

interface AnthropicResponse {
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return `HTTP ${res.status}`;
  }
}
