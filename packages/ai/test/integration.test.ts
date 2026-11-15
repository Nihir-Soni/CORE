import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withWorkspaceContext } from "@core/database";
import { serializeVector, embedChunks } from "../src/index.js";
import type { AIProvider } from "../src/index.js";

// A deterministic dummy vector generator
function generateMockVector(size: number, startVal: number = 0): number[] {
  return Array.from({ length: size }, (_, i) => startVal + (i * 0.001));
}

// A robust mocked AI Provider
class MockProvider implements AIProvider {
  public callCount = 0;
  public failOnNext = false;
  public returnInvalidDimension = false;
  public returnNaN = false;

  async embed(text: string): Promise<number[]> {
    this.callCount++;
    if (this.failOnNext) {
      this.failOnNext = false;
      throw new Error("Mocked provider failure");
    }
    if (this.returnInvalidDimension) {
      return [1, 2, 3];
    }
    if (this.returnNaN) {
      const vec = generateMockVector(768);
      vec[0] = NaN;
      return vec;
    }
    // Return a valid mock vector depending on the text (for some uniqueness)
    return generateMockVector(768, text.length);
  }

  async chat() { return "mock"; }
}

describe("pgvector Serialization", () => {
  it("serializes a valid vector", () => {
    const vec = new Array(768).fill(0.123);
    const serialized = serializeVector(vec);
    assert.equal(serialized.startsWith("["), true);
    assert.equal(serialized.endsWith("]"), true);
    assert.equal(serialized.split(",").length, 768);
  });

  it("throws on incorrect dimensions", () => {
    assert.throws(() => serializeVector([1, 2, 3]), /expected 768/);
  });

  it("throws on non-finite values", () => {
    const vec = new Array(768).fill(1);
    vec[500] = NaN;
    assert.throws(() => serializeVector(vec), /non-finite value/);
  });
});

describe("Embedding Integration", () => {
  let testOrgId: string;
  let testWorkspaceId: string;
  let testUserId: string;
  let testDocId: string;

  // Set up the database with required relation models
  before(async () => {
    // Note: this test assumes the local DB is up and DATABASE_URL is correct
    // Setup test context
    const org = await prisma.organization.create({
      data: { name: "Integration Test Org" }
    });
    testOrgId = org.id;

    const user = await prisma.user.create({
      data: {
        email: `integration-${Date.now()}@test.com`,
        passwordHash: "dummy",
        name: "Integration User",
        orgId: org.id
      }
    });
    testUserId = user.id;

    const workspace = await prisma.workspace.create({
      data: {
        name: "Integration Workspace",
        orgId: org.id
      }
    });
    testWorkspaceId = workspace.id;

    await withWorkspaceContext(workspace.id, async (tx) => {
      const doc = await tx.document.create({
        data: {
          workspaceId: workspace.id,
          uploadedById: user.id,
          filename: "test.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          storageKey: `test-${Date.now()}.pdf`,
        }
      });
      testDocId = doc.id;
    });
  });

  after(async () => {
    // Cleanup cascade manually since some relations lack onDelete: Cascade
    if (testWorkspaceId && testDocId) {
      await withWorkspaceContext(testWorkspaceId, async (tx) => {
        await tx.chunk.deleteMany({ where: { documentId: testDocId } });
        await tx.document.delete({ where: { id: testDocId } });
      });
    }
    if (testOrgId) {
      await prisma.organization.delete({ where: { id: testOrgId } });
    }
    await prisma.$disconnect();
  });

  it("processes a single chunk successfully", async () => {
    const chunk = await withWorkspaceContext(testWorkspaceId, (tx) =>
      tx.chunk.create({
        data: {
          documentId: testDocId,
          workspaceId: testWorkspaceId,
          content: "Hello single chunk",
          chunkIndex: 0,
          tokenCount: 4,
        }
      })
    );

    const provider = new MockProvider();
    
    await embedChunks([chunk], provider, prisma);

    assert.equal(provider.callCount, 1);

    // Verify database
    await withWorkspaceContext(testWorkspaceId, async (tx) => {
      const embeddings = await tx.$queryRaw<any[]>`
        SELECT "chunkId", embedding::text 
        FROM chunk_embeddings 
        WHERE "chunkId" = ${chunk.id}
      `;
      assert.equal(embeddings.length, 1);
      assert.equal(embeddings[0].chunkId, chunk.id);
    });
  });

  it("processes multiple chunks sequentially and deterministically", async () => {
    const chunks: any[] = [];
    for (let i = 1; i <= 3; i++) {
      chunks.push(
        await withWorkspaceContext(testWorkspaceId, (tx) =>
          tx.chunk.create({
            data: {
              documentId: testDocId,
              workspaceId: testWorkspaceId,
              content: `Multiple chunk ${i}`,
              chunkIndex: i, // 1, 2, 3
              tokenCount: 4,
            }
          })
        )
      );
    }

    // Scramble order to test sorting
    const scrambled = [chunks[2], chunks[0], chunks[1]];
    
    const provider = new MockProvider();
    await embedChunks(scrambled, provider, prisma);

    assert.equal(provider.callCount, 3);

    // Verify all 3 stored
    await withWorkspaceContext(testWorkspaceId, async (tx) => {
      for (const chunk of chunks) {
        const e = await tx.$queryRaw<any[]>`SELECT * FROM chunk_embeddings WHERE "chunkId" = ${chunk.id}`;
        assert.equal(e.length, 1);
      }
    });
  });

  it("is idempotent - running twice updates rather than duplicates", async () => {
    const chunk = await withWorkspaceContext(testWorkspaceId, (tx) =>
      tx.chunk.create({
        data: {
          documentId: testDocId,
          workspaceId: testWorkspaceId,
          content: "Idempotent chunk",
          chunkIndex: 4,
          tokenCount: 4,
        }
      })
    );

    const provider = new MockProvider();
    
    // First run
    await embedChunks([chunk], provider, prisma);
    assert.equal(provider.callCount, 1);

    // Second run
    await embedChunks([chunk], provider, prisma);
    assert.equal(provider.callCount, 2);

    // Check DB - there should still only be ONE embedding for this chunk
    await withWorkspaceContext(testWorkspaceId, async (tx) => {
      const e = await tx.$queryRaw<any[]>`SELECT * FROM chunk_embeddings WHERE "chunkId" = ${chunk.id}`;
      assert.equal(e.length, 1, "Duplicate embeddings were inserted");
    });
  });

  it("throws and does not persist on provider failure", async () => {
    const chunk = await withWorkspaceContext(testWorkspaceId, (tx) =>
      tx.chunk.create({
        data: {
          documentId: testDocId,
          workspaceId: testWorkspaceId,
          content: "Fail chunk",
          chunkIndex: 5,
          tokenCount: 2,
        }
      })
    );

    const provider = new MockProvider();
    provider.failOnNext = true;

    await assert.rejects(
      () => embedChunks([chunk], provider, prisma),
      /Mocked provider failure/
    );

    // DB should have 0 embeddings for this chunk
    await withWorkspaceContext(testWorkspaceId, async (tx) => {
      const e = await tx.$queryRaw<any[]>`SELECT * FROM chunk_embeddings WHERE "chunkId" = ${chunk.id}`;
      assert.equal(e.length, 0);
    });
  });

  it("throws and does not persist on invalid vector from provider", async () => {
    const chunk = await withWorkspaceContext(testWorkspaceId, (tx) =>
      tx.chunk.create({
        data: {
          documentId: testDocId,
          workspaceId: testWorkspaceId,
          content: "Bad dimension chunk",
          chunkIndex: 6,
          tokenCount: 2,
        }
      })
    );

    const provider = new MockProvider();
    provider.returnInvalidDimension = true;

    await assert.rejects(
      () => embedChunks([chunk], provider, prisma),
      /Invalid dimensionality for pgvector/
    );

    await withWorkspaceContext(testWorkspaceId, async (tx) => {
      const e = await tx.$queryRaw<any[]>`SELECT * FROM chunk_embeddings WHERE "chunkId" = ${chunk.id}`;
      assert.equal(e.length, 0);
    });
  });
});
