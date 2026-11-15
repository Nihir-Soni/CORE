import { test, describe, before, after, it } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma, PrismaClient } from "@core/database";
import type { AIProvider } from "@core/ai";
import { processDocument } from "../src/processDocument.js";

// Mock implementations
async function mockDownload(key: string) {
  if (key.includes("fail_ext")) {
    return Buffer.from("fail text");
  }
  return Buffer.from("mocked file content");
}

async function mockExtract(buffer: Buffer, mimeType: string) {
  if (mimeType === "application/json") {
    throw new Error("Extraction failed: invalid format");
  }
  return {
    text: "This is extracted mock text for testing the worker.",
    pageCount: 1,
    characterCount: 50,
  };
}

const overrides = {
  download: mockDownload,
  extract: mockExtract,
};

class MockProvider implements AIProvider {
  public failOnNext = false;
  public callCount = 0;

  async embed(text: string): Promise<number[]> {
    this.callCount++;
    if (this.failOnNext) {
      this.failOnNext = false;
      throw new Error("Mock provider forced failure");
    }
    const vec = new Array(768).fill(0.01);
    vec[0] = text.length / 1000.0;
    const sqSum = vec.reduce((sum, v) => sum + v * v, 0);
    const mag = Math.sqrt(sqSum);
    return vec.map((v) => v / mag);
  }
  async chat() {
    return "mock";
  }
}

describe("processDocument", () => {
  let orgId: string;
  let workspaceA: string;
  let workspaceB: string;
  let provider: MockProvider;

  before(async () => {
    provider = new MockProvider();

    const org = await prisma.organization.create({
      data: { name: "Test Org Worker" },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        email: `worker_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId,
      },
    });

    const wsA = await prisma.workspace.create({
      data: {
        name: "Workspace A",
        orgId,
        memberships: { create: { userId: user.id, role: "MEMBER" } },
      },
    });
    workspaceA = wsA.id;

    const wsB = await prisma.workspace.create({
      data: {
        name: "Workspace B",
        orgId,
        memberships: { create: { userId: user.id, role: "MEMBER" } },
      },
    });
    workspaceB = wsB.id;
  });

  after(async () => {
    await prisma.$disconnect();
  });

  async function createDocAndJob(opts: { workspaceId: string, storageKey: string, mimeType?: string, status?: any, sha256?: string | null }) {
    const doc = await prisma.document.create({
      data: {
        workspaceId: opts.workspaceId,
        uploadedById: (await prisma.user.findFirst({ where: { orgId } }))!.id,
        filename: "test.pdf",
        mimeType: opts.mimeType || "application/pdf",
        sizeBytes: 100,
        storageKey: opts.storageKey,
        sha256: opts.sha256 !== undefined ? opts.sha256 : (randomUUID().replace(/-/g, "") + "0".repeat(32)),
        status: opts.status || "UPLOADED",
      },
    });

    const job = await prisma.processingJob.create({
      data: {
        documentId: doc.id,
        workspaceId: doc.workspaceId,
      }
    });

    return { doc, job };
  }

  it("Test A - successful processing", async () => {
    provider.callCount = 0;
    const { doc, job } = await createDocAndJob({ workspaceId: workspaceA, storageKey: `test/success_${randomUUID()}.pdf` });

    const result = await processDocument(doc.id, workspaceA, job.id, 0, 3, provider, prisma, overrides);

    assert.strictEqual(result.status, "READY");
    assert.strictEqual(result.documentId, doc.id);
    assert.ok(result.chunkCount > 0);
    assert.ok(result.embeddingCount > 0);

    const updatedDoc = await prisma.document.findUnique({ where: { id: doc.id } });
    assert.strictEqual(updatedDoc?.status, "READY");

    const updatedJob = await prisma.processingJob.findUnique({ where: { id: job.id } });
    assert.strictEqual(updatedJob?.status, "COMPLETED");
    assert.strictEqual(updatedJob?.progress, 100);
    assert.strictEqual(updatedJob?.progressMessage, "Document ready");
    assert.strictEqual(updatedJob?.attempts, 1);
    assert.ok(updatedJob?.startedAt);
    assert.ok(updatedJob?.completedAt);

    const content = await prisma.documentContent.findUnique({ where: { documentId: doc.id } });
    assert.ok(content);
    assert.strictEqual(content.text, "This is extracted mock text for testing the worker.");
  });

  it("Test missing sha256 throws UnrecoverableError", async () => {
    const { doc, job } = await createDocAndJob({ workspaceId: workspaceA, storageKey: `test/no_sha_${randomUUID()}.pdf`, sha256: null });

    let thrownError: any;
    try {
      await processDocument(doc.id, workspaceA, job.id, 0, 3, provider, prisma, overrides);
    } catch (e: any) {
      thrownError = e;
    }

    assert.ok(thrownError);
    assert.match(thrownError.message, /missing required sha256 content hash/);
    assert.strictEqual(thrownError.name, "UnrecoverableError");
  });

  it("Test B - missing document", async () => {
    const fakeId = randomUUID();
    const fakeJobId = randomUUID();
    let thrownError;
    try {
      await processDocument(fakeId, workspaceA, fakeJobId, 0, 3, provider, prisma, overrides);
    } catch (e: any) {
      thrownError = e;
    }
    assert.ok(thrownError);
    assert.match(thrownError.message, /Document not found/);
    assert.strictEqual(thrownError.name, "UnrecoverableError");
  });

  it("Test C - wrong workspace", async () => {
    const { doc, job } = await createDocAndJob({ workspaceId: workspaceA, storageKey: `test/wrong_ws_${randomUUID()}.pdf` });

    let thrownError;
    try {
      await processDocument(doc.id, workspaceB, job.id, 0, 3, provider, prisma, overrides);
    } catch (e: any) {
      thrownError = e;
    }
    assert.ok(thrownError);
    assert.match(thrownError.message, /Workspace mismatch/);
    assert.strictEqual(thrownError.name, "UnrecoverableError");

    const check = await prisma.document.findUnique({ where: { id: doc.id } });
    assert.notStrictEqual(check?.status, "FAILED"); 
  });

  it("Test D - extraction failure (transient then final)", async () => {
    const { doc, job } = await createDocAndJob({ workspaceId: workspaceA, storageKey: `test/fail_ext_${randomUUID()}.json`, mimeType: "application/json" });

    // Attempt 1 (transient)
    let err1;
    try {
        await processDocument(doc.id, workspaceA, job.id, 0, 3, provider, prisma, overrides);
    } catch (e) {
        err1 = e;
    }
    assert.ok(err1);
    
    let updatedJob = await prisma.processingJob.findUnique({ where: { id: job.id } });
    assert.notStrictEqual(updatedJob?.status, "FAILED");
    assert.strictEqual(updatedJob?.attempts, 1);
    
    let updatedDoc = await prisma.document.findUnique({ where: { id: doc.id } });
    assert.notStrictEqual(updatedDoc?.status, "FAILED"); // Document still PROCESSING

    // Attempt 2 (transient)
    let err2;
    try {
        await processDocument(doc.id, workspaceA, job.id, 1, 3, provider, prisma, overrides);
    } catch (e) {
        err2 = e;
    }
    assert.ok(err2);

    // Attempt 3 (final)
    let err3;
    try {
        await processDocument(doc.id, workspaceA, job.id, 2, 3, provider, prisma, overrides);
    } catch (e) {
        err3 = e;
    }
    assert.ok(err3);

    updatedJob = await prisma.processingJob.findUnique({ where: { id: job.id } });
    assert.strictEqual(updatedJob?.status, "FAILED");
    assert.strictEqual(updatedJob?.attempts, 3);
    assert.match(updatedJob?.lastError || "", /Extraction failed/);

    updatedDoc = await prisma.document.findUnique({ where: { id: doc.id } });
    assert.strictEqual(updatedDoc?.status, "FAILED");
  });

  it("Test E - embedding provider failure (transient) recovers", async () => {
    const { doc, job } = await createDocAndJob({ workspaceId: workspaceA, storageKey: `test/fail_emb_${randomUUID()}.pdf` });

    provider.failOnNext = true;

    // Attempt 1 fails
    let err1;
    try {
        await processDocument(doc.id, workspaceA, job.id, 0, 3, provider, prisma, overrides);
    } catch (e) { err1 = e; }
    assert.ok(err1);

    let updatedDoc = await prisma.document.findUnique({ where: { id: doc.id } });
    assert.notStrictEqual(updatedDoc?.status, "FAILED"); // Document not failed yet

    // Attempt 2 succeeds
    const result = await processDocument(doc.id, workspaceA, job.id, 1, 3, provider, prisma, overrides);
    assert.strictEqual(result.status, "READY");

    const finalJob = await prisma.processingJob.findUnique({ where: { id: job.id } });
    assert.strictEqual(finalJob?.status, "COMPLETED");
    assert.strictEqual(finalJob?.attempts, 2);
  });

  it("Test F - repeat processing (idempotency)", async () => {
    const { doc, job } = await createDocAndJob({ workspaceId: workspaceA, storageKey: `test/repeat_${randomUUID()}.pdf` });

    // Run 1
    provider.callCount = 0;
    await processDocument(doc.id, workspaceA, job.id, 0, 3, provider, prisma, overrides);
    const firstCallCount = provider.callCount;
    assert.ok(firstCallCount > 0);

    // Create another job to simulate a new run or duplicate trigger
    const job2 = await prisma.processingJob.create({
      data: {
        documentId: doc.id,
        workspaceId: doc.workspaceId,
      }
    });

    // Run 2 (Should not generate new embeddings)
    provider.callCount = 0;
    const result2 = await processDocument(doc.id, workspaceA, job2.id, 0, 3, provider, prisma, overrides);
    assert.strictEqual(result2.status, "READY");
    assert.strictEqual(provider.callCount, 0); // No new embeddings needed

    const finalJob2 = await prisma.processingJob.findUnique({ where: { id: job2.id } });
    assert.strictEqual(finalJob2?.status, "COMPLETED");

    // Ensure chunks aren't duplicated
    const chunks = await prisma.chunk.findMany({ where: { documentId: doc.id } });
    const uniqueChunks = new Set(chunks.map((c) => c.chunkIndex));
    assert.strictEqual(chunks.length, uniqueChunks.size);
  });
});
