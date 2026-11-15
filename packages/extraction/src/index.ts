import { extractPdf } from "./pdf.js";
import { extractDocx } from "./docx.js";
import { extractPptx } from "./pptx.js";
import { extractXlsx } from "./xlsx.js";
import { extractImage } from "./image.js";

export { extractPdf, extractDocx, extractPptx, extractXlsx, extractImage };

export * from "./ocr/tesseract.js";

import type { ExtractionResult } from "./types.js";

export type { ExtractionResult, Extractor } from "./types.js";

const EXTRACTORS: Record<
    string,
    (buffer: Buffer) => Promise<ExtractionResult>
> = {
    "application/pdf": extractPdf,

    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        extractDocx,

    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        extractPptx,

    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        extractXlsx,

    "image/png": (buf) => extractImage(buf, "image/png"),

    "image/jpeg": (buf) => extractImage(buf, "image/jpeg"),
};

export async function extractText(
    buffer: Buffer,
    mimeType: string
): Promise<ExtractionResult> {
    const extractor = EXTRACTORS[mimeType];

    if (!extractor) {
        throw new Error(`unsupported_mime_type:${mimeType}`);
    }

    return extractor(buffer);
}