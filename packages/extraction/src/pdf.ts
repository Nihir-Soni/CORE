import { PDFParse } from "pdf-parse";
import type { ExtractionResult } from "./types.js";

export async function extractPdf(
    buffer: Buffer
): Promise<ExtractionResult> {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();

    return {
        text: result.text,
        pageCount: result.total,
    };
}