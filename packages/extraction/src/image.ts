import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { ExtractionResult } from "./types.js";
import { verifyTesseract, runTesseractFile } from "./ocr/tesseract.js";

/**
 * Extracts text and content from an image buffer (PNG, JPEG, etc.).
 *
 * Extraction Hierarchy:
 * 1. Local Tesseract OCR (if available on the system).
 * 2. Gemini Multimodal Vision API (if GEMINI_API_KEY is configured).
 * 3. Graceful fallback placeholder (avoids failing the processing pipeline).
 */
export async function extractImage(
  buffer: Buffer,
  mimeType: string = "image/png"
): Promise<ExtractionResult> {
  // Strategy 1: Local Tesseract OCR
  try {
    const diag = await verifyTesseract();
    if (diag.available) {
      const isJpeg = mimeType.includes("jpeg") || mimeType.includes("jpg");
      const ext = isJpeg ? "jpg" : "png";
      const tmpPath = path.join(os.tmpdir(), `ocr_${randomUUID()}.${ext}`);

      try {
        await fs.writeFile(tmpPath, buffer);
        const text = await runTesseractFile(tmpPath);
        if (text && text.trim().length > 0) {
          return {
            text: text.trim(),
            pageCount: 1,
          };
        }
      } finally {
        await fs.unlink(tmpPath).catch(() => {});
      }
    }
  } catch (ocrErr) {
    console.warn("[OCR] Tesseract OCR attempt failed, checking fallback:", ocrErr);
  }

  // Strategy 2: Gemini Multimodal Vision AI
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const model = process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash";
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: "Extract and transcribe all text, numbers, code, labels, and diagrams from this image accurately for document indexing and search. If the image contains text, output the exact transcribed text. If the image contains diagrams or figures, explain the labels and structure clearly.",
                  },
                  {
                    inline_data: {
                      mime_type: mimeType,
                      data: buffer.toString("base64"),
                    },
                  },
                ],
              },
            ],
          }),
        }
      );

      if (response.ok) {
        const data = (await response.json()) as any;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 0) {
          return {
            text: text.trim(),
            pageCount: 1,
          };
        }
      } else {
        const errBody = await response.text().catch(() => "");
        console.warn(`[OCR] Gemini Vision API returned ${response.status}:`, errBody);
      }
    } catch (aiErr) {
      console.warn("[OCR] Gemini Vision AI extraction failed:", aiErr);
    }
  }

  // Strategy 3: Graceful fallback so document reaches READY status
  return {
    text: `[Image document: ${mimeType}]`,
    pageCount: 1,
  };
}
