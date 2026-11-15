import * as XLSX from "xlsx";
import type { ExtractionResult } from "./types.js";

export async function extractXlsx(
    buffer: Buffer
): Promise<ExtractionResult> {
    const workbook = XLSX.read(buffer, {
        type: "buffer",
    });

    const parts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];

        const csv = XLSX.utils.sheet_to_csv(sheet);

        parts.push(`## Sheet: ${sheetName}\n${csv}`);
    }

    return {
        text: parts.join("\n\n"),
    };
}