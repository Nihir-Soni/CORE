import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRagContext, estimateTokens } from "../src/context.js";
import type { SearchResult } from "../src/search.js";

test("Token Budgeting - Empty results", () => {
  const result = buildRagContext([], { maxTokens: 1000 });
  assert.equal(result.text, "No context available.");
  assert.deepEqual(result.sources, []);
  assert.equal(result.totalTokens, 0);
  assert.equal(result.maxTokens, 1000);
  assert.equal(result.includedCount, 0);
  assert.equal(result.totalCandidates, 0);
  assert.equal(result.isTruncated, false);
});

test("Token Budgeting - Includes all results when budget is generous", () => {
  const mock1: SearchResult = {
    chunkId: "chk_1",
    documentId: "doc_1",
    workspaceId: "ws_1",
    filename: "doc1.txt",
    content: "Short content one.",
    chunkIndex: 0,
    pageNumber: 1,
    tokenCount: 5,
    similarity: 0.95,
  };
  const mock2: SearchResult = {
    chunkId: "chk_2",
    documentId: "doc_2",
    workspaceId: "ws_1",
    filename: "doc2.txt",
    content: "Short content two.",
    chunkIndex: 1,
    pageNumber: 2,
    tokenCount: 5,
    similarity: 0.90,
  };

  const context = buildRagContext([mock1, mock2], { maxTokens: 4000 });
  assert.equal(context.includedCount, 2);
  assert.equal(context.totalCandidates, 2);
  assert.equal(context.isTruncated, false);
  assert.ok(context.text.includes("[source:1]"));
  assert.ok(context.text.includes("[source:2]"));
});

test("Token Budgeting - Truncates results when maxTokens is tight", () => {
  const longContent = "A".repeat(800); // ~200 tokens
  const mock1: SearchResult = {
    chunkId: "chk_1",
    documentId: "doc_1",
    workspaceId: "ws_1",
    filename: "doc1.txt",
    content: longContent,
    chunkIndex: 0,
    pageNumber: 1,
    tokenCount: 200,
    similarity: 0.95,
  };
  const mock2: SearchResult = {
    chunkId: "chk_2",
    documentId: "doc_2",
    workspaceId: "ws_1",
    filename: "doc2.txt",
    content: longContent,
    chunkIndex: 1,
    pageNumber: 2,
    tokenCount: 200,
    similarity: 0.90,
  };
  const mock3: SearchResult = {
    chunkId: "chk_3",
    documentId: "doc_3",
    workspaceId: "ws_1",
    filename: "doc3.txt",
    content: longContent,
    chunkIndex: 2,
    pageNumber: 3,
    tokenCount: 200,
    similarity: 0.85,
  };

  // Budget for ~1.5 chunks (~350 tokens)
  const context = buildRagContext([mock1, mock2, mock3], { maxTokens: 350 });
  
  assert.equal(context.includedCount, 1);
  assert.equal(context.totalCandidates, 3);
  assert.equal(context.isTruncated, true);
  assert.ok(context.text.includes("[source:1]"));
  assert.ok(!context.text.includes("[source:2]"));
  assert.ok(!context.text.includes("[source:3]"));
  assert.ok(context.totalTokens <= 350);
});

test("Token Budgeting - Custom tokenizer function", () => {
  const mock1: SearchResult = {
    chunkId: "chk_1",
    documentId: "doc_1",
    workspaceId: "ws_1",
    filename: "doc1.txt",
    content: "Word1 Word2 Word3",
    chunkIndex: 0,
    pageNumber: 1,
    tokenCount: 3,
    similarity: 0.9,
  };

  // Custom tokenizer: counts space-separated words
  const wordCountTokenizer = (text: string) => text.trim().split(/\s+/).length;

  const context = buildRagContext([mock1], {
    maxTokens: 50,
    tokenizer: wordCountTokenizer,
  });

  assert.equal(context.includedCount, 1);
  assert.equal(context.isTruncated, false);
});

test("Token Budgeting - estimateTokens utility", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcdefgh"), 2);
});
