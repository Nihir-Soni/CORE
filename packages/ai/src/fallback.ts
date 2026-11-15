import type { AIProvider, ChatInput } from "./types.js";

export type FallbackLogger = (error: unknown, method: string, providerName?: string) => void;

export class FallbackAIProvider implements AIProvider {
  constructor(
    public readonly primary: AIProvider,
    public readonly fallback: AIProvider,
    private readonly onFallback?: FallbackLogger
  ) {}

  async embed(text: string): Promise<number[]> {
    try {
      return await this.primary.embed(text);
    } catch (primaryError) {
      if (this.fallback.embed) {
        try {
          this.logFallback(primaryError, "embed");
          return await this.fallback.embed(text);
        } catch (fallbackError) {
          throw new Error(
            `Primary and fallback providers both failed for embed. Primary error: ${
              primaryError instanceof Error ? primaryError.message : String(primaryError)
            }. Fallback error: ${
              fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
            }`
          );
        }
      }
      throw primaryError;
    }
  }

  async chat(input: ChatInput): Promise<string> {
    let timer: NodeJS.Timeout | null = null;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Primary provider timed out waiting for response (8000ms)"));
        }, 8000);
      });
      const result = await Promise.race([this.primary.chat(input), timeoutPromise]);
      if (timer) clearTimeout(timer);
      return result;
    } catch (primaryError) {
      if (timer) clearTimeout(timer);
      this.logFallback(primaryError, "chat");
      try {
        return await this.fallback.chat(input);
      } catch (fallbackError) {
        throw new Error(
          `Primary and fallback providers both failed for chat. Primary error: ${
            primaryError instanceof Error ? primaryError.message : String(primaryError)
          }. Fallback error: ${
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          }`
        );
      }
    }
  }

  async *chatStream(input: ChatInput): AsyncIterable<string> {
    let startedPrimary = false;
    let primaryIterator: AsyncIterator<string> | null = null;
    let firstChunk: IteratorResult<string> | null = null;
    let primaryError: unknown = null;

    if (this.primary.chatStream) {
      let timer: NodeJS.Timeout | null = null;
      try {
        const stream = this.primary.chatStream(input);
        primaryIterator = stream[Symbol.asyncIterator]();
        // Probe the first token to catch immediate failures (rate limits, 429, 503, connection errors, hanging)
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("Primary provider timed out waiting for first token (6000ms)"));
          }, 6000);
        });
        firstChunk = await Promise.race([primaryIterator.next(), timeoutPromise]);
        if (timer) clearTimeout(timer);
        startedPrimary = true;
      } catch (err) {
        if (timer) clearTimeout(timer);
        primaryError = err;
        this.logFallback(err, "chatStream");
      }
    } else {
      try {
        const fullAnswer = await this.primary.chat(input);
        yield fullAnswer;
        return;
      } catch (err) {
        primaryError = err;
        this.logFallback(err, "chatStream");
      }
    }

    if (startedPrimary && primaryIterator && firstChunk) {
      if (!firstChunk.done && firstChunk.value !== undefined) {
        yield firstChunk.value;
      }
      try {
        while (true) {
          const res = await primaryIterator.next();
          if (res.done) break;
          yield res.value;
        }
        return;
      } catch (err) {
        // Primary failed mid-stream after tokens were already delivered
        console.error("[FallbackAIProvider] Primary stream failed mid-flight after tokens were produced:", err);
        throw err;
      }
    }

    // Primary failed before tokens were yielded: seamlessly fallback to secondary model
    try {
      if (this.fallback.chatStream) {
        for await (const chunk of this.fallback.chatStream(input)) {
          yield chunk;
        }
      } else {
        const fullAnswer = await this.fallback.chat(input);
        yield fullAnswer;
      }
    } catch (fallbackError) {
      throw new Error(
        `Primary and fallback providers both failed for chatStream. Primary error: ${
          primaryError instanceof Error ? primaryError.message : String(primaryError)
        }. Fallback error: ${
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        }`
      );
    }
  }

  private logFallback(error: unknown, method: string): void {
    if (this.onFallback) {
      this.onFallback(error, method);
    } else {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[FallbackAIProvider] Primary provider failed on ${method}: "${msg}". Falling back to secondary model...`);
    }
  }
}
