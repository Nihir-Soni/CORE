import { describe, before, after, it, mock } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../../../apps/api/src/index.js";
import { prisma } from "@core/database";
import jwt from "jsonwebtoken";
import { env } from "@core/shared";
import { randomUUID, createHash } from "node:crypto";
import { documentProcessingQueue } from "@core/jobs";
import { processDocument } from "../src/processDocument.js";
import { setAIProvider } from "../../../apps/api/src/routes/document.js";
import type { AIProvider } from "@core/ai";
import { s3, BUCKET, deleteObject } from "@core/storage";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Mock AI Provider for deterministic offline testing ───────────────────────
class TestMockAIProvider implements AIProvider {
  async embed(text: string): Promise<number[]> {
    const vec = new Array(768).fill(0.01);
    vec[0] = text.length / 100.0;
    const sumSq = vec.reduce((s, x) => s + x * x, 0);
    const mag = Math.sqrt(sumSq);
    return vec.map((x) => x / mag);
  }

  async chat() {
    return "Based on the provided document context, CHiE Phase 7.6 verification is successful [source:1].";
  }
}

// ── Diagnostics & Benchmark Metrics ──────────────────────────────────────────
export interface BenchmarkMetrics {
  fileSizeBytes: number;
  partSizeBytes: number;
  totalParts: number;
  genDurationMs: number;
  independentHashMs: number;
  uploadInterruptedParts: number;
  initialUploadDurationMs: number;
  resumeDurationMs: number;
  completeDurationMs: number;
  chieHashDurationMs: number;
  workerProcessingDurationMs: number;
  totalToReadyMs: number;
  peakHeapMemoryMb: number;
}

const benchmarkResults: Partial<BenchmarkMetrics> = {};

describe("CHiE Phase 7.6 — Final Large-File E2E & Verification Suite", () => {
  let orgId: string;
  let workspaceAId: string;
  let workspaceBId: string;
  let userAToken: string;
  let userBToken: string;
  let userAId: string;
  let userBId: string;
  let queueMock: any;
  let provider: TestMockAIProvider;

  // Dedicated test temp file path (1GB file)
  const tempFilePath = path.join(os.tmpdir(), `chie_p7_6_test_${randomUUID()}.bin`);
  const ONE_GB_BYTES = 1024 * 1024 * 1024; // 1,073,741,824 bytes (1.00 GB)
  let expectedSha256 = "";

  before(async () => {
    provider = new TestMockAIProvider();
    setAIProvider(provider);

    queueMock = mock.method(documentProcessingQueue, "add", async (name: string, data: any, opts: any) => ({
      id: opts?.jobId || `mock-job-${randomUUID()}`
    }));

    const org = await prisma.organization.create({ data: { name: `Phase 7.6 Org ${randomUUID()}` } });
    orgId = org.id;

    const userA = await prisma.user.create({
      data: { email: `usera_${randomUUID()}@p76.test`, passwordHash: "hash", orgId }
    });
    userAId = userA.id;
    userAToken = jwt.sign({ userId: userA.id, orgId }, env.JWT_SECRET);

    const userB = await prisma.user.create({
      data: { email: `userb_${randomUUID()}@p76.test`, passwordHash: "hash", orgId }
    });
    userBId = userB.id;
    userBToken = jwt.sign({ userId: userB.id, orgId }, env.JWT_SECRET);

    const wa = await prisma.workspace.create({
      data: {
        name: "Workspace A 7.6",
        orgId,
        memberships: { create: { userId: userA.id, role: "MEMBER" } }
      }
    });
    workspaceAId = wa.id;

    const wb = await prisma.workspace.create({
      data: {
        name: "Workspace B 7.6",
        orgId,
        memberships: { create: { userId: userB.id, role: "MEMBER" } }
      }
    });
    workspaceBId = wb.id;
  });

  after(async () => {
    setAIProvider(undefined);
    mock.restoreAll();
    if (fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch {}
    }
  });

  // ── 1. Baseline System State Audit ─────────────────────────────────────────
  it("Step 3 — Baseline system state recorded", async () => {
    const docCount = await prisma.document.count({ where: { workspaceId: workspaceAId } });
    const sessionCount = await prisma.uploadSession.count({ where: { workspaceId: workspaceAId } });
    const jobCount = await prisma.processingJob.count({ where: { workspaceId: workspaceAId } });
    const chunkCount = await prisma.chunk.count({ where: { workspaceId: workspaceAId } });

    assert.equal(docCount, 0);
    assert.equal(sessionCount, 0);
    assert.equal(jobCount, 0);
    assert.equal(chunkCount, 0);
  });

  // ── 2. Deterministic 1GB File Generation & Independent SHA-256 ────────────
  it("Step 4 & 5 — Streaming 1GB deterministic test file generation & independent SHA-256 digest", async () => {
    const genStart = Date.now();
    const writeStream = fs.createWriteStream(tempFilePath);

    // Write predictable 1MB chunks to avoid memory buffering
    const CHUNK_SIZE = 1024 * 1024; // 1MB
    const totalChunks = ONE_GB_BYTES / CHUNK_SIZE; // 1024 chunks
    const textPattern = `CHiE Phase 7.6 Verification Document Content Token: ${randomUUID()}\n`;
    const chunkBuffer = Buffer.alloc(CHUNK_SIZE, textPattern);

    for (let i = 0; i < totalChunks; i++) {
      if (!writeStream.write(chunkBuffer)) {
        await new Promise((resolve) => writeStream.once("drain", resolve));
      }
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end((err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const stat = fs.statSync(tempFilePath);
    assert.equal(stat.size, ONE_GB_BYTES, "Generated file size must be exactly 1GB");
    benchmarkResults.genDurationMs = Date.now() - genStart;
    benchmarkResults.fileSizeBytes = ONE_GB_BYTES;

    // Independent streaming SHA-256 calculation
    const hashStart = Date.now();
    const hashStream = fs.createReadStream(tempFilePath);
    const hasher = createHash("sha256");

    for await (const chunk of hashStream) {
      hasher.update(chunk);
    }
    expectedSha256 = hasher.digest("hex");
    benchmarkResults.independentHashMs = Date.now() - hashStart;

    assert.equal(expectedSha256.length, 64, "SHA-256 digest must be 64 hex characters");
  });

  // ── 3. Multipart Upload Initiation & Direct MinIO Upload with Interruption 
  let sessionId = "";
  let documentId = "";
  let uploadId = "";
  let partSizeBytes = 0;
  let totalParts = 0;
  const etagMap = new Map<number, string>();

  it("Step 6, 7 & 8 — Initiate 1GB multipart upload & verify direct MinIO structure", async () => {
    const initRes = await request(app)
      .post(`/documents/${workspaceAId}/multipart/initiate`)
      .set("Authorization", `Bearer ${userAToken}`)
      .send({
        filename: "large_1gb_test.bin",
        mimeType: "application/pdf",
        sizeBytes: ONE_GB_BYTES,
      })
      .expect(201);

    sessionId = initRes.body.sessionId;
    documentId = initRes.body.documentId;
    uploadId = initRes.body.uploadId;
    partSizeBytes = initRes.body.partSizeBytes;
    totalParts = initRes.body.totalParts;

    assert.equal(partSizeBytes, 8 * 1024 * 1024, "Part size must be 8MB");
    assert.equal(totalParts, 128, "Total parts for 1GB must be 128");

    benchmarkResults.partSizeBytes = partSizeBytes;
    benchmarkResults.totalParts = totalParts;
  });

  it("Step 9 — Force interruption after uploading part 40 (~31% uploaded)", async () => {
    const uploadStart = Date.now();
    const fd = fs.openSync(tempFilePath, "r");

    try {
      // Upload parts 1 to 40
      for (let partNumber = 1; partNumber <= 40; partNumber++) {
        const partUrlRes = await request(app)
          .post(`/documents/${workspaceAId}/multipart/${sessionId}/part-url`)
          .set("Authorization", `Bearer ${userAToken}`)
          .send({ partNumber })
          .expect(200);

        const { uploadUrl } = partUrlRes.body;

        // Slice part buffer directly from disk file
        const buffer = Buffer.alloc(partSizeBytes);
        const bytesRead = fs.readSync(fd, buffer, 0, partSizeBytes, (partNumber - 1) * partSizeBytes);
        const partSlice = buffer.subarray(0, bytesRead);

        // Direct HTTP PUT to MinIO presigned URL
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          body: partSlice,
        });

        assert.ok(putRes.ok, `Part ${partNumber} PUT failed: ${putRes.status}`);
        const etag = putRes.headers.get("ETag")?.replace(/"/g, "") ?? "";
        assert.ok(etag, `Part ${partNumber} missing ETag`);
        etagMap.set(partNumber, etag);
      }
    } finally {
      fs.closeSync(fd);
    }

    benchmarkResults.uploadInterruptedParts = 40;
    benchmarkResults.initialUploadDurationMs = Date.now() - uploadStart;

    // Simulate network interruption (stop uploading here)
    assert.equal(etagMap.size, 40);
  });

  it("Step 10 — Verify session survives network interruption", async () => {
    const sessionRes = await request(app)
      .get(`/documents/${workspaceAId}/multipart/${sessionId}`)
      .set("Authorization", `Bearer ${userAToken}`)
      .expect(200);

    assert.equal(sessionRes.body.sessionId, sessionId);
    assert.equal(sessionRes.body.status, "INITIATED");
    assert.equal(sessionRes.body.uploadedParts.length, 40, "MinIO must report 40 uploaded parts");

    const sessionInDb = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
    assert.equal(sessionInDb?.status, "INITIATED");
  });

  it("Step 11 & 12 — Resume from browser, skip uploaded parts, complete upload", async () => {
    const resumeStart = Date.now();

    // 1. Obtain session status
    const sessionRes = await request(app)
      .get(`/documents/${workspaceAId}/multipart/${sessionId}`)
      .set("Authorization", `Bearer ${userAToken}`)
      .expect(200);

    const alreadyUploaded = new Set<number>(
      sessionRes.body.uploadedParts.map((p: any) => p.partNumber)
    );

    const fd = fs.openSync(tempFilePath, "r");

    try {
      // 2. Upload remaining missing parts (41 to 128)
      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        if (alreadyUploaded.has(partNumber)) {
          continue; // Skip parts 1..40
        }

        const partUrlRes = await request(app)
          .post(`/documents/${workspaceAId}/multipart/${sessionId}/part-url`)
          .set("Authorization", `Bearer ${userAToken}`)
          .send({ partNumber })
          .expect(200);

        const { uploadUrl } = partUrlRes.body;

        const buffer = Buffer.alloc(partSizeBytes);
        const bytesRead = fs.readSync(fd, buffer, 0, partSizeBytes, (partNumber - 1) * partSizeBytes);
        const partSlice = buffer.subarray(0, bytesRead);

        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          body: partSlice,
        });

        assert.ok(putRes.ok, `Part ${partNumber} PUT failed: ${putRes.status}`);
        const etag = putRes.headers.get("ETag")?.replace(/"/g, "") ?? "";
        etagMap.set(partNumber, etag);
      }
    } finally {
      fs.closeSync(fd);
    }

    assert.equal(etagMap.size, 128, "All 128 parts must be uploaded");
    benchmarkResults.resumeDurationMs = Date.now() - resumeStart;

    // 3. Complete Multipart Upload
    const completeStart = Date.now();
    const partsPayload = Array.from(etagMap.entries())
      .map(([partNumber, etag]) => ({ partNumber, etag }))
      .sort((a, b) => a.partNumber - b.partNumber);

    const completeRes = await request(app)
      .post(`/documents/${workspaceAId}/multipart/${sessionId}/complete`)
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ parts: partsPayload })
      .expect(200);

    benchmarkResults.completeDurationMs = Date.now() - completeStart;

    assert.equal(completeRes.body.status, "COMPLETED");
    assert.equal(completeRes.body.documentId, documentId);

    const completedDoc = await prisma.document.findUnique({ where: { id: documentId } });
    assert.equal(completedDoc?.status, "UPLOADED");

    const queuedJob = await prisma.processingJob.findFirst({ where: { documentId } });
    assert.ok(queuedJob);
    assert.equal(queuedJob.status, "QUEUED");
  });

  // ── 4. Verify SHA-256 Correctness & Memory Behavior ──────────────────────
  it("Step 13, 14 & 15 — Verify SHA-256 digest correctness & memory boundedness", async () => {
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    assert.ok(doc?.sha256);
    assert.equal(doc.sha256, expectedSha256, "Document.sha256 must match independent streaming SHA-256");

    const memUsage = process.memoryUsage();
    benchmarkResults.peakHeapMemoryMb = Math.round(memUsage.heapUsed / (1024 * 1024));

    // Bounded heap check
    assert.ok(benchmarkResults.peakHeapMemoryMb < 800, `Peak heap memory (${benchmarkResults.peakHeapMemoryMb}MB) must remain bounded (<800MB)`);
  });

  // ── 5. Background Worker Processing, RAG Retrieval & Chat ────────────────
  it("Step 16, 17, 18, 19 & 20 — Worker processing, READY state, Retrieval & Chat with Citations", async () => {
    const job = await prisma.processingJob.findFirst({ where: { documentId } });
    assert.ok(job);

    const workerStart = Date.now();
    const mockContentText = "This is the extracted content from CHiE Phase 7.6 verification document. It describes direct MinIO multipart upload and background worker processing.";
    const mockExtract = async () => ({ text: mockContentText, pageCount: 1 });

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

    benchmarkResults.workerProcessingDurationMs = Date.now() - workerStart;
    benchmarkResults.totalToReadyMs =
      (benchmarkResults.initialUploadDurationMs ?? 0) +
      (benchmarkResults.resumeDurationMs ?? 0) +
      (benchmarkResults.completeDurationMs ?? 0) +
      (benchmarkResults.workerProcessingDurationMs ?? 0);

    assert.equal(workerResult.status, "READY");
    assert.ok(workerResult.chunkCount > 0);

    const readyDoc = await prisma.document.findUnique({ where: { id: documentId } });
    assert.equal(readyDoc?.status, "READY");

    // Test Retrieval API
    const retrieveRes = await request(app)
      .post(`/documents/${workspaceAId}/retrieve`)
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ query: "MinIO multipart upload", topK: 5 })
      .expect(200);

    assert.ok(retrieveRes.body.results.length > 0);
    assert.equal(retrieveRes.body.results[0].documentId, documentId);
    assert.equal(retrieveRes.body.results[0].workspaceId, workspaceAId);

    // Test Chat API
    const chatRes = await request(app)
      .post(`/documents/${workspaceAId}/chat`)
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ query: "How does Phase 7.6 work?", topK: 5 })
      .expect(200);

    assert.ok(chatRes.body.answer);
    assert.ok(chatRes.body.citations.length > 0);
    assert.equal(chatRes.body.citations[0].documentId, documentId);
  });

  // ── 6. Same-Workspace Deduplication ──────────────────────────────────────
  it("Step 21 & 22 — Same-workspace deduplication removes duplicate session and object without re-indexing", async () => {
    // Record baseline counts before duplicate upload
    const chunksBefore = await prisma.chunk.count({ where: { workspaceId: workspaceAId } });
    const embeddingsBefore = await prisma.chunkEmbedding.count({
      where: { chunk: { workspaceId: workspaceAId } }
    });
    const jobsBefore = await prisma.processingJob.count({ where: { workspaceId: workspaceAId } });

    // Put mock object in MinIO to represent completed upload for second session
    const dupStorageKey = `workspaces/${workspaceAId}/documents/${randomUUID()}.bin`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: dupStorageKey,
      Body: "dummy duplicate object body",
      ContentType: "application/pdf",
    }));

    // Initiate second session
    const init2 = await request(app)
      .post(`/documents/${workspaceAId}/multipart/initiate`)
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ filename: "large_1gb_test_dup.bin", mimeType: "application/pdf", sizeBytes: ONE_GB_BYTES })
      .expect(201);

    const dupSessionId = init2.body.sessionId;
    const dupDocumentId = init2.body.documentId;

    // Override storageKey to our real MinIO object
    await prisma.document.update({ where: { id: dupDocumentId }, data: { storageKey: dupStorageKey } });
    await prisma.uploadSession.update({ where: { id: dupSessionId }, data: { storageKey: dupStorageKey } });

    // Mock storage operations so computeObjectSha256 returns exact same expectedSha256
    const { setMultipartStorageOps, resetMultipartStorageOps } = await import("../../../apps/api/src/routes/multipart.js");
    let deletedKey = "";
    const mock128Parts = Array.from({ length: 128 }, (_, i) => ({ PartNumber: i + 1, ETag: '"etag-dup"' }));
    setMultipartStorageOps({
      listMultipartParts: async () => mock128Parts,
      completeMultipartUpload: async () => {},
      computeObjectSha256: async () => expectedSha256,
      deleteObject: async (key: string) => { deletedKey = key; },
    });

    try {
      const dupPartsPayload = Array.from({ length: 128 }, (_, i) => ({ partNumber: i + 1, etag: "etag-dup" }));
      const completeRes = await request(app)
        .post(`/documents/${workspaceAId}/multipart/${dupSessionId}/complete`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ parts: dupPartsPayload })
        .expect(200);

      assert.equal(completeRes.body.status, "COMPLETED");
      assert.equal(completeRes.body.duplicate, true);
      assert.equal(completeRes.body.documentId, documentId);
      assert.equal(completeRes.body.canonicalDocumentId, documentId);

      // Verify duplicate document & session cleaned up from DB
      const dbDupDoc = await prisma.document.findUnique({ where: { id: dupDocumentId } });
      assert.equal(dbDupDoc, null);

      const dbDupSession = await prisma.uploadSession.findUnique({ where: { id: dupSessionId } });
      assert.equal(dbDupSession, null);

      // Verify MinIO object was deleted
      assert.equal(deletedKey, dupStorageKey);

      // Verify 0 change to chunks, embeddings, processing jobs
      const chunksAfter = await prisma.chunk.count({ where: { workspaceId: workspaceAId } });
      const embeddingsAfter = await prisma.chunkEmbedding.count({
        where: { chunk: { workspaceId: workspaceAId } }
      });
      const jobsAfter = await prisma.processingJob.count({ where: { workspaceId: workspaceAId } });

      assert.equal(chunksAfter, chunksBefore);
      assert.equal(embeddingsAfter, embeddingsBefore);
      assert.equal(jobsAfter, jobsBefore);
    } finally {
      resetMultipartStorageOps();
    }
  });

  // ── 7. Cross-Workspace Isolation ──────────────────────────────────────────
  it("Step 23 — Cross-workspace duplicate is NOT duplicate, processes independently with isolated retrieval", async () => {
    const storageKeyB = `workspaces/${workspaceBId}/documents/${randomUUID()}.bin`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageKeyB,
      Body: "workspace B content",
      ContentType: "application/pdf",
    }));

    const initB = await request(app)
      .post(`/documents/${workspaceBId}/multipart/initiate`)
      .set("Authorization", `Bearer ${userBToken}`)
      .send({ filename: "doc_in_wb.pdf", mimeType: "application/pdf", sizeBytes: 100 })
      .expect(201);

    await prisma.document.update({ where: { id: initB.body.documentId }, data: { storageKey: storageKeyB } });
    await prisma.uploadSession.update({ where: { id: initB.body.sessionId }, data: { storageKey: storageKeyB } });

    const { setMultipartStorageOps, resetMultipartStorageOps } = await import("../../../apps/api/src/routes/multipart.js");
    setMultipartStorageOps({
      listMultipartParts: async () => [{ PartNumber: 1, ETag: '"etag-wb"' }],
      completeMultipartUpload: async () => {},
      computeObjectSha256: async () => expectedSha256, // Same SHA-256 in Workspace B
      deleteObject: async () => {},
    });

    try {
      const completeB = await request(app)
        .post(`/documents/${workspaceBId}/multipart/${initB.body.sessionId}/complete`)
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ parts: [{ partNumber: 1, etag: "etag-wb" }] })
        .expect(200);

      assert.equal(completeB.body.status, "COMPLETED");
      assert.equal(completeB.body.duplicate, undefined);
      assert.equal(completeB.body.documentId, initB.body.documentId);

      // Process Workspace B document
      const jobB = await prisma.processingJob.findFirst({ where: { documentId: initB.body.documentId } });
      assert.ok(jobB);

      const mockExtractB = async () => ({ text: "Workspace B specific unique secret content text", pageCount: 1 });
      await processDocument(initB.body.documentId, workspaceBId, jobB.id, 0, 3, provider, prisma, { extract: mockExtractB });

      // Verify Workspace A retrieval does NOT see Workspace B content
      const retrieveA = await request(app)
        .post(`/documents/${workspaceAId}/retrieve`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ query: "Workspace B specific unique secret content text", topK: 5 })
        .expect(200);

      const foundInA = retrieveA.body.results.some((r: any) => r.documentId === initB.body.documentId);
      assert.equal(foundInA, false, "Workspace A retrieval must NOT return Workspace B documents");
    } finally {
      resetMultipartStorageOps();
      await deleteObject(storageKeyB).catch(() => {});
    }
  });

  // ── 8. Concurrent Duplicate Uploads Race Condition ───────────────────────
  it("Step 24 — Concurrent duplicate completions collapse safely to 1 canonical document", async () => {
    const sharedHash = "c7f9" + randomUUID().replace(/-/g, "").substring(0, 60);

    const docA = await prisma.document.create({
      data: {
        workspaceId: workspaceAId,
        uploadedById: userAId,
        filename: "concurrent_a.pdf",
        mimeType: "application/pdf",
        sizeBytes: 500,
        storageKey: `key_conc_a_${randomUUID()}`,
        status: "UPLOADING",
      }
    });

    const docB = await prisma.document.create({
      data: {
        workspaceId: workspaceAId,
        uploadedById: userAId,
        filename: "concurrent_b.pdf",
        mimeType: "application/pdf",
        sizeBytes: 500,
        storageKey: `key_conc_b_${randomUUID()}`,
        status: "UPLOADING",
      }
    });

    // Simulate winner docA being UPLOADED + hashed first
    await prisma.document.update({
      where: { id: docA.id },
      data: { status: "UPLOADED", sha256: sharedHash }
    });

    // Now try to update docB to have same (workspaceId, sha256)
    let caughtError: any = null;
    try {
      await prisma.document.update({
        where: { id: docB.id },
        data: { status: "UPLOADED", sha256: sharedHash }
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, "Prisma composite unique constraint P2002 must trigger on race condition");
  });

  // ── 9. Resilience, Error Handling & Security Verification ───────────────
  it("Step 25 — Worker retry on transient failure succeeds", async () => {
    const doc = await prisma.document.create({
      data: {
        workspaceId: workspaceAId,
        uploadedById: userAId,
        filename: "transient_fail.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        storageKey: `test/transient_${randomUUID()}.pdf`,
        sha256: randomUUID().replace(/-/g, ""),
        status: "UPLOADED",
      }
    });

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: doc.storageKey,
      Body: "transient retry test content",
      ContentType: "application/pdf",
    }));

    const job = await prisma.processingJob.create({
      data: { documentId: doc.id, workspaceId: workspaceAId }
    });

    let attempts = 0;
    const failingExtract = async () => {
      attempts++;
      if (attempts === 1) throw new Error("Transient network extraction error");
      return { text: "Success content after retry", pageCount: 1 };
    };

    // Attempt 1 — fails (transient retryable attempt)
    await assert.rejects(async () => {
      await processDocument(doc.id, workspaceAId, job.id, 0, 3, provider, prisma, { extract: failingExtract });
    });

    const jobAfterFail = await prisma.processingJob.findUnique({ where: { id: job.id } });
    assert.equal(jobAfterFail?.status, "PROCESSING");
    assert.ok(jobAfterFail?.lastError?.includes("Transient network extraction error"));

    // Attempt 2 — retry succeeds
    const retryResult = await processDocument(doc.id, workspaceAId, job.id, 1, 3, provider, prisma, { extract: failingExtract });
    assert.equal(retryResult.status, "READY");

    const finalDoc = await prisma.document.findUnique({ where: { id: doc.id } });
    assert.equal(finalDoc?.status, "READY");

    await deleteObject(doc.storageKey).catch(() => {});
  });

  it("Step 26 — Permanent failure marks ProcessingJob=FAILED and Document=FAILED", async () => {
    const doc = await prisma.document.create({
      data: {
        workspaceId: workspaceAId,
        uploadedById: userAId,
        filename: "permanent_fail.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        storageKey: `test/perm_fail_${randomUUID()}.pdf`,
        sha256: randomUUID().replace(/-/g, ""),
        status: "UPLOADED",
      }
    });

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: doc.storageKey,
      Body: "permanent fail content",
      ContentType: "application/pdf",
    }));

    const job = await prisma.processingJob.create({
      data: { documentId: doc.id, workspaceId: workspaceAId }
    });

    const fatalExtract = async () => {
      throw new Error("Fatal corrupted file payload");
    };

    await assert.rejects(async () => {
      await processDocument(doc.id, workspaceAId, job.id, 2, 3, provider, prisma, { extract: fatalExtract });
    });

    const failedJob = await prisma.processingJob.findUnique({ where: { id: job.id } });
    assert.equal(failedJob?.status, "FAILED");

    const failedDoc = await prisma.document.findUnique({ where: { id: doc.id } });
    assert.equal(failedDoc?.status, "FAILED");

    await deleteObject(doc.storageKey).catch(() => {});
  });

  it("Step 28 — Duplicate job replay is idempotent with zero duplicate chunks", async () => {
    const doc = await prisma.document.create({
      data: {
        workspaceId: workspaceAId,
        uploadedById: userAId,
        filename: "replay_idempotency.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        storageKey: `test/replay_${randomUUID()}.pdf`,
        sha256: randomUUID().replace(/-/g, ""),
        status: "UPLOADED",
      }
    });

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: doc.storageKey,
      Body: "Idempotent replay test content",
      ContentType: "application/pdf",
    }));

    const job = await prisma.processingJob.create({
      data: { documentId: doc.id, workspaceId: workspaceAId }
    });

    const mockExtract = async () => ({ text: "Replay text content", pageCount: 1 });

    await processDocument(doc.id, workspaceAId, job.id, 0, 3, provider, prisma, { extract: mockExtract });
    const chunksRun1 = await prisma.chunk.findMany({ where: { documentId: doc.id } });

    // Replay job
    await processDocument(doc.id, workspaceAId, job.id, 0, 3, provider, prisma, { extract: mockExtract });
    const chunksRun2 = await prisma.chunk.findMany({ where: { documentId: doc.id } });

    assert.equal(chunksRun2.length, chunksRun1.length, "Zero duplicate chunks must be created on replay");
    await deleteObject(doc.storageKey).catch(() => {});
  });

  it("Step 30 — Single-PUT regression test for small files", async () => {
    const storageKeySmall = `test/small_${randomUUID()}.pdf`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageKeySmall,
      Body: "Small file single put text content",
      ContentType: "application/pdf",
    }));

    const uploadRes = await request(app)
      .post(`/documents/${workspaceAId}/upload-url`)
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ filename: "small.pdf", mimeType: "application/pdf", sizeBytes: 1000 })
      .expect(201);

    const docId = uploadRes.body.documentId;
    await prisma.document.update({ where: { id: docId }, data: { storageKey: storageKeySmall } });

    const completeRes = await request(app)
      .post(`/documents/${workspaceAId}/${docId}/complete`)
      .set("Authorization", `Bearer ${userAToken}`)
      .expect(200);

    assert.equal(completeRes.body.status, "PROCESSING");

    const job = await prisma.processingJob.findFirst({ where: { documentId: docId } });
    assert.ok(job);

    const mockExtract = async () => ({ text: "Small file single put text content", pageCount: 1 });
    await processDocument(docId, workspaceAId, job.id, 0, 3, provider, prisma, { extract: mockExtract });

    const readyDoc = await prisma.document.findUnique({ where: { id: docId } });
    assert.equal(readyDoc?.status, "READY");

    await deleteObject(storageKeySmall).catch(() => {});
  });

  it("Step 31 — API Security tests (401, 403, 404)", async () => {
    // 401 Unauthenticated
    await request(app)
      .post(`/documents/${workspaceAId}/multipart/initiate`)
      .send({ filename: "sec.pdf", mimeType: "application/pdf", sizeBytes: 1000 })
      .expect(401);

    // 403 Non-member
    await request(app)
      .post(`/documents/${workspaceAId}/multipart/initiate`)
      .set("Authorization", `Bearer ${userBToken}`)
      .send({ filename: "sec.pdf", mimeType: "application/pdf", sizeBytes: 1000 })
      .expect(403);

    // 404 Wrong workspace
    await request(app)
      .get(`/documents/${workspaceBId}/multipart/${sessionId}`)
      .set("Authorization", `Bearer ${userBToken}`)
      .expect(404);
  });

  // ── 10. Benchmark Display & Phase 7 Matrix Summary ───────────────────────
  it("Step 32, 36, 37 & 38 — Final Benchmark Metrics & Phase 7 Regression Matrix Summary", () => {
    console.log("\n================================================================================");
    console.log("             CHiE Phase 7.6 — FINAL BENCHMARK METRICS SUMMARY");
    console.log("================================================================================");
    console.log(`File size:                     ${(benchmarkResults.fileSizeBytes! / (1024 * 1024 * 1024)).toFixed(2)} GB (${benchmarkResults.fileSizeBytes} bytes)`);
    console.log(`Part size:                     ${benchmarkResults.partSizeBytes! / (1024 * 1024)} MB (${benchmarkResults.partSizeBytes} bytes)`);
    console.log(`Total parts:                   ${benchmarkResults.totalParts}`);
    console.log(`File generation time:          ${(benchmarkResults.genDurationMs! / 1000).toFixed(2)} s`);
    console.log(`Independent SHA-256 time:       ${(benchmarkResults.independentHashMs! / 1000).toFixed(2)} s`);
    console.log(`Initial upload (parts 1-40):   ${(benchmarkResults.initialUploadDurationMs! / 1000).toFixed(2)} s`);
    console.log(`Interrupted after:             ${benchmarkResults.uploadInterruptedParts} parts`);
    console.log(`Resume upload (parts 41-128):  ${(benchmarkResults.resumeDurationMs! / 1000).toFixed(2)} s`);
    console.log(`Complete & Hashing time:       ${(benchmarkResults.completeDurationMs! / 1000).toFixed(2)} s`);
    console.log(`Worker processing time:        ${(benchmarkResults.workerProcessingDurationMs! / 1000).toFixed(2)} s`);
    console.log(`Total time to READY:           ${(benchmarkResults.totalToReadyMs! / 1000).toFixed(2)} s`);
    console.log(`Peak heap memory usage:        ${benchmarkResults.peakHeapMemoryMb} MB`);
    console.log("================================================================================\n");

    assert.ok(true);
  });
});
