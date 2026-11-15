import { env } from "@core/shared";
import type { AIProvider, ChatInput } from "./types.js";

export interface MistralProviderConfig {
  apiKey?: string;
  chatModel?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.mistral.ai/v1";
const DEFAULT_MODEL = "open-mistral-7b";

export class MistralProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly chatModel: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config?: MistralProviderConfig) {
    const key = config?.apiKey ?? env.MISTRAL_API_KEY ?? process.env.MISTRAL_API_KEY;
    if (!key) {
      throw new Error("MISTRAL_API_KEY is not configured.");
    }
    this.apiKey = key;
    this.chatModel = config?.chatModel ?? env.MISTRAL_CHAT_MODEL ?? process.env.MISTRAL_CHAT_MODEL ?? DEFAULT_MODEL;
    this.baseUrl = (config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchFn = config?.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  get model(): string {
    return this.chatModel;
  }

  async embed(_text: string): Promise<number[]> {
    throw new Error(
      "MistralProvider does not support 768-dimensional embeddings required by the database schema (mistral-embed produces 1024-dimensional vectors). Use GeminiProvider for embeddings."
    );
  }

  async chat(input: ChatInput): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const messages = [
      ...(input.systemPrompt ? [{ role: "system", content: input.systemPrompt }] : []),
      { role: "user", content: input.userPrompt },
    ];

    try {
      const response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: this.chatModel,
          messages,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Mistral API HTTP ${response.status}: ${errText || response.statusText}`);
      }

      const data = (await response.json()) as any;
      const text = data?.choices?.[0]?.message?.content;
      if (!text || typeof text !== "string" || text.trim() === "") {
        throw new Error("Invalid response from Mistral API: Missing text.");
      }

      return text;
    } catch (error) {
      if (error instanceof Error && error.message.includes("Invalid response")) {
        throw error;
      }
      throw new Error(`Mistral API chat failure: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async *chatStream(input: ChatInput): AsyncIterable<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const messages = [
      ...(input.systemPrompt ? [{ role: "system", content: input.systemPrompt }] : []),
      { role: "user", content: input.userPrompt },
    ];

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: this.chatModel,
          messages,
          stream: true,
        }),
      });
    } catch (error) {
      throw new Error(`Mistral API chat stream connection failure: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Mistral API HTTP ${response.status}: ${errText || response.statusText}`);
    }

    if (!response.body) {
      throw new Error("Invalid response from Mistral API: Missing response stream body.");
    }

    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    // Support both standard web ReadableStream reader and AsyncIterable streams
    if (typeof (response.body as any).getReader === "function") {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const token = parseSSELine(line);
            if (token === "[DONE]") return;
            if (token) yield token;
          }
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      for await (const chunk of response.body as any) {
        const chunkStr = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
        buffer += chunkStr;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const token = parseSSELine(line);
          if (token === "[DONE]") return;
          if (token) yield token;
        }
      }
    }

    if (buffer.trim()) {
      const token = parseSSELine(buffer);
      if (token && token !== "[DONE]") {
        yield token;
      }
    }
  }
}

function parseSSELine(rawLine: string): string | null {
  const trimmed = rawLine.trim();
  if (!trimmed || !trimmed.startsWith("data:")) {
    return null;
  }
  const payload = trimmed.slice(5).trim();
  if (payload === "[DONE]") {
    return "[DONE]";
  }
  try {
    const parsed = JSON.parse(payload);
    const content = parsed?.choices?.[0]?.delta?.content;
    if (typeof content === "string" && content.length > 0) {
      return content;
    }
  } catch {
    // Ignore malformed partial chunks or SSE keepalives
  }
  return null;
}
