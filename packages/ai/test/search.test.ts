import { test, describe, before, after, it } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma, withWorkspaceContext } from "@core/database";
import type { AIProvider } from "../src/types.js";
import { searchSimilarChunks } from "../src/search.js";
import { embedChunks } from "../src/integration.js";

class SearchMockProvider implements AIProvider {
  public failOnNext = false;
  public embedCalls: string[] = [];

  async embed(text: string): Promise<number[]> {
    if (this.failOnNext) {
      this.failOnNext = false;
      throw new Error("Forced mock provider failure");
    }
    this.embedCalls.push(text);

    const vec = new Array(768).fill(0.01);
    const val = parseFloat(text);
    // If text is a number string, use it. Otherwise use length.
    vec[0] = !isNaN(val) ? val : text.length;
    
    // L2 norm
    const sqSum = vec.reduce((sum, v) => sum + v * v, 0);
    const mag = Math.sqrt(sqSum);
    return vec.map(v => v / mag);
  }

  async chat() {
    return "mock";
  }
}

describe("Vector Similarity Search (Phase 4.5A)", () => {
  let orgId: string;
  let workspaceA: string;
  let workspaceB: string;
  let userId: string;
  
  let docA_ID: string;
  let docB_ID: string;

  let provider: SearchMockProvider;

  before(async () => {
    provider = new SearchMockProvider();

    // Setup User, Org, Workspaces
    const org = await prisma.organization.create({
      data: { name: "Search Test Org " + randomUUID() }
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        email: `search_test_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId
      }
    });
    userId = user.id;

    const wsA = await prisma.workspace.create({
      data: { name: "Workspace A (Search)", orgId }
    });
    workspaceA = wsA.id;

    const wsB = await prisma.workspace.create({
      data: { name: "Workspace B (Search)", orgId }
    });
    workspaceB = wsB.id;

    // Document A & Chunks A in Workspace A
    const chunksA = await withWorkspaceContext(workspaceA, async (tx) => {
      const docA = await tx.document.create({
        data: {
          workspaceId: workspaceA,
          uploadedById: userId,
          filename: "Search_Doc_A.txt",
          mimeType: "text/plain",
          sizeBytes: 100,
          storageKey: `test/search_a_${randomUUID()}.txt`,
          status: "READY"
        }
      });
      docA_ID = docA.id;

      const c1 = await tx.chunk.create({
        data: { documentId: docA_ID, workspaceId: workspaceA, content: "10", chunkIndex: 0, tokenCount: 1, pageNumber: 1 }
      });
      const c2 = await tx.chunk.create({
        data: { documentId: docA_ID, workspaceId: workspaceA, content: "5", chunkIndex: 1, tokenCount: 1 }
      });
      const c3 = await tx.chunk.create({
        data: { documentId: docA_ID, workspaceId: workspaceA, content: "2", chunkIndex: 2, tokenCount: 1 }
      });
      return [c1, c2, c3];
    });

    // Embed chunks A
    await embedChunks(chunksA, provider, prisma, { workspaceId: workspaceA });

    // Document B & Chunks B in Workspace B
    const chunksB = await withWorkspaceContext(workspaceB, async (tx) => {
      const docB = await tx.document.create({
        data: {
          workspaceId: workspaceB,
          uploadedById: userId,
          filename: "Search_Doc_B.txt",
          mimeType: "text/plain",
          sizeBytes: 100,
          storageKey: `test/search_b_${randomUUID()}.txt`,
          status: "READY"
        }
      });
      docB_ID = docB.id;

      const c1 = await tx.chunk.create({
        data: { documentId: docB_ID, workspaceId: workspaceB, content: "10", chunkIndex: 0, tokenCount: 1 }
      });
      return [c1];
    });
    
    // Embed chunks B
    await embedChunks(chunksB, provider, prisma, { workspaceId: workspaceB });

    // Create a chunk in Workspace A that has NO embedding (missing embeddings should be ignored)
    await withWorkspaceContext(workspaceA, async (tx) => {
      await tx.chunk.create({
        data: { documentId: docA_ID, workspaceId: workspaceA, content: "999", chunkIndex: 3, tokenCount: 1 }
      });
    });
    
    // Reset call tracker
    provider.embedCalls = [];
  });

  after(async () => {
    // Optional cleanup
  });

  it("1. Query embedding generates correctly", async () => {
    provider.embedCalls = [];
    const results = await searchSimilarChunks({
      query: "10",
      workspaceId: workspaceA,
      provider,
      prisma
    });
    
    assert.strictEqual(provider.embedCalls.length, 1);
    assert.strictEqual(provider.embedCalls[0], "10");
    assert.ok(results.length > 0);
  });

  it("2. Empty query returns [] without network or DB calls", async () => {
    provider.embedCalls = [];
    const results = await searchSimilarChunks({
      query: "   \n  ", // whitespace only
      workspaceId: workspaceA,
      provider,
      prisma
    });
    
    assert.strictEqual(results.length, 0);
    assert.strictEqual(provider.embedCalls.length, 0);
  });

  it("3. Top-K is bounded and applied", async () => {
    // Workspace A has 3 valid chunks embedded
    const allResults = await searchSimilarChunks({ query: "10", workspaceId: workspaceA, provider, prisma, topK: 10 });
    assert.strictEqual(allResults.length, 3);

    const limResults = await searchSimilarChunks({ query: "10", workspaceId: workspaceA, provider, prisma, topK: 2 });
    assert.strictEqual(limResults.length, 2);

    // Top K < 1 bounds to 1
    const boundResults = await searchSimilarChunks({ query: "10", workspaceId: workspaceA, provider, prisma, topK: -5 });
    assert.strictEqual(boundResults.length, 1);
  });

  it("4. Similarity ordering", async () => {
    // If we search '10', the chunk with '10' should be closest, then '5', then '2'.
    const results = await searchSimilarChunks({ query: "10", workspaceId: workspaceA, provider, prisma, topK: 3 });
    
    assert.strictEqual(results[0].content, "10");
    assert.strictEqual(results[1].content, "5");
    assert.strictEqual(results[2].content, "2");
    
    // Validate similarity is a number and monotonically decreasing
    assert.ok(typeof results[0].similarity === 'number');
    assert.ok(results[0].similarity >= results[1].similarity);
    assert.ok(results[1].similarity >= results[2].similarity);
  });

  it("5. Workspace isolation (CRITICAL)", async () => {
    // Workspace B has a chunk '10' that perfectly matches, but if we search Workspace A, we shouldn't see it
    const resultsA = await searchSimilarChunks({ query: "10", workspaceId: workspaceA, provider, prisma });
    
    for (const r of resultsA) {
      assert.strictEqual(r.workspaceId, workspaceA);
      assert.notStrictEqual(r.workspaceId, workspaceB);
    }
    assert.strictEqual(resultsA.find(r => r.documentId === docB_ID), undefined);
  });

  it("6. Metadata is returned correctly", async () => {
    const results = await searchSimilarChunks({ query: "10", workspaceId: workspaceA, provider, prisma, topK: 1 });
    const top = results[0];
    
    assert.strictEqual(top.documentId, docA_ID);
    assert.strictEqual(top.workspaceId, workspaceA);
    assert.strictEqual(top.filename, "Search_Doc_A.txt");
    assert.strictEqual(top.content, "10");
    assert.strictEqual(top.chunkIndex, 0);
    assert.strictEqual(top.pageNumber, 1); // We set it to 1
    assert.strictEqual(top.tokenCount, 1);
    assert.ok(typeof top.similarity === 'number');
  });

  it("7. Missing embeddings are safely ignored", async () => {
    // We inserted chunk '999' but never embedded it. It shouldn't crash or return.
    const results = await searchSimilarChunks({ query: "999", workspaceId: workspaceA, provider, prisma });
    const missing = results.find(r => r.content === "999");
    assert.strictEqual(missing, undefined);
  });

  it("8. Provider failure fails cleanly", async () => {
    provider.failOnNext = true;
    await assert.rejects(
      async () => {
        await searchSimilarChunks({ query: "10", workspaceId: workspaceA, provider, prisma });
      },
      /Forced mock provider failure/
    );
  });

  it("10. Empty workspace returns []", async () => {
    // Create an empty workspace
    const org = await prisma.organization.create({ data: { name: "Empty " + randomUUID() } });
    const wsEmpty = await prisma.workspace.create({ data: { name: "Empty WS", orgId: org.id } });
    
    const results = await searchSimilarChunks({ query: "10", workspaceId: wsEmpty.id, provider, prisma });
    assert.strictEqual(results.length, 0);
  });

  it("11. Non-READY documents are strictly excluded from retrieval", async () => {
    let unreadyDocId: string = "";
    // Create a non-READY document (PROCESSING) with chunks and embeddings
    const nonReadyChunks = await withWorkspaceContext(workspaceA, async (tx) => {
      const docProcessing = await tx.document.create({
        data: {
          workspaceId: workspaceA,
          uploadedById: userId,
          filename: "Unready_Doc.txt",
          mimeType: "text/plain",
          sizeBytes: 100,
          storageKey: `test/unready_${randomUUID()}.txt`,
          status: "PROCESSING"
        }
      });
      unreadyDocId = docProcessing.id;
      const c1 = await tx.chunk.create({
        data: { documentId: docProcessing.id, workspaceId: workspaceA, content: "unique_unready_keyword", chunkIndex: 0, tokenCount: 1 }
      });
      return [c1];
    });

    await embedChunks(nonReadyChunks, provider, prisma, { workspaceId: workspaceA });

    // Text search mode: non-READY document chunk must not be returned
    const textRes = await searchSimilarChunks({ query: "unique_unready_keyword", workspaceId: workspaceA, provider, prisma, mode: "text" });
    assert.strictEqual(textRes.find(r => r.documentId === unreadyDocId), undefined);

    // Vector search mode: non-READY document chunk must not be returned
    const vecRes = await searchSimilarChunks({ query: "unique_unready_keyword", workspaceId: workspaceA, provider, prisma, mode: "vector" });
    assert.strictEqual(vecRes.find(r => r.documentId === unreadyDocId), undefined);

    // Hybrid search mode: non-READY document chunk must not be returned
    const hybridRes = await searchSimilarChunks({ query: "unique_unready_keyword", workspaceId: workspaceA, provider, prisma, mode: "hybrid" });
    assert.strictEqual(hybridRes.find(r => r.documentId === unreadyDocId), undefined);
  });
});
