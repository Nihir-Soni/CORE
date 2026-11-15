import { test } from "node:test";
import assert from "node:assert/strict";
import type { AIProvider, ChatInput } from "../src/types.js";
import { GeminiProvider } from "../src/gemini.js";

// Mock for Test 6 & 9
class MockProvider implements AIProvider {
  async embed(text: string): Promise<number[]> {
    return [0.1, 0.2, 0.3]; // Fake
  }
  async chat(input: ChatInput): Promise<string> {
    if (input.userPrompt === "fail") {
      throw new Error("Simulated failure");
    }
    return `Mock answer for: ${input.userPrompt}`;
  }
}

test("Test 6 - Provider interface", async () => {
  const provider = new MockProvider();
  
  // Verify it acts as an AIProvider
  const embedRes = await provider.embed("hello");
  assert.equal(embedRes.length, 3);

  const chatRes = await provider.chat({
    systemPrompt: "You are a test",
    userPrompt: "hello"
  });
  assert.equal(chatRes, "Mock answer for: hello");
});

test("Test 9 - Provider failure", async () => {
  const provider = new MockProvider();
  await assert.rejects(
    async () => {
      await provider.chat({ systemPrompt: "", userPrompt: "fail" });
    },
    (err: Error) => err.message === "Simulated failure"
  );
});

// Mock GoogleGenAI client for Test 7 & 8
test("Test 7 - Gemini configuration", async () => {
  let passedModel = "";
  let passedContents = "";
  let passedSystem = "";

  const fakeClient = {
    models: {
      generateContent: async (args: any) => {
        passedModel = args.model;
        passedContents = args.contents;
        passedSystem = args.config.systemInstruction;
        return { text: "fake response" };
      }
    }
  };

  // Type cast as any because we don't want to mock the entire GoogleGenAI instance deeply
  const gemini = new GeminiProvider(fakeClient as any);
  
  const res = await gemini.chat({
    systemPrompt: "System instruction",
    userPrompt: "User instruction"
  });

  assert.equal(res, "fake response");
  assert.equal(passedContents, "User instruction");
  assert.equal(passedSystem, "System instruction");
  // env.GEMINI_CHAT_MODEL defaults to gemini-3.8-flash since we didn't inject it differently
  assert.ok(passedModel.includes("gemini"));
});

test("Test 8 - Empty response", async () => {
  const fakeClient = {
    models: {
      generateContent: async (args: any) => {
        return { text: "" }; // Empty text
      }
    }
  };

  const gemini = new GeminiProvider(fakeClient as any);
  
  await assert.rejects(
    async () => {
      await gemini.chat({ systemPrompt: "", userPrompt: "test" });
    },
    (err: Error) => err.message.includes("Missing text")
  );
});

test("Test - Gemini chatStream yielding tokens in order", async () => {
  const fakeClient = {
    models: {
      generateContentStream: async function* (args: any) {
        yield { text: "Hello " };
        yield { text: "world!" };
      }
    }
  };

  const gemini = new GeminiProvider(fakeClient as any);
  const chunks: string[] = [];
  for await (const chunk of gemini.chatStream({ systemPrompt: "sys", userPrompt: "user" })) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, ["Hello ", "world!"]);
});
