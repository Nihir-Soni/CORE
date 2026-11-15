import { describe, before, after, it } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";

import {
  prisma,
  withWorkspaceContext,
  DocumentRepository,
  DocumentContentRepository,
  ChunkRepository,
  ChunkEmbeddingRepository,
  ProcessingJobRepository,
  UploadSessionRepository,
  disconnectDatabase,
  type WorkspaceContext,
  type Prisma,
} from "../src/index.js";

describe("Phase 9.3 — End-to-End Application + Worker + PostgreSQL RLS Adversarial Verification", () => {
  let orgId: string;
  let userAId: string;
  let userBId: string;
  let workspaceA: WorkspaceContext;
  let workspaceB: WorkspaceContext;

  let docAId: string;
  let docBId: string;
  let jobAId: string;
  let jobBId: string;

  before(async () => {
    // Setup Organization
    const org = await prisma.organization.create({
      data: { name: `Phase9.3 Test Org ${randomUUID()}` },
    });
    orgId = org.id;

    // Setup User A
    const userA = await prisma.user.create({
      data: {
        email: `phase93_userA_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId,
      },
    });
    userAId = userA.id;

    // Setup User B
    const userB = await prisma.user.create({
      data: {
        email: `phase93_userB_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId,
      },
    });
    userBId = userB.id;

    // Setup Workspace A with User A as member
    const wsA = await prisma.workspace.create({
      data: {
        name: "Phase9.3 Workspace A",
        orgId,
        memberships: { create: { userId: userAId, role: "MEMBER" } },
      },
    });
    workspaceA = { workspaceId: wsA.id };

    // Setup Workspace B with User B as member
    const wsB = await prisma.workspace.create({
      data: {
        name: "Phase9.3 Workspace B",
        orgId,
        memberships: { create: { userId: userBId, role: "MEMBER" } },
      },
    });
    workspaceB = { workspaceId: wsB.id };

    // Setup Workspace A documents
    await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
      const docA = await tx.document.create({
        data: {
          workspaceId: workspaceA.workspaceId,
          uploadedById: userAId,
          filename: "alpha-document.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          storageKey: `phase93_alpha_${randomUUID()}`,
          sha256: `alpha_sha_${randomUUID()}`,
          status: "READY",
        },
      });
      docAId = docA.id;

      await tx.documentContent.create({
        data: {
          documentId: docAId,
          text: "ALPHA_PRIVATE_MARKER_12345 - This is Workspace A's private content",
          charCount: 70,
        },
      });

      const chunkA = await tx.chunk.create({
        data: {
          documentId: docAId,
          workspaceId: workspaceA.workspaceId,
          content: "ALPHA_PRIVATE_MARKER_12345 chunk content",
          chunkIndex: 0,
          tokenCount: 8,
        },
      });

      const dummyVectorA = "[" + new Array(768).fill(0.1).join(",") + "]";
      await tx.$executeRaw`
        INSERT INTO chunk_embeddings (id, "chunkId", embedding)
        VALUES (${randomUUID()}, ${chunkA.id}, ${dummyVectorA}::vector);
      `;

      const jobA = await tx.processingJob.create({
        data: {
          documentId: docAId,
          workspaceId: workspaceA.workspaceId,
          status: "COMPLETED",
        },
      });
      jobAId = jobA.id;
    });

    // Setup Workspace B documents
    await withWorkspaceContext(workspaceB.workspaceId, async (tx) => {
      const docB = await tx.document.create({
        data: {
          workspaceId: workspaceB.workspaceId,
          uploadedById: userBId,
          filename: "beta-document.pdf",
          mimeType: "application/pdf",
          sizeBytes: 200,
          storageKey: `phase93_beta_${randomUUID()}`,
          sha256: `beta_sha_${randomUUID()}`,
          status: "READY",
        },
      });
      docBId = docB.id;

      await tx.documentContent.create({
        data: {
          documentId: docBId,
          text: "BETA_PRIVATE_MARKER_67890 - This is Workspace B's private content",
          charCount: 70,
        },
      });

      const chunkB = await tx.chunk.create({
        data: {
          documentId: docBId,
          workspaceId: workspaceB.workspaceId,
          content: "BETA_PRIVATE_MARKER_67890 chunk content",
          chunkIndex: 0,
          tokenCount: 8,
        },
      });

      const dummyVectorB = "[" + new Array(768).fill(0.9).join(",") + "]";
      await tx.$executeRaw`
        INSERT INTO chunk_embeddings (id, "chunkId", embedding)
        VALUES (${randomUUID()}, ${chunkB.id}, ${dummyVectorB}::vector);
      `;

      const jobB = await tx.processingJob.create({
        data: {
          documentId: docBId,
          workspaceId: workspaceB.workspaceId,
          status: "COMPLETED",
        },
      });
      jobBId = jobB.id;
    });
  });

  after(async () => {
    // Cleanup
    for (const wsId of [workspaceA.workspaceId, workspaceB.workspaceId]) {
      await withWorkspaceContext(wsId, async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`DELETE FROM chunk_embeddings WHERE "chunkId" IN (SELECT id FROM chunks WHERE "workspaceId" = ${wsId})`;
        await tx.$executeRaw`DELETE FROM chunks WHERE "workspaceId" = ${wsId}`;
        await tx.$executeRaw`DELETE FROM "DocumentContent" WHERE "documentId" IN (SELECT id FROM "Document" WHERE "workspaceId" = ${wsId})`;
        await tx.$executeRaw`DELETE FROM processing_jobs WHERE "workspaceId" = ${wsId}`;
        await tx.$executeRaw`DELETE FROM upload_sessions WHERE "workspaceId" = ${wsId}`;
        await tx.$executeRaw`DELETE FROM "Document" WHERE "workspaceId" = ${wsId}`;
      });
    }
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceA.workspaceId, workspaceB.workspaceId] } }
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userAId, userBId] } }
    });
    await prisma.organization.deleteMany({
      where: { id: orgId }
    });
    await disconnectDatabase();
  });

  describe("9.3.3 — Document Lifecycle + Worker Isolation", () => {
    it("Workspace A can process Document A (valid combination)", async () => {
      const doc = await DocumentRepository.findById(workspaceA, docAId);
      assert.ok(doc);
      assert.strictEqual(doc.workspaceId, workspaceA.workspaceId);
      assert.strictEqual(doc.id, docAId);
    });

    it("Workspace B can process Document B (valid combination)", async () => {
      const doc = await DocumentRepository.findById(workspaceB, docBId);
      assert.ok(doc);
      assert.strictEqual(doc.workspaceId, workspaceB.workspaceId);
      assert.strictEqual(doc.id, docBId);
    });

    it("Adversarial: Workspace A cannot access Document B", async () => {
      const doc = await DocumentRepository.findById(workspaceA, docBId);
      assert.strictEqual(doc, null);
    });

    it("Adversarial: Workspace B cannot access Document A", async () => {
      const doc = await DocumentRepository.findById(workspaceB, docAId);
      assert.strictEqual(doc, null);
    });

    it("Adversarial: Worker simulation - documentId A with workspaceId B should fail", async () => {
      // Simulate what would happen if worker received mismatched data
      const ctx = { workspaceId: workspaceB.workspaceId };
      const doc = await DocumentRepository.findById(ctx, docAId);
      
      // This should return null because document A belongs to workspace A
      assert.strictEqual(doc, null);
    });
  });

  describe("9.3.4 — ProcessingJob Integrity", () => {
    it("Valid workspace/document/job combination works", async () => {
      const job = await ProcessingJobRepository.findById(workspaceA, jobAId);
      assert.ok(job);
      assert.strictEqual(job.workspaceId, workspaceA.workspaceId);
      assert.strictEqual(job.documentId, docAId);
    });

    it("Wrong workspace job access denied", async () => {
      const job = await ProcessingJobRepository.findById(workspaceB, jobAId);
      assert.strictEqual(job, null);
    });

    it("Nonexistent document job handling", async () => {
      const fakeJobId = randomUUID();
      const job = await ProcessingJobRepository.findById(workspaceA, fakeJobId);
      assert.strictEqual(job, null);
    });

    it("Job update isolated to correct workspace", async () => {
      const updated = await ProcessingJobRepository.update(workspaceA, jobAId, {
        progressMessage: "Test update A",
      });
      assert.ok(updated);
      assert.strictEqual(updated?.workspaceId, workspaceA.workspaceId);

      // Verify B cannot update A's job
      const blockedUpdate = await ProcessingJobRepository.update(workspaceB, jobAId, {
        progressMessage: "Should not work",
      });
      assert.strictEqual(blockedUpdate, null);
    });
  });

  describe("9.3.6 — Extraction + Chunking + Embedding Isolation", () => {
    it("Document content isolated by parent document workspace", async () => {
      const contentA = await DocumentContentRepository.findByDocumentId(workspaceA, docAId);
      assert.ok(contentA);
      assert.ok(contentA.text.includes("ALPHA_PRIVATE_MARKER_12345"));

      const contentB = await DocumentContentRepository.findByDocumentId(workspaceA, docBId);
      assert.strictEqual(contentB, null);
    });

    it("Chunks cannot be read cross-workspace", async () => {
      const chunksA = await ChunkRepository.findByDocumentId(workspaceA, docAId);
      assert.ok(chunksA.length > 0);
      assert.ok(chunksA[0].content.includes("ALPHA_PRIVATE_MARKER_12345"));

      const chunksB_In_A = await ChunkRepository.findByDocumentId(workspaceA, docBId);
      assert.strictEqual(chunksB_In_A.length, 0);
    });

    it("Embeddings cannot be read cross-workspace", async () => {
      const chunksA = await ChunkRepository.findByDocumentId(workspaceA, docAId);
      if (chunksA.length > 0) {
        const embeddingA = await ChunkEmbeddingRepository.findByChunkId(workspaceA, chunksA[0].id);
        assert.ok(embeddingA);
      }

      const chunksB = await ChunkRepository.findByDocumentId(workspaceB, docBId);
      if (chunksB.length > 0) {
        const embeddingB_In_A = await ChunkEmbeddingRepository.findByChunkId(workspaceA, chunksB[0].id);
        assert.strictEqual(embeddingB_In_A, null);
      }
    });

    it("Cross-workspace content markers verified", async () => {
      const contentA = await DocumentContentRepository.findByDocumentId(workspaceA, docAId);
      assert.ok(contentA);
      assert.ok(contentA.text.includes("ALPHA_PRIVATE_MARKER_12345"));
      assert.ok(!contentA.text.includes("BETA_PRIVATE_MARKER_67890"));

      const contentB = await DocumentContentRepository.findByDocumentId(workspaceB, docBId);
      assert.ok(contentB);
      assert.ok(contentB.text.includes("BETA_PRIVATE_MARKER_67890"));
      assert.ok(!contentB.text.includes("ALPHA_PRIVATE_MARKER_12345"));
    });
  });

  describe("9.3.7 — Raw Vector Retrieval Isolation", () => {
    it("ALPHA workspace can retrieve ALPHA content only", async () => {
      const chunksA = await ChunkRepository.findByDocumentId(workspaceA, docAId);
      assert.ok(chunksA.length > 0);
      assert.ok(chunksA[0].content.includes("ALPHA_PRIVATE_MARKER_12345"));
      assert.ok(!chunksA[0].content.includes("BETA_PRIVATE_MARKER_67890"));
    });

    it("BETA workspace can retrieve BETA content only", async () => {
      const chunksB = await ChunkRepository.findByDocumentId(workspaceB, docBId);
      assert.ok(chunksB.length > 0);
      assert.ok(chunksB[0].content.includes("BETA_PRIVATE_MARKER_67890"));
      assert.ok(!chunksB[0].content.includes("ALPHA_PRIVATE_MARKER_12345"));
    });

    it("Raw pgvector query under workspace context is isolated", async () => {
      // Test that raw vector queries respect workspace context
      // Use a 768-dimensional vector to match the actual embedding dimensions
      const searchVector = "[" + new Array(768).fill(0.1).join(",") + "]";
      
      await withWorkspaceContext(workspaceA.workspaceId, async (tx: Prisma.TransactionClient) => {
        const results = await tx.$queryRaw<any[]>`
          SELECT c.content, c."workspaceId"
          FROM chunk_embeddings ce
          JOIN chunks c ON c.id = ce."chunkId"
          ORDER BY ce.embedding <=> ${searchVector}::vector ASC
          LIMIT 10;
        `;
        
        // All results should be from workspace A only
        for (const row of results) {
          assert.strictEqual(row.workspaceId, workspaceA.workspaceId);
          if (row.content.includes("ALPHA_PRIVATE_MARKER_12345") || 
              row.content.includes("BETA_PRIVATE_MARKER_67890")) {
            assert.ok(row.content.includes("ALPHA_PRIVATE_MARKER_12345"));
            assert.ok(!row.content.includes("BETA_PRIVATE_MARKER_67890"));
          }
        }
      });
    });
  });

  describe("9.3.11 — Concurrent Workspace Context / Pool Safety", () => {
    it("Concurrent A and B operations remain isolated", async () => {
      const operations = [];
      
      // Interleave A and B operations
      for (let i = 0; i < 10; i++) {
        operations.push(
          withWorkspaceContext(workspaceA.workspaceId, async (tx: Prisma.TransactionClient) => {
            const docs = await tx.document.findMany({
              where: { id: docAId },
            });
            assert.strictEqual(docs.length, 1);
            assert.strictEqual(docs[0].workspaceId, workspaceA.workspaceId);
          })
        );
        
        operations.push(
          withWorkspaceContext(workspaceB.workspaceId, async (tx: Prisma.TransactionClient) => {
            const docs = await tx.document.findMany({
              where: { id: docBId },
            });
            assert.strictEqual(docs.length, 1);
            assert.strictEqual(docs[0].workspaceId, workspaceB.workspaceId);
          })
        );
      }
      
      await Promise.all(operations);
    });

    it("Failed transaction does not contaminate subsequent operations", async () => {
      // First, a failing transaction in workspace A
      try {
        await withWorkspaceContext(workspaceA.workspaceId, async (tx: Prisma.TransactionClient) => {
          await tx.document.findUnique({ where: { id: docAId } });
          throw new Error("Intentional failure");
        });
      } catch (e) {
        // Expected to fail
      }

      // Subsequent A operation should still work correctly
      const docAfterFail = await DocumentRepository.findById(workspaceA, docAId);
      assert.ok(docAfterFail);
      assert.strictEqual(docAfterFail.workspaceId, workspaceA.workspaceId);

      // B operation should also work correctly
      const docBAfterFail = await DocumentRepository.findById(workspaceB, docBId);
      assert.ok(docBAfterFail);
      assert.strictEqual(docBAfterFail.workspaceId, workspaceB.workspaceId);
    });
  });

  describe("9.3.12 — Direct PostgreSQL RLS Verification", () => {
    it("No workspace context: access fails / returns no rows", async () => {
      const docs = await prisma.$queryRaw<any[]>`
        SELECT * FROM "Document" WHERE id IN (${docAId}, ${docBId})
      `;
      assert.strictEqual(docs.length, 0);
    });

    it("Workspace A context: only A rows visible", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx: Prisma.TransactionClient) => {
        const docs = await tx.$queryRaw<any[]>`
          SELECT * FROM "Document" WHERE id IN (${docAId}, ${docBId})
        `;
        assert.strictEqual(docs.length, 1);
        assert.strictEqual(docs[0].id, docAId);
        assert.strictEqual(docs[0].workspaceId, workspaceA.workspaceId);
      });
    });

    it("Workspace B context: only B rows visible", async () => {
      await withWorkspaceContext(workspaceB.workspaceId, async (tx: Prisma.TransactionClient) => {
        const docs = await tx.$queryRaw<any[]>`
          SELECT * FROM "Document" WHERE id IN (${docAId}, ${docBId})
        `;
        assert.strictEqual(docs.length, 1);
        assert.strictEqual(docs[0].id, docBId);
        assert.strictEqual(docs[0].workspaceId, workspaceB.workspaceId);
      });
    });

    it("Attempted cross-workspace INSERT is rejected", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx: Prisma.TransactionClient) => {
        await assert.rejects(
          async () => {
            await tx.$executeRaw`
              INSERT INTO "Document" (id, "workspaceId", "uploadedById", filename, "mimeType", "sizeBytes", "storageKey", status)
              VALUES (${randomUUID()}, ${workspaceB.workspaceId}, ${userAId}, 'evil.pdf', 'application/pdf', 10, ${`evil_${randomUUID()}`}, 'READY');
            `;
          },
          (err: any) => err.message.includes("row-level security policy") || err.code === "42501"
        );
      });
    });

    it("Attempted cross-workspace UPDATE is rejected", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx: Prisma.TransactionClient) => {
        const count = await tx.$executeRaw`
          UPDATE "Document" SET filename = 'hacked.pdf' WHERE id = ${docBId};
        `;
        assert.strictEqual(count, 0);
      });
    });

    it("Attempted cross-workspace DELETE is rejected", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx: Prisma.TransactionClient) => {
        const count = await tx.$executeRaw`
          DELETE FROM "Document" WHERE id = ${docBId};
        `;
        assert.strictEqual(count, 0);
      });
    });

    it("Parent/child tables remain isolated", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx: Prisma.TransactionClient) => {
        // DocumentContent isolation via parent Document
        const content = await tx.$queryRaw<any[]>`
          SELECT * FROM "DocumentContent" WHERE "documentId" IN (${docAId}, ${docBId})
        `;
        assert.strictEqual(content.length, 1);
        assert.strictEqual(content[0].documentId, docAId);

        // ChunkEmbedding isolation via parent Chunk
        const embeddings = await tx.$queryRaw<any[]>`
          SELECT ce.* FROM chunk_embeddings ce
          JOIN chunks c ON c.id = ce."chunkId"
          WHERE c."documentId" IN (${docAId}, ${docBId})
        `;
        assert.ok(embeddings.length > 0);
        for (const emb of embeddings) {
          const chunk = await tx.chunk.findUnique({ where: { id: emb.chunkId } });
          assert.strictEqual(chunk?.workspaceId, workspaceA.workspaceId);
        }
      });
    });
  });
});