import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { FallbackAIProvider } from "../src/fallback.js";
import { createDefaultAIProvider } from "../src/factory.js";
import type { AIProvider, ChatInput } from "../src/types.js";

class MockProvider implements AIProvider {
  public failChat = false;
  public failStream = false;
  public chatCalled = false;
  public streamCalled = false;

  constructor(public readonly name: string) {}

  async embed(_text: string): Promise<number[]> {
    return new Array(768).fill(0.1);
  }

  async chat(input: ChatInput): Promise<string> {
    this.chatCalled = true;
    if (this.failChat) {
      throw new Error(`${this.name} chat rate limit exceeded (429)`);
    }
    return `${this.name} response for ${input.userPrompt}`;
  }

  async *chatStream(input: ChatInput): AsyncIterable<string> {
    this.streamCalled = true;
    if (this.failStream) {
      throw new Error(`${this.name} stream service unavailable (503)`);
    }
    yield `${this.name}: `;
    yield `token1 `;
    yield `token2`;
  }
}

describe("FallbackAIProvider", () => {
  it("uses primary provider when primary succeeds", async () => {
    const primary = new MockProvider("Primary");
    const fallback = new MockProvider("Fallback");
    const provider = new FallbackAIProvider(primary, fallback);

    const res = await provider.chat({ systemPrompt: "", userPrompt: "hello" });
    assert.equal(res, "Primary response for hello");
    assert.equal(primary.chatCalled, true);
    assert.equal(fallback.chatCalled, false);
  });

  it("automatically falls back to secondary model when primary chat fails", async () => {
    const primary = new MockProvider("Primary");
    primary.failChat = true;
    const fallback = new MockProvider("Fallback");

    let fallbackLogged = false;
    const provider = new FallbackAIProvider(primary, fallback, (err, method) => {
      fallbackLogged = true;
      assert.equal(method, "chat");
      assert.match((err as Error).message, /Primary chat rate limit exceeded/);
    });

    const res = await provider.chat({ systemPrompt: "", userPrompt: "hello" });
    assert.equal(res, "Fallback response for hello");
    assert.equal(primary.chatCalled, true);
    assert.equal(fallback.chatCalled, true);
    assert.equal(fallbackLogged, true);
  });

  it("automatically falls back to secondary model when primary chatStream fails", async () => {
    const primary = new MockProvider("Primary");
    primary.failStream = true;
    const fallback = new MockProvider("Fallback");

    let fallbackLogged = false;
    const provider = new FallbackAIProvider(primary, fallback, (err, method) => {
      fallbackLogged = true;
      assert.equal(method, "chatStream");
      assert.match((err as Error).message, /Primary stream service unavailable/);
    });

    const chunks: string[] = [];
    for await (const chunk of provider.chatStream({ systemPrompt: "", userPrompt: "hello" })) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, ["Fallback: ", "token1 ", "token2"]);
    assert.equal(fallbackLogged, true);
    assert.equal(fallback.streamCalled, true);
  });

  it("throws error if both primary and fallback fail", async () => {
    const primary = new MockProvider("Primary");
    primary.failChat = true;
    const fallback = new MockProvider("Fallback");
    fallback.failChat = true;

    const provider = new FallbackAIProvider(primary, fallback);

    await assert.rejects(
      async () => provider.chat({ systemPrompt: "", userPrompt: "hello" }),
      /Primary and fallback providers both failed for chat/
    );
  });

  it("createDefaultAIProvider initializes FallbackAIProvider with Gemini and Mistral", () => {
    const provider = createDefaultAIProvider({
      geminiClient: {
        models: {
          generateContent: async () => ({ text: "ok" }),
          embedContent: async () => ({ embeddings: [{ values: new Array(768).fill(0.1) }] }),
        },
      },
      mistralConfig: {
        apiKey: "dummy-key",
      },
    });

    assert.ok(provider instanceof FallbackAIProvider);
    assert.equal(typeof provider.chat, "function");
    assert.equal(typeof provider.chatStream, "function");
  });
});
