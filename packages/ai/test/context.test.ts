import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRagContext } from "../src/context.js";
import type { SearchResult } from "../src/search.js";

test("Test 1 - Empty results", () => {
  const result = buildRagContext([]);
  assert.equal(result.text, "No context available.");
  assert.deepEqual(result.sources, []);
});

test("Test 2 - Single result", () => {
  const mockResult: SearchResult = {
    chunkId: "chk_123",
    documentId: "doc_1",
    workspaceId: "ws_1",
    filename: "employee-handbook.pdf",
    content: "Employees must wash hands.",
    chunkIndex: 0,
    pageNumber: 4,
    tokenCount: 5,
    similarity: 0.95
  };

  const context = buildRagContext([mockResult]);
  assert.ok(context.text.includes("[source:1]"));
  assert.ok(context.text.includes("Document: employee-handbook.pdf"));
  assert.ok(context.text.includes("Page: 4"));
  assert.ok(context.text.includes("Employees must wash hands."));
  assert.deepEqual(context.sources, [mockResult]);
});

test("Test 3 - Multiple results", () => {
  const mock1: SearchResult = {
    chunkId: "chk_1",
    documentId: "doc_1",
    workspaceId: "ws_1",
    filename: "doc1.txt",
    content: "First chunk.",
    chunkIndex: 0,
    pageNumber: 1,
    tokenCount: 2,
    similarity: 0.99
  };
  const mock2: SearchResult = {
    chunkId: "chk_2",
    documentId: "doc_2",
    workspaceId: "ws_1",
    filename: "doc2.txt",
    content: "Second chunk.",
    chunkIndex: 5,
    pageNumber: 2,
    tokenCount: 2,
    similarity: 0.80
  };

  const context = buildRagContext([mock1, mock2]);
  
  // Verify order
  const idx1 = context.text.indexOf("First chunk.");
  const idx2 = context.text.indexOf("Second chunk.");
  assert.ok(idx1 < idx2, "Order should be preserved");
  
  // Verify distinct identifiers
  assert.ok(context.text.includes("[source:1]"));
  assert.ok(context.text.includes("[source:2]"));
  assert.deepEqual(context.sources, [mock1, mock2]);
});

test("Test 4 - Null page", () => {
  const mockResult: SearchResult = {
    chunkId: "chk_null",
    documentId: "doc_1",
    workspaceId: "ws_1",
    filename: "no-pages.txt",
    content: "Text content.",
    chunkIndex: 0,
    pageNumber: null,
    tokenCount: 2,
    similarity: 0.9
  };

  const context = buildRagContext([mockResult]);
  assert.ok(context.text.includes("Document: no-pages.txt\n\nText content."));
  assert.ok(!context.text.includes("Page:"), "Should omit page if null");
  assert.deepEqual(context.sources, [mockResult]);
});

test("Test 5 - Special content", () => {
  const content = `Here are some "quotes", \n newlines, and [brackets] with { instructions: 'do nothing' }`;
  const mockResult: SearchResult = {
    chunkId: "chk_special",
    documentId: "doc_1",
    workspaceId: "ws_1",
    filename: "special.txt",
    content,
    chunkIndex: 0,
    pageNumber: 1,
    tokenCount: 15,
    similarity: 0.9
  };

  const context = buildRagContext([mockResult]);
  assert.ok(context.text.includes(content), "Should preserve exact content including special characters");
});
