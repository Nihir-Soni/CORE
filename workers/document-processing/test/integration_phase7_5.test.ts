import { describe, before, after, it, mock } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../../../apps/api/src/index.js";
import { prisma, withWorkspaceContext } from "@core/database";
import jwt from "jsonwebtoken";
import { env } from "@core/shared";
import { randomUUID } from "node:crypto";
import { documentProcessingQueue } from "@core/jobs";
import { setMultipartStorageOps, resetMultipartStorageOps } from "../../../apps/api/src/routes/multipart.js";
import { processDocument } from "../src/processDocument.js";
import { setAIProvider } from "../../../apps/api/src/routes/document.js";
import type { AIProvider } from "@core/ai";
import { s3, BUCKET, deleteObject } from "@core/storage";
import { PutObjectCommand } from "@aws-sdk/client-s3";

class IntegrationMockProvider implements AIProvider {
  async embed(text: string): Promise<number[]> {
    const vec = new Array(768).fill(0.01);
    vec[0] = text.length / 100.0;
    const sumSq = vec.reduce((s, x) => s + x * x, 0);
    const mag = Math.sqrt(sumSq);
    return vec.map((x) => x / mag);
  }

  async chat() {
    return "Based on the provided context [source:1], the document contains test data.";
  }
}

describe("CHiE Phase 7.5 Background Processing & RAG Integration", () => {
  let orgId: string;
  let workspaceAId: string;
  let workspaceBId: string;
  let userAToken: string;
  let userBToken: string;
  let queueMock: any;
  let provider: IntegrationMockProvider;

  before(async () => {
    provider = new IntegrationMockProvider();
    setAIProvider(provider);

    queueMock = mock.method(documentProcessingQueue, "add", async (name: string, data: any, opts: any) => ({
      id: opts?.jobId || "mock-queue-job"
    }));

    const org = await prisma.organization.create({ data: { name: `Phase 7.5 Org ${randomUUID()}` } });
    orgId = org.id;

    const userA = await prisma.user.create({
      data: { email: `usera_${randomUUID()}@p75.test`, passwordHash: "hash", orgId }
    });
    userAToken = jwt.sign({ userId: userA.id, orgId }, env.JWT_SECRET);

    const userB = await prisma.user.create({
      data: { email: `userb_${randomUUID()}@p75.test`, passwordHash: "hash", orgId }
    });
    userBToken = jwt.sign({ userId: userB.id, orgId }, env.JWT_SECRET);

    const wa = await prisma.workspace.create({
      data: {
        name: "Workspace A 7.5",
        orgId,
        memberships: { create: { userId: userA.id, role: "MEMBER" } }
      }
    });
    workspaceAId = wa.id;

    const wb = await prisma.workspace.create({
      data: {
        name: "Workspace B 7.5",
        orgId,
        memberships: { create: { userId: userB.id, role: "MEMBER" } }
      }
    });
    workspaceBId = wb.id;
  });

  after(async () => {
    resetMultipartStorageOps();
    setAIProvider(undefined);
    mock.restoreAll();
  });

  it("Full Lifecycle — Multipart Upload → Hash → ProcessingJob → Worker → READY → Retrieval → Chat", async () => {
    const fileContent = `This is a comprehensive test document content for Phase 7.5 integration testing. ${randomUUID()}`;
    const storageKey = `test/p75_mp_${randomUUID()}.txt`;

    // 1. Put object directly to MinIO (simulating completed upload)
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageKey,
      Body: fileContent,
      ContentType: "text/plain",
    }));

    // 2. Mock storage ops for multipart completion
    setMultipartStorageOps({
      listMultipartParts: async () => [{ PartNumber: 1, ETag: '"etag-p75"' }],
      completeMultipartUpload: async () => {},
    });

    // 3. Initiate multipart session in Workspace A
    const initRes = await request(app)
      .post(`/documents/${workspaceAId}/multipart/initiate`)
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ filename: "p75_doc.pdf", mimeType: "application/pdf", sizeBytes: 5 * 1024 * 1024 })
      .expect(201);

    const { sessionId, documentId } = initRes.body;

    // Manually point storageKey to our real MinIO object for the integration run
    await withWorkspaceContext(workspaceAId, async (tx) => {
      await tx.document.update({ where: { id: documentId }, data: { storageKey } });
      await tx.uploadSession.update({ where: { id: sessionId }, data: { storageKey } });
    });

    queueMock.mock.resetCalls();

    // 4. Complete multipart upload
    const completeRes = await request(app)
      .post(`/documents/${workspaceAId}/multipart/${sessionId}/complete`)
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ parts: [{ partNumber: 1, etag: "etag-p75" }] })
      .expect(200);

    assert.equal(completeRes.body.status, "COMPLETED");
    assert.equal(completeRes.body.duplicate, undefined);

    // 5. Verify Document.sha256 was persisted BEFORE worker processing
    const docAfterComplete = await withWorkspaceContext(workspaceAId, async (tx) => tx.document.findUnique({ where: { id: documentId } }));
    assert.ok(docAfterComplete?.sha256);
    assert.equal(docAfterComplete.sha256.length, 64);
    assert.equal(docAfterComplete.status, "UPLOADED");

    // 6. Verify ProcessingJob created and BullMQ queue called
    const job = await withWorkspaceContext(workspaceAId, async (tx) => tx.processingJob.findFirst({ where: { documentId } }));
    assert.ok(job);
    assert.equal(job.status, "QUEUED");
    assert.equal(queueMock.mock.callCount(), 1);

    // 7. Run Worker processing engine
    const mockExtract = async () => ({ text: fileContent, pageCount: 1 });
    const workerResult = await processDocument(
      documentId,
      workspaceAId,
      job.id,
      0,
      3,
      provider,
      prisma,
      { extract: mockExtract }
    );

    assert.equal(workerResult.status, "READY");
    assert.ok(workerResult.chunkCount > 0);

    const readyDoc = await withWorkspaceContext(workspaceAId, async (tx) => tx.document.findUnique({ where: { id: documentId } }));
    assert.equal(readyDoc?.status, "READY");

    const completedJob = await withWorkspaceContext(workspaceAId, async (tx) => tx.processingJob.findUnique({ where: { id: job.id } }));
    assert.equal(completedJob?.status, "COMPLETED");

    // 8. Test Retrieval API
    const retrieveRes = await request(app)
      .post(`/documents/${workspaceAId}/retrieve`)
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ query: "comprehensive test document", topK: 5 })
      .expect(200);

    assert.ok(retrieveRes.body.results.length > 0);
    assert.equal(retrieveRes.body.results[0].documentId, documentId);

    // 9. Test Chat API
    const chatRes = await request(app)
      .post(`/documents/${workspaceAId}/chat`)
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ query: "What is in the document?", topK: 5 })
      .expect(200);

    assert.ok(chatRes.body.answer);
    assert.ok(chatRes.body.citations.length > 0);

    // Cleanup object
    await deleteObject(storageKey).catch(() => {});
  });

  it("Duplicate Job Replay — running processDocument twice is idempotent with zero duplicate chunks", async () => {
    const fileContent = "Idempotency replay test text for Phase 7.5.";
    const storageKey = `test/p75_replay_${randomUUID()}.txt`;

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageKey,
      Body: fileContent,
      ContentType: "text/plain",
    }));

    const { doc, job } = await withWorkspaceContext(workspaceAId, async (tx) => {
      const user = await tx.user.findFirst({ where: { orgId } });
      const createdDoc = await tx.document.create({
        data: {
          workspaceId: workspaceAId,
          uploadedById: user!.id,
          filename: "replay.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          storageKey,
          sha256: "b4f5" + "0".repeat(60),
          status: "UPLOADED",
        },
      });

      const createdJob = await tx.processingJob.create({
        data: { documentId: createdDoc.id, workspaceId: workspaceAId }
      });
      return { doc: createdDoc, job: createdJob };
    });

    const mockExtract = async () => ({ text: fileContent, pageCount: 1 });

    // First worker run
    await processDocument(doc.id, workspaceAId, job.id, 0, 3, provider, prisma, { extract: mockExtract });
    const firstChunks = await withWorkspaceContext(workspaceAId, async (tx) => tx.chunk.findMany({ where: { documentId: doc.id } }));
    assert.ok(firstChunks.length > 0);

    // Second worker run (simulating duplicate job replay / retry)
    await processDocument(doc.id, workspaceAId, job.id, 0, 3, provider, prisma, { extract: mockExtract });
    const secondChunks = await withWorkspaceContext(workspaceAId, async (tx) => tx.chunk.findMany({ where: { documentId: doc.id } }));

    // Assert zero duplicate chunks created
    assert.equal(secondChunks.length, firstChunks.length);

    await deleteObject(storageKey).catch(() => {});
  });

  it("Enqueue Failure Boundary — failed BullMQ enqueue updates ProcessingJob = FAILED and returns 500 error", async () => {
    // Force queue.add failure
    queueMock.mock.mockImplementation(async () => {
      throw new Error("Redis connection error");
    });

    const doc = await withWorkspaceContext(workspaceAId, async (tx) => {
      const user = await tx.user.findFirst({ where: { orgId } });
      return tx.document.create({
        data: {
          workspaceId: workspaceAId,
          uploadedById: user!.id,
          filename: "enqueue_fail.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          storageKey: `test/enqueue_fail_${randomUUID()}.pdf`,
          status: "UPLOADING",
        }
      });
    });

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: doc.storageKey,
      Body: "dummy content",
      ContentType: "application/pdf",
    }));

    const res = await request(app)
      .post(`/documents/${workspaceAId}/${doc.id}/complete`)
      .set("Authorization", `Bearer ${userAToken}`);

    assert.equal(res.status, 500);
    assert.equal(res.body.error, "queue_error");

    const failedJob = await withWorkspaceContext(workspaceAId, async (tx) => tx.processingJob.findFirst({ where: { documentId: doc.id } }));
    assert.ok(failedJob);
    assert.equal(failedJob.status, "FAILED");
    assert.equal(failedJob.lastError, "Enqueue failed");

    // Restore queue mock
    queueMock.mock.mockImplementation(async (name: string, data: any, opts: any) => ({
      id: opts?.jobId || "mock-queue-job"
    }));

    await deleteObject(doc.storageKey).catch(() => {});
  });
});
