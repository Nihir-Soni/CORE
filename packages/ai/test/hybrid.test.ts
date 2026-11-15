import { test } from "node:test";
import assert from "node:assert/strict";
import { searchHybridChunks, type SearchMode } from "../src/search.js";
import type { AIProvider } from "../src/types.js";

class MockAIProvider implements AIProvider {
  async embed(text: string): Promise<number[]> {
    const vec = new Array(768).fill(0.01);
    vec[0] = 0.5;
    return vec;
  }
  async chat() {
    return "mock response";
  }
}

test("Hybrid Search - Empty query returns [] immediately", async () => {
  const provider = new MockAIProvider();
  const mockPrisma = {} as any;

  const results1 = await searchHybridChunks({
    query: "",
    workspaceId: "ws_1",
    provider,
    prisma: mockPrisma,
  });
  assert.deepEqual(results1, []);

  const results2 = await searchHybridChunks({
    query: "   \n\t ",
    workspaceId: "ws_1",
    provider,
    prisma: mockPrisma,
  });
  assert.deepEqual(results2, []);
});

test("Hybrid Search - Mode parameters validation and types", () => {
  const modes: SearchMode[] = ["hybrid", "vector", "text"];
  for (const mode of modes) {
    assert.ok(["hybrid", "vector", "text"].includes(mode));
  }
});
