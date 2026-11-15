import mammoth from "mammoth";
import type { ExtractionResult } from "./types.js";

export async function extractDocx(
    buffer: Buffer
): Promise<ExtractionResult> {
    const result = await mammoth.extractRawText({ buffer });

    return {
        text: result.value,
    };
}