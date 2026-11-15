import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractText, extractImage } from "../src/index.js";

describe("Image Extraction - Unit Tests", () => {
  // Minimal valid 1x1 transparent PNG buffer
  const validPngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64"
  );

  it("extracts text from image/png without throwing unsupported_mime_type", async () => {
    const result = await extractText(validPngBuffer, "image/png");
    assert.ok(result);
    assert.ok(typeof result.text === "string");
    assert.ok(result.text.length > 0);
    assert.equal(result.pageCount, 1);
  });

  it("extracts text from image/jpeg without throwing unsupported_mime_type", async () => {
    const result = await extractText(validPngBuffer, "image/jpeg");
    assert.ok(result);
    assert.ok(typeof result.text === "string");
    assert.ok(result.text.length > 0);
    assert.equal(result.pageCount, 1);
  });

  it("extractImage directly returns valid ExtractionResult", async () => {
    const result = await extractImage(validPngBuffer, "image/png");
    assert.ok(result);
    assert.equal(result.pageCount, 1);
    assert.ok(typeof result.text === "string");
  });

  it("gracefully falls back when neither Tesseract nor Gemini is available", async () => {
    const prevKey = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      const result = await extractImage(validPngBuffer, "image/png");
      assert.ok(result);
      assert.equal(result.pageCount, 1);
      assert.ok(result.text.includes("image/png") || result.text.length > 0);
    } finally {
      if (prevKey !== undefined) {
        process.env.GEMINI_API_KEY = prevKey;
      }
    }
  });
});
