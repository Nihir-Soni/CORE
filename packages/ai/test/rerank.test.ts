import { test } from "node:test";
import assert from "node:assert/strict";
import { DefaultReranker, rerankSearchResults, type Reranker } from "../src/rerank.js";
import type { SearchResult } from "../src/search.js";

test("Reranking - Empty candidates returns []", async () => {
  const result = await rerankSearchResults("test query", []);
  assert.deepEqual(result, []);
});

test("Reranking - Boosts exact phrase match to the top", async () => {
  const candidate1: SearchResult = {
    chunkId: "chk_1",
    documentId: "doc_1",
    workspaceId: "ws_1",
    filename: "contract.pdf",
    content: "This document mentions penalties for late shipment in general terms.",
    chunkIndex: 0,
    pageNumber: 1,
    tokenCount: 10,
    similarity: 0.85, // Higher vector similarity, but NO exact phrase match
  };

  const candidate2: SearchResult = {
    chunkId: "chk_2",
    documentId: "doc_2",
    workspaceId: "ws_1",
    filename: "supplier_terms.pdf",
    content: "Q3 supplier contract specifies exact late delivery penalties of 5% per week.",
    chunkIndex: 1,
    pageNumber: 3,
    tokenCount: 12,
    similarity: 0.70, // Lower vector similarity, but HAS exact phrase match
  };

  const query = "late delivery penalties";
  const reranked = await rerankSearchResults(query, [candidate1, candidate2]);

  assert.equal(reranked.length, 2);
  assert.equal(reranked[0].chunkId, "chk_2"); // exact match candidate reranked to #1
  assert.ok(reranked[0].rerankScore > reranked[1].rerankScore);
  assert.equal(reranked[0].rankReason, "Exact phrase match");
});

test("Reranking - Higher term coverage beats lower term coverage", async () => {
  const candidate1: SearchResult = {
    chunkId: "chk_1",
    documentId: "doc_1",
    workspaceId: "ws_1",
    filename: "spec.pdf",
    content: "Only architectural deviations are listed here.",
    chunkIndex: 0,
    pageNumber: 1,
    tokenCount: 8,
    similarity: 0.80,
  };

  const candidate2: SearchResult = {
    chunkId: "chk_2",
    documentId: "doc_2",
    workspaceId: "ws_1",
    filename: "drawings.pdf",
    content: "Summarize every spec deviation across these architectural drawings.",
    chunkIndex: 0,
    pageNumber: 1,
    tokenCount: 10,
    similarity: 0.78,
  };

  const query = "spec deviation architectural drawings";
  const reranked = await rerankSearchResults(query, [candidate1, candidate2]);

  assert.equal(reranked[0].chunkId, "chk_2");
});

test("Reranking - topK parameter bounds results", async () => {
  const candidates: SearchResult[] = Array.from({ length: 5 }, (_, i) => ({
    chunkId: `chk_${i}`,
    documentId: `doc_${i}`,
    workspaceId: "ws_1",
    filename: `file_${i}.pdf`,
    content: `Content snippet number ${i}`,
    chunkIndex: i,
    pageNumber: 1,
    tokenCount: 5,
    similarity: 0.5 + i * 0.1,
  }));

  const reranked = await rerankSearchResults("snippet", candidates, { topK: 2 });
  assert.equal(reranked.length, 2);
});

test("Reranking - Custom Reranker implementation", async () => {
  class CustomReranker implements Reranker {
    async rerank(query: string, candidates: SearchResult[]) {
      return candidates.map((c) => ({
        ...c,
        rerankScore: c.chunkIndex === 2 ? 1.0 : 0.1,
      })).sort((a, b) => b.rerankScore - a.rerankScore);
    }
  }

  const candidates: SearchResult[] = Array.from({ length: 3 }, (_, i) => ({
    chunkId: `chk_${i}`,
    documentId: "doc_1",
    workspaceId: "ws_1",
    filename: "file.txt",
    content: `Chunk ${i}`,
    chunkIndex: i,
    pageNumber: 1,
    tokenCount: 2,
    similarity: 0.8,
  }));

  const reranked = await rerankSearchResults("test", candidates, { reranker: new CustomReranker() });
  assert.equal(reranked[0].chunkId, "chk_2");
  assert.equal(reranked[0].rerankScore, 1.0);
});
