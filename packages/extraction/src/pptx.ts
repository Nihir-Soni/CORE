import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { ExtractionResult } from "./types.js";

const parser = new XMLParser({
    ignoreAttributes: true,
});

function collectText(node: unknown, out: string[]): void {
    if (node == null) return;

    if (typeof node === "string") {
        out.push(node);
        return;
    }

    if (Array.isArray(node)) {
        node.forEach((item) => collectText(item, out));
        return;
    }

    if (typeof node === "object") {
        const object = node as Record<string, unknown>;

        if (object["a:t"] != null) {
            collectText(object["a:t"], out);
        }

        for (const key of Object.keys(object)) {
            if (key !== "a:t") {
                collectText(object[key], out);
            }
        }
    }
}

export async function extractPptx(
    buffer: Buffer
): Promise<ExtractionResult> {
    const zip = await JSZip.loadAsync(buffer);

    const slideFiles = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => {
            const aNum = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
            const bNum = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);

            return aNum - bNum;
        });

    const slideTexts: string[] = [];

    for (const path of slideFiles) {
        const xml = await zip.files[path].async("string");

        const parsed = parser.parse(xml);
        const collected: string[] = [];

        collectText(parsed, collected);

        slideTexts.push(collected.join(" "));
    }

    return {
        text: slideTexts
            .map((text, index) => `## Slide ${index + 1}\n${text}`)
            .join("\n\n"),
        pageCount: slideTexts.length,
    };
}