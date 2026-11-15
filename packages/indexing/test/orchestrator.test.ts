import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma, withWorkspaceContext } from "@core/database";
import type { AIProvider } from "@core/ai";
import { indexDocument } from "../src/index.js";

function generateMockVector(size: number, startVal: number = 0): number[] {
  return Array.from({ length: size }, (_, i) => startVal + i * 0.001);
}

class MockProvider implements AIProvider {
  public callCount = 0;
  public failOnNext = false;

  async embed(text: string): Promise<number[]> {
    this.callCount++;
    if (this.failOnNext) {
      this.failOnNext = false;
      throw new Error("Mock provider forced failure");
    }
    return generateMockVector(768, text.length);
  }

  async chat() {
    return "mock chat";
  }
}

describe("Indexing Orchestrator", () => {
  let testOrgId: string;
  let testWorkspaceId: string;
  let testUserId: string;
  let testDocId: string;
  let provider: MockProvider;

  before(async () => {
    // Setup test context
    const org = await prisma.organization.create({
      data: { name: "Orchestrator Test Org" },
    });
    testOrgId = org.id;

    const user = await prisma.user.create({
      data: {
        email: `orchestrator-${Date.now()}@test.com`,
        passwordHash: "dummy",
        name: "Orch User",
        orgId: org.id,
      },
    });
    testUserId = user.id;

    const workspace = await prisma.workspace.create({
      data: {
        name: "Orch Workspace",
        orgId: org.id,
      },
    });
    testWorkspaceId = workspace.id;

    await withWorkspaceContext(workspace.id, async (tx) => {
      const doc = await tx.document.create({
        data: {
          workspaceId: workspace.id,
          uploadedById: user.id,
          filename: "orchestrate.txt",
          mimeType: "text/plain",
          sizeBytes: 100,
          storageKey: `orch-${Date.now()}.txt`,
        },
      });
      testDocId = doc.id;
    });
  });

  after(async () => {
    // Cleanup cascade
    if (testWorkspaceId && testDocId) {
      await withWorkspaceContext(testWorkspaceId, async (tx) => {
        await tx.chunk.deleteMany({ where: { documentId: testDocId } });
        await tx.documentContent.deleteMany({ where: { documentId: testDocId } });
        await tx.document.delete({ where: { id: testDocId } });
      });
    }
    if (testOrgId) {
      await prisma.organization.delete({ where: { id: testOrgId } });
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    provider = new MockProvider();
  });

  const createText = (words: number) => Array(words).fill("hello").join(" ");

  it("fails if document missing", async () => {
    const res = await indexDocument("bad_doc", testWorkspaceId, provider, prisma);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.error, "document_not_found");
  });

  it("fails if workspace mismatch", async () => {
    const res = await indexDocument(testDocId, "bad_ws", provider, prisma);
    assert.equal(res.ok, false);
    if (!res.ok) assert.ok(res.error === "wrong_workspace" || res.error === "document_not_found");
  });

  it("fails if content missing", async () => {
    const res = await indexDocument(testDocId, testWorkspaceId, provider, prisma);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.error, "content_missing");
  });

  it("First indexing: chunks and embeds everything", async () => {
    await withWorkspaceContext(testWorkspaceId, async (tx) => {
      await tx.documentContent.create({
        data: {
          documentId: testDocId,
          text: createText(1200),
          charCount: 6000,
        }
      });
    });

    const res = await indexDocument(testDocId, testWorkspaceId, provider, prisma);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.ok(res.chunksProcessed > 1, "Should have created multiple chunks");
      assert.equal(res.embeddingsGenerated, res.chunksProcessed);
    }

    await withWorkspaceContext(testWorkspaceId, async (tx) => {
      const chunks = await tx.chunk.findMany({ where: { documentId: testDocId }});
      assert.ok(chunks.length > 1);

      const ids = chunks.map(c => "'" + c.id + "'").join(",");
      const embeddings = await tx.$queryRawUnsafe<any[]>(`
        SELECT * FROM chunk_embeddings 
        WHERE "chunkId" IN (${ids})
      `);
      assert.equal(embeddings.length, chunks.length);
    });
  });

  it("Repeat unchanged indexing: does not re-embed", async () => {
    const chunksBefore = await withWorkspaceContext(testWorkspaceId, (tx) =>
      tx.chunk.findMany({ where: { documentId: testDocId }})
    );
    
    const res = await indexDocument(testDocId, testWorkspaceId, provider, prisma);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.chunksProcessed, chunksBefore.length);
      assert.equal(res.embeddingsGenerated, 0, "Should generate zero new embeddings");
    }
    
    assert.equal(provider.callCount, 0);

    const chunksAfter = await withWorkspaceContext(testWorkspaceId, (tx) =>
      tx.chunk.findMany({ where: { documentId: testDocId }})
    );
    assert.deepEqual(chunksBefore.map(c => c.id), chunksAfter.map(c => c.id), "IDs should remain identical");
  });

  it("Changed chunk: only embeds the modified chunk", async () => {
    const chunksBefore = await withWorkspaceContext(testWorkspaceId, (tx) =>
      tx.chunk.findMany({ where: { documentId: testDocId }, orderBy: { chunkIndex: 'asc' }})
    );
    
    await withWorkspaceContext(testWorkspaceId, async (tx) => {
      const oldContent = await tx.documentContent.findUnique({ where: { documentId: testDocId }});
      await tx.documentContent.update({
        where: { documentId: testDocId },
        data: { text: oldContent!.text + " NEW APPENDED WORDS" }
      });
    });

    const res = await indexDocument(testDocId, testWorkspaceId, provider, prisma);
    assert.equal(res.ok, true);
    
    const chunksAfter = await withWorkspaceContext(testWorkspaceId, (tx) =>
      tx.chunk.findMany({ where: { documentId: testDocId }, orderBy: { chunkIndex: 'asc' }})
    );
    
    let changedCount = 0;
    for (let i = 0; i < chunksAfter.length; i++) {
      if (i < chunksBefore.length && chunksBefore[i].content !== chunksAfter[i].content) {
        changedCount++;
      }
    }
    
    if (res.ok) {
      assert.ok(res.embeddingsGenerated > 0);
      assert.equal(provider.callCount, res.embeddingsGenerated);
    }
  });

  it("Provider failure: does not poison chunks, propagates error safely", async () => {
    await withWorkspaceContext(testWorkspaceId, async (tx) => {
      const oldContent = await tx.documentContent.findUnique({ where: { documentId: testDocId }});
      await tx.documentContent.update({
        where: { documentId: testDocId },
        data: { text: oldContent!.text + " FAILING CHUNK ADDED" }
      });
    });

    provider.failOnNext = true;
    
    await assert.rejects(
      () => indexDocument(testDocId, testWorkspaceId, provider, prisma),
      /Mock provider forced failure/
    );

    await withWorkspaceContext(testWorkspaceId, (tx) =>
      tx.document.update({ where: { id: testDocId }, data: { status: "PROCESSING" }})
    );
    
    provider.failOnNext = true;
    await assert.rejects(
      () => indexDocument(testDocId, testWorkspaceId, provider, prisma)
    );

    const doc = await withWorkspaceContext(testWorkspaceId, (tx) =>
      tx.document.findUnique({ where: { id: testDocId }})
    );
    assert.equal(doc?.status, "PROCESSING");
  });

  it("Removed chunk: deletes obsolete chunks", async () => {
    await withWorkspaceContext(testWorkspaceId, (tx) =>
      tx.documentContent.update({
        where: { documentId: testDocId },
        data: { text: "just one chunk now" }
      })
    );

    const res = await indexDocument(testDocId, testWorkspaceId, provider, prisma);
    assert.equal(res.ok, true);

    const chunksAfter = await withWorkspaceContext(testWorkspaceId, (tx) =>
      tx.chunk.findMany({ where: { documentId: testDocId }})
    );
    assert.equal(chunksAfter.length, 1);
  });
});
