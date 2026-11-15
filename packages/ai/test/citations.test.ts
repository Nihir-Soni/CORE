import { test } from "node:test";
import assert from "node:assert/strict";
import { mapCitations } from "../src/citations.js";
import type { Citation } from "../src/search.js";

const mockSources: Citation[] = [
  { chunkId: "chunk_1", documentId: "doc_1", workspaceId: "ws_1", filename: "f1", content: "", chunkIndex: 0, pageNumber: 1, tokenCount: 1, similarity: 0.9 },
  { chunkId: "chunk_2", documentId: "doc_2", workspaceId: "ws_1", filename: "f2", content: "", chunkIndex: 0, pageNumber: 2, tokenCount: 1, similarity: 0.8 },
  { chunkId: "chunk_3", documentId: "doc_3", workspaceId: "ws_1", filename: "f3", content: "", chunkIndex: 0, pageNumber: 3, tokenCount: 1, similarity: 0.7 }
];

test("Test 1 - Single citation", () => {
  const answer = "This is a fact [source:1].";
  const citations = mapCitations(answer, mockSources);
  assert.deepEqual(citations, [mockSources[0]]);
});

test("Test 2 - Multiple citations", () => {
  const answer = "Fact one [source:1] and fact two [source:3].";
  const citations = mapCitations(answer, mockSources);
  assert.deepEqual(citations, [mockSources[0], mockSources[2]]);
});

test("Test 3 - Duplicate citations deduplicated", () => {
  const answer = "Fact one [source:1] and again [source:1] and [source:1].";
  const citations = mapCitations(answer, mockSources);
  assert.deepEqual(citations, [mockSources[0]]);
});

test("Test 4 - First-seen order preserved", () => {
  const answer = "Fact three [source:3], fact one [source:1], fact two [source:2].";
  const citations = mapCitations(answer, mockSources);
  assert.deepEqual(citations, [mockSources[2], mockSources[0], mockSources[1]]);
});

test("Test 5 - Invalid indices ignored", () => {
  const answer = "Valid [source:1], invalid high [source:999], invalid zero [source:0], valid [source:2].";
  const citations = mapCitations(answer, mockSources);
  assert.deepEqual(citations, [mockSources[0], mockSources[1]]);
});

test("Test 6 - Malformed references ignored", () => {
  const answer = "This is [source:abc], [source:-1], [source:], and [source:1].";
  const citations = mapCitations(answer, mockSources);
  assert.deepEqual(citations, [mockSources[0]]);
});

test("Test 7 - No citations found", () => {
  const answer = "This is just text without any sources.";
  const citations = mapCitations(answer, mockSources);
  assert.deepEqual(citations, []);
});

test("Test 8 - Case insensitivity", () => {
  const answer = "Uppercase [SOURCE:1] and mixed [Source:2].";
  const citations = mapCitations(answer, mockSources);
  assert.deepEqual(citations, [mockSources[0], mockSources[1]]);
});

test("Test 9 - Empty retrieval", () => {
  const answer = "Cannot answer [source:1].";
  const citations = mapCitations(answer, []);
  assert.deepEqual(citations, []);
});
