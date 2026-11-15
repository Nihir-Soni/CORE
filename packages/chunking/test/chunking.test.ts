/**
 * @core/chunking — unit and integration tests
 *
 * Run: pnpm --filter @core/chunking test
 *      (which runs: tsc && node --test dist/test/chunking.test.js)
 *
 * Tests A–F are pure unit tests (no database).
 * Tests G–H require a live database and are skipped if DATABASE_URL is not set.
 *
 * Determinism note: all assertions are deterministic given fixed inputs and
 * the DEFAULT_TARGET_TOKENS=700 / DEFAULT_MAX_TOKENS=900 / overlap=12.5%.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  chunkDocument,
  normalizeText,
  splitParagraphs,
  approximateTokens,
  persistChunks,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Helper: build a paragraph of approximately `approxTokens` tokens.
// Each token ≈ 4 chars, so we generate approxTokens * 4 "a" characters.
// ---------------------------------------------------------------------------
function makeParagraph(approxTokens: number, char = "a"): string {
  return char.repeat(approxTokens * 4);
}

// ---------------------------------------------------------------------------
// Helper: build a multi-paragraph text with a given number of paragraphs,
// each of approximately `tokensPerPara` tokens.
// ---------------------------------------------------------------------------
function makeText(paragraphCount: number, tokensPerPara: number): string {
  const paras: string[] = [];
  for (let i = 0; i < paragraphCount; i++) {
    // Vary the character so paragraphs look distinct.
    const char = String.fromCharCode(97 + (i % 26));
    paras.push(makeParagraph(tokensPerPara, char));
  }
  return paras.join("\n\n");
}

// ---------------------------------------------------------------------------
// Test A — empty text
// ---------------------------------------------------------------------------
describe("Test A: empty text", () => {
  it("returns zero chunks for empty string", () => {
    const chunks = chunkDocument("");
    assert.equal(chunks.length, 0);
  });

  it("returns zero chunks for whitespace-only string", () => {
    const chunks = chunkDocument("   \n\n\t  ");
    assert.equal(chunks.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Test B — short text (single chunk)
// ---------------------------------------------------------------------------
describe("Test B: short text produces one chunk", () => {
  it("short paragraph yields exactly one chunk", () => {
    const text = "This is a short document that fits in a single chunk.";
    const chunks = chunkDocument(text);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].chunkIndex, 0);
    assert.ok(chunks[0].content.length > 0);
  });

  it("short chunk has non-zero tokenCount", () => {
    const text = "Hello world. This is a simple test.";
    const [chunk] = chunkDocument(text);
    assert.ok(chunk.tokenCount > 0);
  });

  it("short chunk has null pageNumber", () => {
    const text = "Short content.";
    const [chunk] = chunkDocument(text);
    assert.equal(chunk.pageNumber, null);
  });
});

// ---------------------------------------------------------------------------
// Test C — long text (multiple chunks)
// ---------------------------------------------------------------------------
describe("Test C: long text produces multiple chunks", () => {
  // 20 paragraphs × 100 tokens each = ~2000 tokens, target=700 → expect 3–4 chunks
  const text = makeText(20, 100);

  it("produces more than one chunk", () => {
    const chunks = chunkDocument(text);
    assert.ok(chunks.length > 1, `Expected >1 chunk, got ${chunks.length}`);
  });

  it("chunkIndex starts at 0 and is sequential", () => {
    const chunks = chunkDocument(text);
    chunks.forEach((chunk, i) => {
      assert.equal(chunk.chunkIndex, i);
    });
  });

  it("no chunk has empty content", () => {
    const chunks = chunkDocument(text);
    for (const chunk of chunks) {
      assert.ok(chunk.content.trim().length > 0, `Chunk ${chunk.chunkIndex} is empty`);
    }
  });

  it("output is deterministic — running twice yields identical results", () => {
    const a = chunkDocument(text);
    const b = chunkDocument(text);
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i].content, b[i].content);
      assert.equal(a[i].tokenCount, b[i].tokenCount);
      assert.equal(a[i].chunkIndex, b[i].chunkIndex);
    }
  });
});

// ---------------------------------------------------------------------------
// Test D — overlap
// ---------------------------------------------------------------------------
describe("Test D: overlap between adjacent chunks", () => {
  // 10 paragraphs × 120 tokens each = 1200 tokens → should produce 2–3 chunks
  // with overlapFraction=0.125 and targetTokens=700, overlap ≈ 87.5 tokens ≈ 350 chars
  const text = makeText(10, 120);

  it("adjacent chunks share some text (overlap content)", () => {
    const chunks = chunkDocument(text);
    // Need at least 2 chunks to test overlap
    assert.ok(chunks.length >= 2, `Expected >=2 chunks, got ${chunks.length}`);

    let foundOverlap = false;
    for (let i = 0; i < chunks.length - 1; i++) {
      const curr = chunks[i].content;
      const next = chunks[i + 1].content;
      // The end of chunk[i] should appear somewhere in chunk[i+1].
      // We check for a 50-char suffix of chunk[i] in chunk[i+1].
      const suffix = curr.slice(-50);
      if (next.includes(suffix)) {
        foundOverlap = true;
        break;
      }
    }
    assert.ok(foundOverlap, "No overlap found between adjacent chunks");
  });

  it("overlap does not duplicate an entire chunk", () => {
    const chunks = chunkDocument(text);
    for (let i = 0; i < chunks.length - 1; i++) {
      const curr = chunks[i].content;
      const next = chunks[i + 1].content;
      // The entire content of chunk[i] should NOT be a substring of chunk[i+1]
      // (that would mean the whole chunk was duplicated).
      assert.ok(
        !next.includes(curr),
        `Chunk ${i} is entirely contained in chunk ${i + 1} (whole-chunk duplication)`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Test E — paragraph boundaries
// ---------------------------------------------------------------------------
describe("Test E: paragraph boundary preference", () => {
  it("chunks begin at paragraph boundaries when text fits cleanly", () => {
    // 3 paragraphs of 300 tokens each = 900 total tokens.
    // target=700: first chunk should contain paragraph 1 (300 tokens),
    // then adding para 2 (300→600 tokens) stays under target,
    // then adding para 3 (300→900 tokens) exceeds target → emit [para1, para2],
    // then [overlap + para3].
    const para1 = makeParagraph(300, "x");
    const para2 = makeParagraph(300, "y");
    const para3 = makeParagraph(300, "z");
    const text = [para1, para2, para3].join("\n\n");

    const chunks = chunkDocument(text, { targetTokens: 700, maxTokens: 900 });

    // First chunk must contain para1 content
    assert.ok(
      chunks[0].content.includes(para1),
      "First chunk should contain first paragraph"
    );

    // Last chunk must contain para3 content
    const last = chunks[chunks.length - 1];
    assert.ok(
      last.content.includes(para3),
      "Last chunk should contain last paragraph"
    );
  });

  it("normalizeText collapses excessive blank lines", () => {
    const text = "para1\n\n\n\n\npara2";
    const normalized = normalizeText(text);
    // Should reduce to exactly one blank line between paragraphs
    assert.equal(normalized, "para1\n\npara2");
  });

  it("splitParagraphs discards empty paragraphs", () => {
    const normalized = "para1\n\npara2\n\n\n\npara3";
    const paras = splitParagraphs(normalized);
    assert.equal(paras.length, 3);
    assert.equal(paras[0], "para1");
    assert.equal(paras[1], "para2");
    assert.equal(paras[2], "para3");
  });
});

// ---------------------------------------------------------------------------
// Test F — huge single paragraph (fallback split)
// ---------------------------------------------------------------------------
describe("Test F: huge paragraph exceeding maxTokens is split deterministically", () => {
  // Single paragraph of 2000 tokens → exceeds maxTokens=900 → force-split
  const hugePara = makeParagraph(2000, "h");
  const text = hugePara; // the entire text is one paragraph

  it("produces multiple chunks from a single oversized paragraph", () => {
    const chunks = chunkDocument(text, { targetTokens: 700, maxTokens: 900 });
    assert.ok(chunks.length > 1, `Expected >1 chunk, got ${chunks.length}`);
  });

  it("no chunk is empty after force-split", () => {
    const chunks = chunkDocument(text, { targetTokens: 700, maxTokens: 900 });
    for (const chunk of chunks) {
      assert.ok(chunk.content.trim().length > 0, `Chunk ${chunk.chunkIndex} is empty`);
    }
  });

  it("force-split output is deterministic", () => {
    const a = chunkDocument(text, { targetTokens: 700, maxTokens: 900 });
    const b = chunkDocument(text, { targetTokens: 700, maxTokens: 900 });
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i].content, b[i].content);
    }
  });

  it("chunkIndex is sequential even after force-split", () => {
    const chunks = chunkDocument(text, { targetTokens: 700, maxTokens: 900 });
    chunks.forEach((chunk, i) => assert.equal(chunk.chunkIndex, i));
  });
});

// ---------------------------------------------------------------------------
// Test G — idempotent persistence (requires DATABASE_URL)
// Test H — workspace ownership (requires DATABASE_URL)
// ---------------------------------------------------------------------------
const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
  console.log(
    "\n[SKIP] Tests G and H require DATABASE_URL. Set it to run persistence tests.\n"
  );
} else {
  // Dynamic import so the module doesn't crash at load time without DATABASE_URL.
  const { prisma } = await import("@core/database");

  // Shared test fixtures — we look up an existing document that has content.
  // We pick the most recently created document that has DocumentContent.
  const existingDoc = await prisma.documentContent.findFirst({
    include: { document: true },
    orderBy: { extractedAt: "desc" },
  });

  if (!existingDoc) {
    console.log(
      "\n[SKIP] Tests G and H require at least one document with DocumentContent in the database.\n"
    );
  } else {
    const DOC_ID = existingDoc.documentId;
    const WS_ID = existingDoc.document.workspaceId;
    const sampleText = existingDoc.text.slice(0, 5000); // use first 5000 chars

    describe("Test G: idempotent persistence", () => {
      it("persisting twice yields the same chunk count with no duplicates", async () => {
        const chunks = chunkDocument(sampleText);

        const r1 = await persistChunks(prisma, DOC_ID, WS_ID, chunks);
        assert.ok(r1.ok, `First persist failed: ${JSON.stringify(r1)}`);

        const r2 = await persistChunks(prisma, DOC_ID, WS_ID, chunks);
        assert.ok(r2.ok, `Second persist failed: ${JSON.stringify(r2)}`);

        assert.equal(
          (r1 as { ok: true; chunkCount: number }).chunkCount,
          (r2 as { ok: true; chunkCount: number }).chunkCount,
          "Chunk count must be the same after second persist"
        );

        // Confirm no duplicates in DB (UNIQUE constraint prevents them,
        // but we verify the count matches our expected chunk count).
        const dbCount = await prisma.chunk.count({ where: { documentId: DOC_ID } });
        assert.equal(
          dbCount,
          (r2 as { ok: true; chunkCount: number }).chunkCount,
          `DB row count (${dbCount}) does not match returned chunkCount`
        );
      });
    });

    describe("Test H: workspace ownership", () => {
      it("persisted chunks carry the correct workspaceId from the document", async () => {
        const chunks = chunkDocument(sampleText);
        const result = await persistChunks(prisma, DOC_ID, WS_ID, chunks);
        assert.ok(result.ok);

        const dbChunks = await prisma.chunk.findMany({
          where: { documentId: DOC_ID },
          select: { workspaceId: true },
        });

        for (const row of dbChunks) {
          assert.equal(
            row.workspaceId,
            WS_ID,
            `Chunk has wrong workspaceId: expected ${WS_ID}, got ${row.workspaceId}`
          );
        }
      });

      it("wrong workspaceId returns wrong_workspace error", async () => {
        const chunks = chunkDocument(sampleText);
        const result = await persistChunks(
          prisma,
          DOC_ID,
          "definitely-not-the-right-workspace-id",
          chunks
        );
        assert.ok(!result.ok);
        assert.equal(
          (result as { ok: false; error: string }).error,
          "wrong_workspace"
        );
      });

      it("non-existent document returns document_not_found error", async () => {
        const chunks = chunkDocument(sampleText);
        const result = await persistChunks(
          prisma,
          "non-existent-document-id",
          WS_ID,
          chunks
        );
        assert.ok(!result.ok);
        assert.equal(
          (result as { ok: false; error: string }).error,
          "document_not_found"
        );
      });
    });

    // Clean up persisted test chunks so we don't pollute the DB.
    // (Optional teardown — comment out if you want to inspect chunks after tests.)
    await prisma.chunk.deleteMany({ where: { documentId: DOC_ID } });
    await prisma.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// Token approximation sanity
// ---------------------------------------------------------------------------
describe("approximateTokens utility", () => {
  it("returns ceil(length/4)", () => {
    assert.equal(approximateTokens("abcd"), 1);   // 4/4 = 1
    assert.equal(approximateTokens("abcde"), 2);  // ceil(5/4) = 2
    assert.equal(approximateTokens(""), 0);        // ceil(0/4) = 0
  });
});
