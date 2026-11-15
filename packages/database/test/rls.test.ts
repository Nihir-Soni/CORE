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
} from "../src/index.js";

describe("Phase 9.2 — PostgreSQL Row-Level Security (RLS) Database & Integration Tests", () => {
  let orgId: string;
  let userId: string;
  let workspaceA: WorkspaceContext;
  let workspaceB: WorkspaceContext;

  let docAId: string;
  let docBId: string;
  let chunkAId: string;
  let chunkBId: string;
  let jobAId: string;
  let jobBId: string;
  let sessionAId: string;
  let sessionBId: string;

  before(async () => {
    // 1. Setup Org and User
    const org = await prisma.organization.create({
      data: { name: `RLS Test Org ${randomUUID()}` },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        email: `rls_test_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId,
      },
    });
    userId = user.id;

    // 2. Setup Workspace A
    const wsA = await prisma.workspace.create({
      data: {
        name: "RLS Workspace A",
        orgId,
        memberships: { create: { userId, role: "MEMBER" } },
      },
    });
    workspaceA = { workspaceId: wsA.id };

    // 3. Setup Workspace B
    const wsB = await prisma.workspace.create({
      data: {
        name: "RLS Workspace B",
        orgId,
        memberships: { create: { userId, role: "MEMBER" } },
      },
    });
    workspaceB = { workspaceId: wsB.id };

    // 4. Populate Workspace A test records
    await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
      const docA = await tx.document.create({
        data: {
          workspaceId: workspaceA.workspaceId,
          uploadedById: userId,
          filename: "alpha-doc.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          storageKey: `key_${randomUUID()}`,
          sha256: `sha_${randomUUID()}`,
          status: "READY",
        },
      });
      docAId = docA.id;

      await tx.documentContent.create({
        data: {
          documentId: docAId,
          text: "ALPHA-TENANT-SECRET-123",
          charCount: 23,
        },
      });

      const chunkA = await tx.chunk.create({
        data: {
          documentId: docAId,
          workspaceId: workspaceA.workspaceId,
          content: "ALPHA-TENANT-SECRET-123 chunk text",
          chunkIndex: 0,
          tokenCount: 5,
        },
      });
      chunkAId = chunkA.id;

      const dummyVectorHex = "[" + new Array(768).fill(0.1).join(",") + "]";
      await tx.$executeRaw`
        INSERT INTO chunk_embeddings (id, "chunkId", embedding)
        VALUES (${randomUUID()}, ${chunkAId}, ${dummyVectorHex}::vector);
      `;

      const jobA = await tx.processingJob.create({
        data: {
          documentId: docAId,
          workspaceId: workspaceA.workspaceId,
          status: "COMPLETED",
        },
      });
      jobAId = jobA.id;

      const sessionA = await tx.uploadSession.create({
        data: {
          documentId: docAId,
          workspaceId: workspaceA.workspaceId,
          uploadId: `upload_${randomUUID()}`,
          storageKey: `key_${randomUUID()}`,
          filename: "alpha-doc.pdf",
          mimeType: "application/pdf",
          sizeBytes: BigInt(100),
          partSizeBytes: 100,
          totalParts: 1,
        },
      });
      sessionAId = sessionA.id;
    });

    // 5. Populate Workspace B test records
    await withWorkspaceContext(workspaceB.workspaceId, async (tx) => {
      const docB = await tx.document.create({
        data: {
          workspaceId: workspaceB.workspaceId,
          uploadedById: userId,
          filename: "beta-doc.pdf",
          mimeType: "application/pdf",
          sizeBytes: 200,
          storageKey: `key_${randomUUID()}`,
          sha256: `sha_${randomUUID()}`,
          status: "READY",
        },
      });
      docBId = docB.id;

      await tx.documentContent.create({
        data: {
          documentId: docBId,
          text: "BETA-TENANT-SECRET-456",
          charCount: 22,
        },
      });

      const chunkB = await tx.chunk.create({
        data: {
          documentId: docBId,
          workspaceId: workspaceB.workspaceId,
          content: "BETA-TENANT-SECRET-456 chunk text",
          chunkIndex: 0,
          tokenCount: 5,
        },
      });
      chunkBId = chunkB.id;

      const dummyVectorHex = "[" + new Array(768).fill(0.9).join(",") + "]";
      await tx.$executeRaw`
        INSERT INTO chunk_embeddings (id, "chunkId", embedding)
        VALUES (${randomUUID()}, ${chunkBId}, ${dummyVectorHex}::vector);
      `;

      const jobB = await tx.processingJob.create({
        data: {
          documentId: docBId,
          workspaceId: workspaceB.workspaceId,
          status: "COMPLETED",
        },
      });
      jobBId = jobB.id;

      const sessionB = await tx.uploadSession.create({
        data: {
          documentId: docBId,
          workspaceId: workspaceB.workspaceId,
          uploadId: `upload_${randomUUID()}`,
          storageKey: `key_${randomUUID()}`,
          filename: "beta-doc.pdf",
          mimeType: "application/pdf",
          sizeBytes: BigInt(200),
          partSizeBytes: 200,
          totalParts: 1,
        },
      });
      sessionBId = sessionB.id;
    });
  });

  after(async () => {
    // Clean up using raw query bypass (with transaction context set to clear test records)
    for (const wsId of [workspaceA.workspaceId, workspaceB.workspaceId]) {
      await withWorkspaceContext(wsId, async (tx) => {
        await tx.$executeRaw`DELETE FROM chunk_embeddings WHERE "chunkId" IN (SELECT id FROM chunks WHERE "workspaceId" = ${wsId})`;
        await tx.$executeRaw`DELETE FROM chunks WHERE "workspaceId" = ${wsId}`;
        await tx.$executeRaw`DELETE FROM "DocumentContent" WHERE "documentId" IN (SELECT id FROM "Document" WHERE "workspaceId" = ${wsId})`;
        await tx.$executeRaw`DELETE FROM processing_jobs WHERE "workspaceId" = ${wsId}`;
        await tx.$executeRaw`DELETE FROM upload_sessions WHERE "workspaceId" = ${wsId}`;
        await tx.$executeRaw`DELETE FROM "Document" WHERE "workspaceId" = ${wsId}`;
      });
    }
    await disconnectDatabase();
  });

  describe("1. Fail-Closed Test (Unset Workspace Context)", () => {
    it("SELECT on Document without context returns 0 rows", async () => {
      const rows = await prisma.$queryRaw<any[]>`SELECT * FROM "Document" WHERE id IN (${docAId}, ${docBId})`;
      assert.strictEqual(rows.length, 0);
    });

    it("SELECT on chunks without context returns 0 rows", async () => {
      const rows = await prisma.$queryRaw<any[]>`SELECT * FROM chunks WHERE id IN (${chunkAId}, ${chunkBId})`;
      assert.strictEqual(rows.length, 0);
    });

    it("SELECT on processing_jobs without context returns 0 rows", async () => {
      const rows = await prisma.$queryRaw<any[]>`SELECT * FROM processing_jobs WHERE id IN (${jobAId}, ${jobBId})`;
      assert.strictEqual(rows.length, 0);
    });

    it("SELECT on upload_sessions without context returns 0 rows", async () => {
      const rows = await prisma.$queryRaw<any[]>`SELECT * FROM upload_sessions WHERE id IN (${sessionAId}, ${sessionBId})`;
      assert.strictEqual(rows.length, 0);
    });

    it("SELECT on DocumentContent without context returns 0 rows", async () => {
      const rows = await prisma.$queryRaw<any[]>`SELECT * FROM "DocumentContent" WHERE "documentId" IN (${docAId}, ${docBId})`;
      assert.strictEqual(rows.length, 0);
    });

    it("SELECT on chunk_embeddings without context returns 0 rows", async () => {
      const rows = await prisma.$queryRaw<any[]>`SELECT * FROM chunk_embeddings WHERE "chunkId" IN (${chunkAId}, ${chunkBId})`;
      assert.strictEqual(rows.length, 0);
    });
  });

  describe("2. Direct Cross-Workspace SELECT Isolation", () => {
    it("Workspace A context sees Document A, blocks Document B", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        const rows = await tx.$queryRaw<any[]>`SELECT * FROM "Document" WHERE id IN (${docAId}, ${docBId})`;
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].id, docAId);
      });
    });

    it("Workspace B context sees Document B, blocks Document A", async () => {
      await withWorkspaceContext(workspaceB.workspaceId, async (tx) => {
        const rows = await tx.$queryRaw<any[]>`SELECT * FROM "Document" WHERE id IN (${docAId}, ${docBId})`;
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].id, docBId);
      });
    });

    it("Workspace A context sees Chunk A, blocks Chunk B", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        const rows = await tx.$queryRaw<any[]>`SELECT * FROM chunks WHERE id IN (${chunkAId}, ${chunkBId})`;
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].id, chunkAId);
      });
    });

    it("Workspace A context sees DocumentContent A, blocks DocumentContent B", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        const rows = await tx.$queryRaw<any[]>`SELECT * FROM "DocumentContent" WHERE "documentId" IN (${docAId}, ${docBId})`;
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].documentId, docAId);
      });
    });

    it("Workspace A context sees ChunkEmbedding A, blocks ChunkEmbedding B", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        const rows = await tx.$queryRaw<any[]>`SELECT * FROM chunk_embeddings WHERE "chunkId" IN (${chunkAId}, ${chunkBId})`;
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].chunkId, chunkAId);
      });
    });

    it("Workspace A context sees ProcessingJob A, blocks ProcessingJob B", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        const rows = await tx.$queryRaw<any[]>`SELECT * FROM processing_jobs WHERE id IN (${jobAId}, ${jobBId})`;
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].id, jobAId);
      });
    });

    it("Workspace A context sees UploadSession A, blocks UploadSession B", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        const rows = await tx.$queryRaw<any[]>`SELECT * FROM upload_sessions WHERE id IN (${sessionAId}, ${sessionBId})`;
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].id, sessionAId);
      });
    });
  });

  describe("3. INSERT / UPDATE / DELETE RLS Protection", () => {
    it("Workspace A context → INSERT document with workspace_id = B (MUST FAIL)", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        await assert.rejects(
          async () => {
            await tx.$executeRaw`
              INSERT INTO "Document" (id, "workspaceId", "uploadedById", filename, "mimeType", "sizeBytes", "storageKey", status)
              VALUES (${randomUUID()}, ${workspaceB.workspaceId}, ${userId}, 'evil.pdf', 'application/pdf', 10, ${`key_${randomUUID()}`}, 'READY');
            `;
          },
          (err: any) => err.message.includes("row-level security policy") || err.code === "42501" || err.message.includes("WITH CHECK")
        );
      });
    });

    it("Workspace A context → UPDATE Document B (MUST FAIL / 0 rows affected)", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        const count = await tx.$executeRaw`
          UPDATE "Document" SET filename = 'hacked.pdf' WHERE id = ${docBId};
        `;
        assert.strictEqual(count, 0);
      });
    });

    it("Workspace A context → UPDATE Document A workspaceId to B (MUST FAIL)", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        await assert.rejects(
          async () => {
            await tx.$executeRaw`
              UPDATE "Document" SET "workspaceId" = ${workspaceB.workspaceId} WHERE id = ${docAId};
            `;
          },
          (err: any) => err.message.includes("row-level security policy") || err.code === "42501" || err.message.includes("WITH CHECK")
        );
      });
    });

    it("Workspace A context → DELETE Document B (MUST FAIL / 0 rows affected)", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        const count = await tx.$executeRaw`
          DELETE FROM "Document" WHERE id = ${docBId};
        `;
        assert.strictEqual(count, 0);
      });
    });

    it("Workspace A context → INSERT DocumentContent for Document B (MUST FAIL)", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        await assert.rejects(
          async () => {
            await tx.$executeRaw`
              INSERT INTO "DocumentContent" (id, "documentId", text, "charCount")
              VALUES (${randomUUID()}, ${docBId}, 'injected content', 16);
            `;
          },
          (err: any) => err.message.includes("row-level security policy") || err.code === "42501" || err.message.includes("WITH CHECK")
        );
      });
    });

    it("Workspace A context → INSERT ChunkEmbedding for Chunk B (MUST FAIL)", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        const dummyVectorHex = "[" + new Array(768).fill(0.5).join(",") + "]";
        await assert.rejects(
          async () => {
            await tx.$executeRaw`
              INSERT INTO chunk_embeddings (id, "chunkId", embedding)
              VALUES (${randomUUID()}, ${chunkBId}, ${dummyVectorHex}::vector);
            `;
          },
          (err: any) => err.message.includes("row-level security policy") || err.code === "42501" || err.message.includes("WITH CHECK")
        );
      });
    });
  });

  describe("4. Deliberately Unsafe Raw Query Test", () => {
    it("Unsafe raw query targeting Workspace B document ID under Workspace A context returns 0 rows", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        // Deliberately omit WHERE workspaceId filter in query
        const rows = await tx.$queryRaw<any[]>`
          SELECT * FROM "Document" WHERE id = ${docBId};
        `;
        assert.strictEqual(rows.length, 0);
      });
    });
  });

  describe("5. Raw Vector Similarity Retrieval Test under RLS", () => {
    it("Vector similarity search under Workspace A context only retrieves Workspace A chunks", async () => {
      const searchVectorHex = "[" + new Array(768).fill(0.11).join(",") + "]";
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        // Raw query without repository workspace filter
        const results = await tx.$queryRaw<any[]>`
          SELECT
            c.id AS "chunkId",
            c.content,
            1 - (ce.embedding <=> ${searchVectorHex}::vector) AS similarity
          FROM chunk_embeddings ce
          JOIN chunks c ON c.id = ce."chunkId"
          ORDER BY ce.embedding <=> ${searchVectorHex}::vector ASC;
        `;

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].chunkId, chunkAId);
        assert.ok(results[0].content.includes("ALPHA-TENANT-SECRET-123"));
        assert.strictEqual(results[0].content.includes("BETA-TENANT-SECRET-456"), false);
      });
    });
  });

  describe("6. Transaction Leakage & Pool Reuse Safety", () => {
    it("Concurrent requests for Workspace A and Workspace B remain isolated", async () => {
      const ops = Array.from({ length: 20 }).map((_, i) => {
        const isEven = i % 2 === 0;
        const targetWs = isEven ? workspaceA.workspaceId : workspaceB.workspaceId;
        const expectedDocId = isEven ? docAId : docBId;

        return withWorkspaceContext(targetWs, async (tx) => {
          const docs = await tx.$queryRaw<any[]>`SELECT id FROM "Document" WHERE id IN (${docAId}, ${docBId})`;
          assert.strictEqual(docs.length, 1);
          assert.strictEqual(docs[0].id, expectedDocId);
        });
      });

      await Promise.all(ops);
    });

    it("Connection context does not persist after transaction completion", async () => {
      await withWorkspaceContext(workspaceA.workspaceId, async (tx) => {
        const docs = await tx.$queryRaw<any[]>`SELECT id FROM "Document" WHERE id = ${docAId}`;
        assert.strictEqual(docs.length, 1);
      });

      // Subsequent call on global client without context wrapper must see 0 rows
      const globalDocs = await prisma.$queryRaw<any[]>`SELECT id FROM "Document" WHERE id = ${docAId}`;
      assert.strictEqual(globalDocs.length, 0);
    });
  });
});
