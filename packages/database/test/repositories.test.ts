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

describe("Phase 9.1 — Workspace Isolation Repository Unit Tests", () => {
  let orgId: string;
  let workspaceA: WorkspaceContext;
  let workspaceB: WorkspaceContext;
  let userId: string;

  before(async () => {
    const org = await prisma.organization.create({
      data: { name: `Repo Test Org ${randomUUID()}` },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        email: `repo_test_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId,
      },
    });
    userId = user.id;

    const wsA = await prisma.workspace.create({
      data: {
        name: "Workspace A",
        orgId,
        memberships: { create: { userId, role: "MEMBER" } },
      },
    });
    workspaceA = { workspaceId: wsA.id };

    const wsB = await prisma.workspace.create({
      data: {
        name: "Workspace B",
        orgId,
        memberships: { create: { userId, role: "MEMBER" } },
      },
    });
    workspaceB = { workspaceId: wsB.id };
  });

  after(async () => {
    for (const wsId of [workspaceA.workspaceId, workspaceB.workspaceId]) {
      await withWorkspaceContext(wsId, async (tx: any) => {
        await tx.chunkEmbedding.deleteMany({});
        await tx.chunk.deleteMany({});
        await tx.documentContent.deleteMany({});
        await tx.processingJob.deleteMany({});
        await tx.uploadSession.deleteMany({});
        await tx.document.deleteMany({});
      });
    }
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceA.workspaceId, workspaceB.workspaceId] } }
    });
    await prisma.user.deleteMany({
      where: { id: userId }
    });
    await prisma.organization.deleteMany({
      where: { id: orgId }
    });
    await disconnectDatabase();
  });

  describe("1. DocumentRepository", () => {
    let docAId: string;

    it("Workspace A → Workspace A document create (PASS)", async () => {
      const doc = await DocumentRepository.create(workspaceA, {
        uploadedById: userId,
        filename: "docA.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        storageKey: `key_${randomUUID()}`,
      });

      assert.ok(doc.id);
      assert.strictEqual(doc.workspaceId, workspaceA.workspaceId);
      docAId = doc.id;
    });

    it("Workspace A → Workspace A document findById (PASS)", async () => {
      const doc = await DocumentRepository.findById(workspaceA, docAId);
      assert.ok(doc);
      assert.strictEqual(doc.id, docAId);
    });

    it("Workspace B → Workspace A document findById (blocked → null)", async () => {
      const doc = await DocumentRepository.findById(workspaceB, docAId);
      assert.strictEqual(doc, null);
    });

    it("Workspace A → Workspace A document update (PASS)", async () => {
      const updated = await DocumentRepository.update(workspaceA, docAId, { status: "PROCESSING" });
      assert.ok(updated);
      assert.strictEqual(updated.status, "PROCESSING");
    });

    it("Workspace B → Workspace A document update (blocked → null)", async () => {
      const updated = await DocumentRepository.update(workspaceB, docAId, { status: "READY" });
      assert.strictEqual(updated, null);
    });

    it("Workspace B → Workspace A document delete (blocked → false)", async () => {
      const deleted = await DocumentRepository.delete(workspaceB, docAId);
      assert.strictEqual(deleted, false);
    });

    it("Workspace A → Workspace A document delete (PASS)", async () => {
      const deleted = await DocumentRepository.delete(workspaceA, docAId);
      assert.strictEqual(deleted, true);
    });
  });

  describe("2. DocumentContentRepository", () => {
    let docAId: string;

    before(async () => {
      const doc = await DocumentRepository.create(workspaceA, {
        uploadedById: userId,
        filename: "contentDoc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        storageKey: `key_${randomUUID()}`,
      });
      docAId = doc.id;
    });

    it("Workspace A → Workspace A content upsert & findByDocumentId (PASS)", async () => {
      const upserted = await DocumentContentRepository.upsert(workspaceA, docAId, {
        text: "Extracted text for document A",
        charCount: 29,
        pageCount: 1,
      });

      assert.ok(upserted);
      assert.strictEqual(upserted.documentId, docAId);

      const found = await DocumentContentRepository.findByDocumentId(workspaceA, docAId);
      assert.ok(found);
      assert.strictEqual(found.text, "Extracted text for document A");
    });

    it("Workspace B → Workspace A content findByDocumentId (blocked → null)", async () => {
      const found = await DocumentContentRepository.findByDocumentId(workspaceB, docAId);
      assert.strictEqual(found, null);
    });

    it("Workspace B → Workspace A content upsert (blocked → null)", async () => {
      const result = await DocumentContentRepository.upsert(workspaceB, docAId, {
        text: "Hacked text",
        charCount: 11,
      });
      assert.strictEqual(result, null);
    });

    it("Workspace B → Workspace A content delete (blocked → false)", async () => {
      const deleted = await DocumentContentRepository.deleteByDocumentId(workspaceB, docAId);
      assert.strictEqual(deleted, false);
    });

    it("Workspace A → Workspace A content delete (PASS)", async () => {
      const deleted = await DocumentContentRepository.deleteByDocumentId(workspaceA, docAId);
      assert.strictEqual(deleted, true);
    });
  });

  describe("3. ChunkRepository & 4. ChunkEmbeddingRepository", () => {
    let docAId: string;
    let chunkAId: string;

    before(async () => {
      const doc = await DocumentRepository.create(workspaceA, {
        uploadedById: userId,
        filename: "chunkDoc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4096,
        storageKey: `key_${randomUUID()}`,
      });
      docAId = doc.id;

      const chunk = await ChunkRepository.create(workspaceA, {
        documentId: docAId,
        content: "Sample chunk content for document A",
        chunkIndex: 0,
        tokenCount: 6,
      });
      chunkAId = chunk.id;
    });

    it("Workspace A → Workspace A chunk findByDocumentId & count (PASS)", async () => {
      const chunks = await ChunkRepository.findByDocumentId(workspaceA, docAId);
      assert.strictEqual(chunks.length, 1);
      assert.strictEqual(chunks[0].id, chunkAId);

      const count = await ChunkRepository.count(workspaceA, docAId);
      assert.strictEqual(count, 1);
    });

    it("Workspace B → Workspace A chunk findByDocumentId & count (blocked → [] / 0)", async () => {
      const chunks = await ChunkRepository.findByDocumentId(workspaceB, docAId);
      assert.strictEqual(chunks.length, 0);

      const count = await ChunkRepository.count(workspaceB, docAId);
      assert.strictEqual(count, 0);
    });

    it("Workspace A → Workspace A embedding upsert & findByChunkId & count (PASS)", async () => {
      const dummyVectorHex = "[" + new Array(768).fill(0.1).join(",") + "]";
      const upserted = await ChunkEmbeddingRepository.upsert(workspaceA, chunkAId, dummyVectorHex);
      assert.strictEqual(upserted, true);

      const embedding = await ChunkEmbeddingRepository.findByChunkId(workspaceA, chunkAId);
      assert.ok(embedding);
      assert.strictEqual(embedding.chunkId, chunkAId);

      const count = await ChunkEmbeddingRepository.countByDocumentId(workspaceA, docAId);
      assert.strictEqual(count, 1);
    });

    it("Workspace B → Workspace A embedding findByChunkId (blocked → null)", async () => {
      const embedding = await ChunkEmbeddingRepository.findByChunkId(workspaceB, chunkAId);
      assert.strictEqual(embedding, null);
    });

    it("Workspace B → Workspace A embedding countByDocumentId (blocked → 0)", async () => {
      const count = await ChunkEmbeddingRepository.countByDocumentId(workspaceB, docAId);
      assert.strictEqual(count, 0);
    });

    it("Workspace B → Workspace A embedding upsert (blocked → false)", async () => {
      const dummyVectorHex = "[" + new Array(768).fill(0.2).join(",") + "]";
      const success = await ChunkEmbeddingRepository.upsert(workspaceB, chunkAId, dummyVectorHex);
      assert.strictEqual(success, false);
    });

    it("Workspace B → Workspace A chunk deleteByDocumentId (blocked → 0)", async () => {
      const deletedCount = await ChunkRepository.deleteByDocumentId(workspaceB, docAId);
      assert.strictEqual(deletedCount, 0);
    });

    it("Workspace A → Workspace A chunk deleteByDocumentId (PASS)", async () => {
      const deletedCount = await ChunkRepository.deleteByDocumentId(workspaceA, docAId);
      assert.strictEqual(deletedCount, 1);
    });
  });

  describe("5. ProcessingJobRepository", () => {
    let docAId: string;
    let jobAId: string;

    before(async () => {
      const doc = await DocumentRepository.create(workspaceA, {
        uploadedById: userId,
        filename: "jobDoc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        storageKey: `key_${randomUUID()}`,
      });
      docAId = doc.id;

      const job = await ProcessingJobRepository.create(workspaceA, {
        documentId: docAId,
        status: "QUEUED",
        progress: 0,
      });
      jobAId = job.id;
    });

    it("Workspace A → Workspace A job findById & findLatestByDocumentId (PASS)", async () => {
      const job = await ProcessingJobRepository.findById(workspaceA, jobAId);
      assert.ok(job);
      assert.strictEqual(job.id, jobAId);

      const latest = await ProcessingJobRepository.findLatestByDocumentId(workspaceA, docAId);
      assert.ok(latest);
      assert.strictEqual(latest.id, jobAId);
    });

    it("Workspace B → Workspace A job findById (blocked → null)", async () => {
      const job = await ProcessingJobRepository.findById(workspaceB, jobAId);
      assert.strictEqual(job, null);
    });

    it("Workspace B → Workspace A job findLatestByDocumentId (blocked → null)", async () => {
      const latest = await ProcessingJobRepository.findLatestByDocumentId(workspaceB, docAId);
      assert.strictEqual(latest, null);
    });

    it("Workspace A → Workspace A job update (PASS)", async () => {
      const updated = await ProcessingJobRepository.update(workspaceA, jobAId, {
        progress: 50,
        status: "PROCESSING",
      });
      assert.ok(updated);
      assert.strictEqual(updated.progress, 50);
    });

    it("Workspace B → Workspace A job update (blocked → null)", async () => {
      const updated = await ProcessingJobRepository.update(workspaceB, jobAId, {
        progress: 100,
        status: "COMPLETED",
      });
      assert.strictEqual(updated, null);
    });
  });

  describe("6. UploadSessionRepository", () => {
    let docAId: string;
    let sessionAId: string;

    before(async () => {
      const doc = await DocumentRepository.create(workspaceA, {
        uploadedById: userId,
        filename: "uploadDoc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        storageKey: `key_${randomUUID()}`,
      });
      docAId = doc.id;

      const session = await UploadSessionRepository.create(workspaceA, {
        documentId: docAId,
        uploadId: `upload_${randomUUID()}`,
        storageKey: `key_${randomUUID()}`,
        filename: "uploadDoc.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(1024),
        partSizeBytes: 8192,
        totalParts: 1,
      });
      sessionAId = session.id;
    });

    it("Workspace A → Workspace A session findById & findByDocumentId (PASS)", async () => {
      const sById = await UploadSessionRepository.findById(workspaceA, sessionAId);
      assert.ok(sById);
      assert.strictEqual(sById.id, sessionAId);

      const sByDoc = await UploadSessionRepository.findByDocumentId(workspaceA, docAId);
      assert.ok(sByDoc);
      assert.strictEqual(sByDoc.id, sessionAId);
    });

    it("Workspace B → Workspace A session findById (blocked → null)", async () => {
      const session = await UploadSessionRepository.findById(workspaceB, sessionAId);
      assert.strictEqual(session, null);
    });

    it("Workspace B → Workspace A session findByDocumentId (blocked → null)", async () => {
      const session = await UploadSessionRepository.findByDocumentId(workspaceB, docAId);
      assert.strictEqual(session, null);
    });

    it("Workspace A → Workspace A session update (PASS)", async () => {
      const updated = await UploadSessionRepository.update(workspaceA, sessionAId, {
        status: "COMPLETING",
      });
      assert.ok(updated);
      assert.strictEqual(updated.status, "COMPLETING");
    });

    it("Workspace B → Workspace A session update (blocked → null)", async () => {
      const updated = await UploadSessionRepository.update(workspaceB, sessionAId, {
        status: "COMPLETED",
      });
      assert.strictEqual(updated, null);
    });

    it("Workspace B → Workspace A session delete (blocked → false)", async () => {
      const deleted = await UploadSessionRepository.delete(workspaceB, sessionAId);
      assert.strictEqual(deleted, false);
    });

    it("Workspace A → Workspace A session delete (PASS)", async () => {
      const deleted = await UploadSessionRepository.delete(workspaceA, sessionAId);
      assert.strictEqual(deleted, true);
    });
  });
});
