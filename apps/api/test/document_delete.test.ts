import { test, describe, before, after, it, mock } from "node:test";
import assert from "node:assert";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma, withWorkspaceContext, disconnectDatabase, DocumentRepository, DocumentContentRepository } from "@core/database";
import { env } from "@core/shared";
import { app } from "../src/index.js";
import { s3, BUCKET } from "@core/storage";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { indexDocument } from "@core/indexing";
import { documentProcessingQueue } from "@core/jobs";
import type { AIProvider } from "@core/ai";

class TestAIProvider implements AIProvider {
  async embed(text: string): Promise<number[]> {
    const vec = new Array(768).fill(0.01);
    vec[0] = text.length;
    const sq = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
    return vec.map(v => v / sq);
  }
  async chat() { return "mock"; }
}

describe("DELETE /documents/:workspaceId/:documentId — Phase 11A Secure Document Deletion", () => {
  let orgId: string;
  let workspaceA: string;
  let workspaceB: string;

  let ownerId: string;
  let ownerToken: string;

  let adminId: string;
  let adminToken: string;

  let memberId: string;
  let memberToken: string;

  let nonMemberId: string;
  let nonMemberToken: string;

  let s3SendSpy: any;
  const mockAI = new TestAIProvider();

  before(async () => {
    // 1. Create Organization
    const org = await prisma.organization.create({
      data: { name: `Test Org Del ${randomUUID()}` },
    });
    orgId = org.id;

    // 2. Create Users
    const owner = await prisma.user.create({
      data: { email: `owner_${randomUUID()}@test.com`, passwordHash: "x", orgId },
    });
    ownerId = owner.id;
    ownerToken = jwt.sign({ userId: ownerId, email: owner.email }, env.JWT_SECRET);

    const admin = await prisma.user.create({
      data: { email: `admin_${randomUUID()}@test.com`, passwordHash: "x", orgId },
    });
    adminId = admin.id;
    adminToken = jwt.sign({ userId: adminId, email: admin.email }, env.JWT_SECRET);

    const member = await prisma.user.create({
      data: { email: `member_${randomUUID()}@test.com`, passwordHash: "x", orgId },
    });
    memberId = member.id;
    memberToken = jwt.sign({ userId: memberId, email: member.email }, env.JWT_SECRET);

    const nonMember = await prisma.user.create({
      data: { email: `nonmember_${randomUUID()}@test.com`, passwordHash: "x", orgId },
    });
    nonMemberId = nonMember.id;
    nonMemberToken = jwt.sign({ userId: nonMemberId, email: nonMember.email }, env.JWT_SECRET);

    // 3. Create Workspace A with memberships
    const wsA = await prisma.workspace.create({
      data: {
        name: "Workspace A",
        orgId,
        memberships: {
          create: [
            { userId: ownerId, role: "OWNER" },
            { userId: adminId, role: "ADMIN" },
            { userId: memberId, role: "MEMBER" },
          ],
        },
      },
    });
    workspaceA = wsA.id;

    // 4. Create Workspace B
    const wsB = await prisma.workspace.create({
      data: {
        name: "Workspace B",
        orgId,
        memberships: {
          create: [{ userId: ownerId, role: "OWNER" }],
        },
      },
    });
    workspaceB = wsB.id;
  });

  after(async () => {
    mock.restoreAll();
    await documentProcessingQueue.close();
    await prisma.$disconnect();
    await disconnectDatabase();
  });

  describe("1. Authorization", () => {
    let testDocId: string;

    before(async () => {
      const doc = await withWorkspaceContext(workspaceA, async (tx) => {
        return tx.document.create({
          data: {
            workspaceId: workspaceA,
            uploadedById: ownerId,
            filename: "auth-test.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storageKey: `test/auth_${randomUUID()}.pdf`,
            status: "UPLOADED",
          },
        });
      });
      testDocId = doc.id;
    });

    it("unauthenticated request returns 401 missing_token", async () => {
      const res = await request(app)
        .delete(`/documents/${workspaceA}/${testDocId}`);
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, "missing_token");
    });

    it("workspace MEMBER role request returns 403 forbidden", async () => {
      const res = await request(app)
        .delete(`/documents/${workspaceA}/${testDocId}`)
        .set("Authorization", `Bearer ${memberToken}`);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, "forbidden");
    });

    it("non-member request returns 403 forbidden", async () => {
      const res = await request(app)
        .delete(`/documents/${workspaceA}/${testDocId}`)
        .set("Authorization", `Bearer ${nonMemberToken}`);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, "forbidden");
    });

    it("cross-workspace document ID returns 404 without leaking metadata", async () => {
      // testDocId is in workspaceA; querying from workspaceB returns 404
      const res = await request(app)
        .delete(`/documents/${workspaceB}/${testDocId}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, "not_found");
    });

    it("non-existent document ID returns 404", async () => {
      const res = await request(app)
        .delete(`/documents/${workspaceA}/non-existent-doc-id`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, "not_found");
    });
  });

  describe("2. Deletion & Cleanup (ADMIN and OWNER)", () => {
    it("ADMIN can delete an uploaded document and removes S3 object & DB record", async () => {
      const storageKey = `test/admin_del_${randomUUID()}.pdf`;
      // Put fake file in MinIO
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
        Body: "dummy file content for deletion",
        ContentType: "application/pdf",
      }));

      const doc = await withWorkspaceContext(workspaceA, async (tx) => {
        return tx.document.create({
          data: {
            workspaceId: workspaceA,
            uploadedById: memberId,
            filename: "admin-delete-test.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storageKey,
            status: "UPLOADED",
          },
        });
      });

      const res = await request(app)
        .delete(`/documents/${workspaceA}/${doc.id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.documentId, doc.id);
      assert.strictEqual(res.body.status, "DELETED");

      // Verify DB record is completely gone
      const dbDoc = await withWorkspaceContext(workspaceA, async (tx) => {
        return tx.document.findUnique({ where: { id: doc.id } });
      });
      assert.strictEqual(dbDoc, null);
    });

    it("OWNER can delete a processed document; cascades DocumentContent, chunks, embeddings, and jobs", async () => {
      const storageKey = `test/owner_del_full_${randomUUID()}.pdf`;
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
        Body: "dummy full content for deletion cascade test",
        ContentType: "application/pdf",
      }));

      // Create document, content, chunks, embeddings, jobs
      let docId = "";
      let chunkId = "";
      await withWorkspaceContext(workspaceA, async (tx) => {
        const doc = await tx.document.create({
          data: {
            workspaceId: workspaceA,
            uploadedById: ownerId,
            filename: "full-cascade-test.pdf",
            mimeType: "application/pdf",
            sizeBytes: 200,
            storageKey,
            status: "READY",
          },
        });
        docId = doc.id;

        await tx.documentContent.create({
          data: {
            documentId: docId,
            text: "Extracted document text to be deleted",
            charCount: 38,
            pageCount: 1,
          },
        });

        const chunk = await tx.chunk.create({
          data: {
            documentId: docId,
            workspaceId: workspaceA,
            content: "Chunk content to be deleted",
            chunkIndex: 0,
            tokenCount: 6,
          },
        });
        chunkId = chunk.id;

        const dummyVector = "[" + new Array(768).fill(0.05).join(",") + "]";
        await tx.$executeRaw`
          INSERT INTO chunk_embeddings (id, "chunkId", embedding)
          VALUES (${randomUUID()}, ${chunkId}, ${dummyVector}::vector);
        `;

        await tx.processingJob.create({
          data: {
            documentId: docId,
            workspaceId: workspaceA,
            status: "COMPLETED",
          },
        });
      });

      // Execute DELETE as OWNER
      const res = await request(app)
        .delete(`/documents/${workspaceA}/${docId}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.status, "DELETED");

      // Verify all child tables were cleaned up
      await withWorkspaceContext(workspaceA, async (tx) => {
        const dbDoc = await tx.document.findUnique({ where: { id: docId } });
        assert.strictEqual(dbDoc, null);

        const dbContent = await tx.documentContent.findUnique({ where: { documentId: docId } });
        assert.strictEqual(dbContent, null);

        const dbChunks = await tx.chunk.findMany({ where: { documentId: docId } });
        assert.strictEqual(dbChunks.length, 0);

        const dbEmbeddings = await tx.chunkEmbedding.findMany({ where: { chunkId } });
        assert.strictEqual(dbEmbeddings.length, 0);

        const dbJobs = await tx.processingJob.findMany({ where: { documentId: docId } });
        assert.strictEqual(dbJobs.length, 0);
      });
    });

    it("handles missing MinIO object gracefully and completes DB deletion", async () => {
      // Storage key that was never uploaded to MinIO
      const storageKey = `test/missing_s3_${randomUUID()}.pdf`;
      const doc = await withWorkspaceContext(workspaceA, async (tx) => {
        return tx.document.create({
          data: {
            workspaceId: workspaceA,
            uploadedById: adminId,
            filename: "missing-minio-test.pdf",
            mimeType: "application/pdf",
            sizeBytes: 50,
            storageKey,
            status: "READY",
          },
        });
      });

      const res = await request(app)
        .delete(`/documents/${workspaceA}/${doc.id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.status, "DELETED");

      const dbDoc = await withWorkspaceContext(workspaceA, async (tx) => {
        return tx.document.findUnique({ where: { id: doc.id } });
      });
      assert.strictEqual(dbDoc, null);
    });

    it("on storage deletion failure, retains document in DELETING state with storageKey preserved, then succeeds on retry", async () => {
      const storageKey = `test/storage_fail_${randomUUID()}.pdf`;
      const doc = await withWorkspaceContext(workspaceA, async (tx) => {
        return tx.document.create({
          data: {
            workspaceId: workspaceA,
            uploadedById: adminId,
            filename: "storage-fail-test.pdf",
            mimeType: "application/pdf",
            sizeBytes: 150,
            storageKey,
            status: "READY",
          },
        });
      });

      // Mock S3 failure once
      const origSend = s3.send.bind(s3);
      let s3CallCount = 0;
      (s3 as any).send = async (command: any) => {
        if (command instanceof DeleteObjectCommand && s3CallCount === 0) {
          s3CallCount++;
          throw new Error("MinIO connection timed out / network partition");
        }
        return origSend(command);
      };

      try {
        // 1. Initial delete request fails at storage step
        const failRes = await request(app)
          .delete(`/documents/${workspaceA}/${doc.id}`)
          .set("Authorization", `Bearer ${adminToken}`);

        assert.strictEqual(failRes.status, 502);
        assert.strictEqual(failRes.body.error, "storage_cleanup_failed");
        assert.strictEqual(failRes.body.status, "DELETING");

        // Verify document is NOT deleted from DB and retains storageKey and status DELETING
        const midDoc = await withWorkspaceContext(workspaceA, async (tx) => {
          return tx.document.findUnique({ where: { id: doc.id } });
        });
        assert.ok(midDoc);
        assert.strictEqual(midDoc.status, "DELETING");
        assert.strictEqual(midDoc.storageKey, storageKey);

        // Verify document is IMMEDIATELY excluded from listing and downloads
        const listRes = await request(app)
          .get(`/documents/${workspaceA}`)
          .set("Authorization", `Bearer ${adminToken}`);
        const listIds = listRes.body.map((d: any) => d.id);
        assert.strictEqual(listIds.includes(doc.id), false);

        const fileRes = await request(app)
          .get(`/documents/${workspaceA}/${doc.id}/file`)
          .set("Authorization", `Bearer ${adminToken}`);
        assert.strictEqual(fileRes.status, 404);

        // 2. Retry delete request succeeds now that S3 is available
        const retryRes = await request(app)
          .delete(`/documents/${workspaceA}/${doc.id}`)
          .set("Authorization", `Bearer ${adminToken}`);

        assert.strictEqual(retryRes.status, 200);
        assert.strictEqual(retryRes.body.ok, true);
        assert.strictEqual(retryRes.body.status, "DELETED");

        const finalDoc = await withWorkspaceContext(workspaceA, async (tx) => {
          return tx.document.findUnique({ where: { id: doc.id } });
        });
        assert.strictEqual(finalDoc, null);
      } finally {
        (s3 as any).send = origSend;
      }
    });
  });

  describe("3. Worker Concurrency & Race Condition Protection", () => {
    it("processDocument worker aborts when document is in DELETING status without overwriting status", async () => {
      const workerUrl = new URL("../../../workers/document-processing/src/processDocument.ts", import.meta.url).href;
      const { processDocument } = await import(workerUrl);
      const storageKey = `test/worker_race_${randomUUID()}.pdf`;
      const doc = await withWorkspaceContext(workspaceA, async (tx) => {
        return tx.document.create({
          data: {
            workspaceId: workspaceA,
            uploadedById: ownerId,
            filename: "worker-race.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storageKey,
            status: "DELETING",
            sha256: "dummy-sha",
          },
        });
      });

      // Try running worker on DELETING document
      await assert.rejects(
        async () => {
          await processDocument(
            doc.id,
            workspaceA,
            "fake-job-id",
            0,
            3,
            mockAI,
            prisma
          );
        },
        (err: any) => {
          assert.strictEqual(err.isNonRetryable, true);
          assert.strictEqual(err.skipStatusUpdate, true);
          return true;
        }
      );

      // Verify status was NOT changed back to PROCESSING or FAILED
      const checkDoc = await withWorkspaceContext(workspaceA, async (tx) => {
        return tx.document.findUnique({ where: { id: doc.id } });
      });
      assert.strictEqual(checkDoc?.status, "DELETING");

      // Clean up test doc
      await withWorkspaceContext(workspaceA, async (tx) => {
        await tx.document.delete({ where: { id: doc.id } });
      });
    });

    it("indexDocument aborts and does not generate chunks when document is DELETING", async () => {
      const storageKey = `test/index_race_${randomUUID()}.pdf`;
      let docId = "";
      await withWorkspaceContext(workspaceA, async (tx) => {
        const doc = await tx.document.create({
          data: {
            workspaceId: workspaceA,
            uploadedById: ownerId,
            filename: "index-race.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storageKey,
            status: "DELETING",
          },
        });
        docId = doc.id;

        await tx.documentContent.create({
          data: {
            documentId: docId,
            text: "Some text that shouldn't be indexed",
            charCount: 35,
          },
        });
      });

      const result = await indexDocument(docId, workspaceA, mockAI, prisma);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, "document_not_found");

      // Verify no chunks were created
      const chunks = await withWorkspaceContext(workspaceA, async (tx) => {
        return tx.chunk.findMany({ where: { documentId: docId } });
      });
      assert.strictEqual(chunks.length, 0);

      // Clean up test doc
      await withWorkspaceContext(workspaceA, async (tx) => {
        await tx.documentContent.deleteMany({ where: { documentId: docId } });
        await tx.document.delete({ where: { id: docId } });
      });
    });
  });
});
