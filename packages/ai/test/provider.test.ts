import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GoogleGenAI } from "@google/genai";
import { GeminiProvider, normalizeL2 } from "../src/index.js";
import { env } from "@core/shared";

describe("L2 Normalization", () => {
  it("normalizes a valid vector", () => {
    // 3^2 + 4^2 = 9 + 16 = 25. sqrt(25) = 5.
    // Normalized: [3/5, 4/5] = [0.6, 0.8]
    const vec = [3, 4];
    const normalized = normalizeL2(vec);
    assert.equal(normalized[0], 0.6);
    assert.equal(normalized[1], 0.8);
  });

  it("throws on zero vector", () => {
    assert.throws(() => normalizeL2([0, 0, 0]), /Invalid L2 norm/);
  });

  it("throws on non-finite values", () => {
    assert.throws(() => normalizeL2([1, NaN, 3]), /non-finite value/);
    assert.throws(() => normalizeL2([1, Infinity, 3]), /non-finite value/);
  });
});

describe("GeminiProvider - Input Validation", () => {
  // Use a dummy client so we don't hit the real API
  const dummyClient = {} as GoogleGenAI;
  const provider = new GeminiProvider(dummyClient);

  it("rejects empty string", async () => {
    await assert.rejects(
      () => provider.embed(""),
      /empty or whitespace-only/
    );
  });

  it("rejects whitespace-only string", async () => {
    await assert.rejects(
      () => provider.embed("   \n\t  "),
      /empty or whitespace-only/
    );
  });
});

describe("GeminiProvider - Mocked API", () => {
  it("processes a valid response and normalizes the vector", async () => {
    const mockValues = new Array(768).fill(0);
    // Let's make it a valid non-zero vector
    mockValues[0] = 3;
    mockValues[1] = 4;
    // norm = 5

    const mockClient = {
      models: {
        embedContent: async () => ({
          embeddings: [{ values: mockValues }],
        }),
      },
    } as unknown as GoogleGenAI;

    const provider = new GeminiProvider(mockClient);
    const result = await provider.embed("hello");
    
    assert.equal(result.length, 768);
    assert.equal(result[0], 0.6);
    assert.equal(result[1], 0.8);
    assert.equal(result[2], 0);
  });

  it("throws on missing embeddings", async () => {
    const mockClient = {
      models: {
        embedContent: async () => ({}), // Missing embeddings
      },
    } as unknown as GoogleGenAI;

    const provider = new GeminiProvider(mockClient);
    await assert.rejects(
      () => provider.embed("test"),
      /Missing embeddings/
    );
  });

  it("throws on wrong dimensionality", async () => {
    const mockClient = {
      models: {
        embedContent: async () => ({
          embeddings: [{ values: [1, 2, 3] }], // Not 768
        }),
      },
    } as unknown as GoogleGenAI;

    const provider = new GeminiProvider(mockClient);
    await assert.rejects(
      () => provider.embed("test"),
      /Invalid dimensionality: expected 768, got 3/
    );
  });

  it("wraps unexpected API errors", async () => {
    const mockClient = {
      models: {
        embedContent: async () => {
          throw new Error("Network timeout");
        },
      },
    } as unknown as GoogleGenAI;

    const provider = new GeminiProvider(mockClient);
    await assert.rejects(
      () => provider.embed("test"),
      /Gemini API failure: Network timeout/
    );
  });
});

describe("GeminiProvider - Environment", () => {
  it("throws on instantiation if no API key is present and no client provided", () => {
    // Save original
    const originalKey = env.GEMINI_API_KEY;
    env.GEMINI_API_KEY = undefined;

    try {
      assert.throws(() => new GeminiProvider(), /GEMINI_API_KEY is not configured/);
    } finally {
      env.GEMINI_API_KEY = originalKey;
    }
  });
});

describe("Live Sanity Test", () => {
  it("runs a real embedding request if GEMINI_API_KEY is present", async () => {
    if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY === "dummy") {
      console.log("[SKIP] Live test skipped because GEMINI_API_KEY is not set or is dummy.");
      return;
    }

    const provider = new GeminiProvider();
    const result = await provider.embed("This is a live integration test.");
    
    assert.equal(result.length, 768, "Live vector should have 768 dimensions");
    
    // Check normalization mathematically (sum of squares should be ~1.0)
    let sumSquares = 0;
    for (const val of result) {
      sumSquares += val * val;
    }
    
    // Floating point math means it might not be exactly 1, but very close.
    assert.ok(Math.abs(sumSquares - 1.0) < 0.0001, `Sum of squares was ${sumSquares}, expected ~1.0`);
  });
});
