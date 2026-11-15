import { describe, before, it } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma, withWorkspaceContext } from "@core/database";
import type { AIProvider } from "../src/types.js";
import { searchHybridChunks, type SearchResult } from "../src/search.js";
import { rerankSearchResults } from "../src/rerank.js";
import { buildRagContext } from "../src/context.js";
import { embedChunks } from "../src/integration.js";

class BenchmarkMockProvider implements AIProvider {
  async embed(text: string): Promise<number[]> {
    const vec = new Array(768).fill(0.01);
    const val = parseFloat(text);
    vec[0] = !isNaN(val) ? val : text.length;

    const sqSum = vec.reduce((sum, v) => sum + v * v, 0);
    const mag = Math.sqrt(sqSum);
    return vec.map(v => v / mag);
  }

  async chat() {
    return "mock response";
  }
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

describe("Phase 10 Performance Baseline Benchmarks", () => {
  let orgId: string;
  let workspaceId: string;
  let userId: string;
  let provider: BenchmarkMockProvider;

  before(async () => {
    provider = new BenchmarkMockProvider();

    const org = await prisma.organization.create({
      data: { name: "Bench Org " + randomUUID() }
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        email: `bench_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId
      }
    });
    userId = user.id;

    const ws = await prisma.workspace.create({
      data: { name: "Bench Workspace", orgId }
    });
    workspaceId = ws.id;

    // Populate dataset with 20 chunks
    const chunks = await withWorkspaceContext(workspaceId, async (tx) => {
      const doc = await tx.document.create({
        data: {
          workspaceId,
          uploadedById: userId,
          filename: "benchmark_doc.txt",
          mimeType: "text/plain",
          sizeBytes: 5000,
          storageKey: `test/bench_${randomUUID()}.txt`,
          status: "READY"
        }
      });

      const list = [];
      for (let i = 0; i < 20; i++) {
        const c = await tx.chunk.create({
          data: {
            documentId: doc.id,
            workspaceId,
            content: `Performance benchmark sample content chunk #${i}. Document intelligence search performance testing chunk text.`,
            chunkIndex: i,
            tokenCount: 20
          }
        });
        list.push(c);
      }
      return list;
    });

    await embedChunks(chunks, provider, prisma, { workspaceId });
  });

  const REPETITIONS = 30;

  it("Vector-only retrieval benchmark", async () => {
    const latencies: number[] = [];
    for (let i = 0; i < REPETITIONS; i++) {
      const start = performance.now();
      await searchHybridChunks({
        query: "intelligence search performance",
        workspaceId,
        provider,
        prisma,
        topK: 10,
        mode: "vector"
      });
      latencies.push(performance.now() - start);
    }

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    console.log(`[BENCHMARK] Vector-only Retrieval -> count: ${REPETITIONS}, p50: ${p50.toFixed(2)}ms, p95: ${p95.toFixed(2)}ms`);
    assert.ok(p50 >= 0);
  });

  it("Lexical-only retrieval benchmark", async () => {
    const latencies: number[] = [];
    for (let i = 0; i < REPETITIONS; i++) {
      const start = performance.now();
      await searchHybridChunks({
        query: "intelligence search performance",
        workspaceId,
        provider,
        prisma,
        topK: 10,
        mode: "text"
      });
      latencies.push(performance.now() - start);
    }

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    console.log(`[BENCHMARK] Lexical-only Retrieval -> count: ${REPETITIONS}, p50: ${p50.toFixed(2)}ms, p95: ${p95.toFixed(2)}ms`);
    assert.ok(p50 >= 0);
  });

  it("Hybrid retrieval benchmark", async () => {
    const latencies: number[] = [];
    for (let i = 0; i < REPETITIONS; i++) {
      const start = performance.now();
      await searchHybridChunks({
        query: "intelligence search performance",
        workspaceId,
        provider,
        prisma,
        topK: 10,
        mode: "hybrid"
      });
      latencies.push(performance.now() - start);
    }

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    console.log(`[BENCHMARK] Hybrid Retrieval -> count: ${REPETITIONS}, p50: ${p50.toFixed(2)}ms, p95: ${p95.toFixed(2)}ms`);
    assert.ok(p50 >= 0);
  });

  it("Hybrid + Reranking benchmark", async () => {
    const latencies: number[] = [];
    for (let i = 0; i < REPETITIONS; i++) {
      const start = performance.now();
      const raw = await searchHybridChunks({
        query: "intelligence search performance sample",
        workspaceId,
        provider,
        prisma,
        topK: 10,
        mode: "hybrid"
      });
      await rerankSearchResults("intelligence search performance sample", raw);
      latencies.push(performance.now() - start);
    }

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    console.log(`[BENCHMARK] Hybrid + Reranking -> count: ${REPETITIONS}, p50: ${p50.toFixed(2)}ms, p95: ${p95.toFixed(2)}ms`);
    assert.ok(p50 >= 0);
  });

  it("Context Construction with Token Budgeting benchmark", async () => {
    const mockCandidates: SearchResult[] = Array.from({ length: 50 }, (_, i) => ({
      chunkId: `c_${i}`,
      documentId: `d_${i}`,
      workspaceId,
      filename: `doc_${i}.pdf`,
      content: `This is chunk content index #${i}. Detailed context information for token budgeting benchmark.`,
      chunkIndex: i,
      pageNumber: i + 1,
      tokenCount: 25,
      similarity: 0.9 - i * 0.01,
      score: 0.9 - i * 0.01
    }));

    const latencies: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      buildRagContext(mockCandidates, { maxTokens: 1000 });
      latencies.push(performance.now() - start);
    }

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    console.log(`[BENCHMARK] Context Construction (Token Budgeting) -> count: 100, p50: ${p50.toFixed(3)}ms, p95: ${p95.toFixed(3)}ms`);
    assert.ok(p50 >= 0);
  });
});
