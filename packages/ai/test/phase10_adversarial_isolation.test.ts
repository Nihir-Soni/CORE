import { describe, before, after, it } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma, withWorkspaceContext } from "@core/database";
import type { AIProvider } from "../src/types.js";
import { searchHybridChunks, searchSimilarChunks } from "../src/search.js";
import { rerankSearchResults } from "../src/rerank.js";
import { embedChunks } from "../src/integration.js";

class AdversarialMockProvider implements AIProvider {
  async embed(text: string): Promise<number[]> {
    const vec = new Array(768).fill(0.01);
    const val = parseFloat(text);
    vec[0] = !isNaN(val) ? val : text.length;

    // Normalise
    const sqSum = vec.reduce((sum, v) => sum + v * v, 0);
    const mag = Math.sqrt(sqSum);
    return vec.map(v => v / mag);
  }

  async chat() {
    return "mock response";
  }
}

describe("Phase 10 Mandatory Adversarial Workspace Isolation Test", () => {
  let orgId: string;
  let workspaceA: string;
  let workspaceB: string;
  let userId: string;

  let docA_ID: string;
  let docB_ID: string;
  let provider: AdversarialMockProvider;

  before(async () => {
    provider = new AdversarialMockProvider();

    const org = await prisma.organization.create({
      data: { name: "Adversarial Test Org " + randomUUID() }
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        email: `adv_isolation_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId
      }
    });
    userId = user.id;

    const wsA = await prisma.workspace.create({
      data: { name: "Workspace A (Target)", orgId }
    });
    workspaceA = wsA.id;

    const wsB = await prisma.workspace.create({
      data: { name: "Workspace B (Adversary)", orgId }
    });
    workspaceB = wsB.id;

    // Workspace A: Mildly matching text for "secret password"
    const chunksA = await withWorkspaceContext(workspaceA, async (tx) => {
      const docA = await tx.document.create({
        data: {
          workspaceId: workspaceA,
          uploadedById: userId,
          filename: "DocA.txt",
          mimeType: "text/plain",
          sizeBytes: 100,
          storageKey: `test/adv_a_${randomUUID()}.txt`,
          status: "READY"
        }
      });
      docA_ID = docA.id;

      const c1 = await tx.chunk.create({
        data: {
          documentId: docA_ID,
          workspaceId: workspaceA,
          content: "The password might be related to access controls.",
          chunkIndex: 0,
          tokenCount: 8
        }
      });
      return [c1];
    });

    await embedChunks(chunksA, provider, prisma, { workspaceId: workspaceA });

    // Workspace B: Perfect, exact, high-score match for "secret password"
    const chunksB = await withWorkspaceContext(workspaceB, async (tx) => {
      const docB = await tx.document.create({
        data: {
          workspaceId: workspaceB,
          uploadedById: userId,
          filename: "DocB_Secret.txt",
          mimeType: "text/plain",
          sizeBytes: 100,
          storageKey: `test/adv_b_${randomUUID()}.txt`,
          status: "READY"
        }
      });
      docB_ID = docB.id;

      const c1 = await tx.chunk.create({
        data: {
          documentId: docB_ID,
          workspaceId: workspaceB,
          content: "secret password EXACT MATCH super confidential data 100%",
          chunkIndex: 0,
          tokenCount: 8
        }
      });
      return [c1];
    });

    await embedChunks(chunksB, provider, prisma, { workspaceId: workspaceB });
  });

  const modes = ["vector", "text", "hybrid"] as const;

  for (const mode of modes) {
    it(`Querying as Workspace A in ${mode} mode NEVER returns Workspace B chunks`, async () => {
      const results = await searchHybridChunks({
        query: "secret password EXACT MATCH super confidential",
        workspaceId: workspaceA,
        provider,
        prisma,
        topK: 10,
        mode
      });

      for (const res of results) {
        assert.strictEqual(res.workspaceId, workspaceA, `Leak detected: returned workspace ${res.workspaceId}`);
        assert.notStrictEqual(res.workspaceId, workspaceB, `CRITICAL SECURITY LEAK: Workspace B chunk returned!`);
        assert.notStrictEqual(res.documentId, docB_ID, `CRITICAL SECURITY LEAK: Document B returned!`);
      }
    });

    it(`Querying as Workspace B in ${mode} mode NEVER returns Workspace A chunks`, async () => {
      const results = await searchHybridChunks({
        query: "password access controls",
        workspaceId: workspaceB,
        provider,
        prisma,
        topK: 10,
        mode
      });

      for (const res of results) {
        assert.strictEqual(res.workspaceId, workspaceB, `Leak detected: returned workspace ${res.workspaceId}`);
        assert.notStrictEqual(res.workspaceId, workspaceA, `CRITICAL SECURITY LEAK: Workspace A chunk returned!`);
        assert.notStrictEqual(res.documentId, docA_ID, `CRITICAL SECURITY LEAK: Document A returned!`);
      }
    });
  }

  it("Reranked retrieval as Workspace A NEVER includes Workspace B chunks", async () => {
    const rawResults = await searchHybridChunks({
      query: "secret password EXACT MATCH",
      workspaceId: workspaceA,
      provider,
      prisma,
      topK: 10,
      mode: "hybrid"
    });

    const reranked = await rerankSearchResults("secret password EXACT MATCH", rawResults);

    for (const res of reranked) {
      assert.strictEqual(res.workspaceId, workspaceA);
      assert.notStrictEqual(res.workspaceId, workspaceB);
      assert.notStrictEqual(res.documentId, docB_ID);
    }
  });

  it("PostgreSQL RLS raw query bypass attempt fails to read Workspace B chunks under Workspace A context", async () => {
    // Attempting a raw SQL query that intentionally omits the WHERE workspaceId filter,
    // relying strictly on PostgreSQL RLS session setting
    const rawResults = await withWorkspaceContext(workspaceA, async (db) => {
      return db.$queryRaw<Array<{ id: string; workspaceId: string }>>`
        SELECT id, "workspaceId" FROM chunks WHERE "documentId" = ${docB_ID};
      `;
    });

    // RLS must filter out Workspace B row completely
    assert.strictEqual(rawResults.length, 0, "RLS failed to block cross-workspace raw SQL access!");
  });
});
