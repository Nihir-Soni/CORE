import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { MistralProvider } from "../src/mistral.js";

describe("MistralProvider", () => {
  it("throws when initialized without API key and no env var", () => {
    const originalKey = process.env.MISTRAL_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    try {
      assert.throws(
        () => new MistralProvider({ apiKey: "" }),
        /MISTRAL_API_KEY is not configured/
      );
    } finally {
      if (originalKey) {
        process.env.MISTRAL_API_KEY = originalKey;
      }
    }
  });

  it("chat sends correct payload and extracts response text", async () => {
    let capturedUrl = "";
    let capturedHeaders: any = {};
    let capturedBody: any = {};

    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      capturedBody = JSON.parse(init?.body as string);

      return new Response(
        JSON.stringify({
          id: "test-id",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Mistral test response",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const provider = new MistralProvider({
      apiKey: "test-key-123",
      chatModel: "open-mistral-7b",
      fetchFn: mockFetch,
    });

    const result = await provider.chat({
      systemPrompt: "System prompt test",
      userPrompt: "User prompt test",
    });

    assert.equal(result, "Mistral test response");
    assert.equal(capturedUrl, "https://api.mistral.ai/v1/chat/completions");
    assert.equal(capturedHeaders["Authorization"], "Bearer test-key-123");
    assert.equal(capturedBody.model, "open-mistral-7b");
    assert.deepEqual(capturedBody.messages, [
      { role: "system", content: "System prompt test" },
      { role: "user", content: "User prompt test" },
    ]);
  });

  it("chat handles API errors (e.g., 429 rate limit)", async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({ message: "Rate limit reached", code: "1300" }),
        { status: 429, statusText: "Too Many Requests" }
      );
    };

    const provider = new MistralProvider({
      apiKey: "test-key-123",
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await provider.chat({ systemPrompt: "", userPrompt: "hi" });
      },
      /Mistral API HTTP 429/
    );
  });

  it("chatStream yields tokens in order from SSE response", async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" from"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" Mistral!"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const line of sseLines) {
          controller.enqueue(new TextEncoder().encode(line));
        }
        controller.close();
      },
    });

    const mockFetch: typeof fetch = async () => {
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    const provider = new MistralProvider({
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const chunks: string[] = [];
    for await (const chunk of provider.chatStream({ systemPrompt: "", userPrompt: "hi" })) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, ["Hello", " from", " Mistral!"]);
  });

  it("embed throws informative error explaining 768-dim requirement", async () => {
    const provider = new MistralProvider({ apiKey: "test-key" });
    await assert.rejects(
      async () => provider.embed("hello"),
      /does not support 768-dimensional embeddings/
    );
  });
});
