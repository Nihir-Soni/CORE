import { describe, before, after, it } from "node:test";
import assert from "node:assert";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import { prisma } from "@core/database";
import { env } from "@core/shared";
import { documentProcessingQueue } from "@core/jobs";
import { s3, BUCKET } from "@core/storage";
import { app } from "../../../apps/api/src/index.js";
import { processDocument } from "../src/processDocument.js";
import type { AIProvider } from "@core/ai";

class MockProvider implements AIProvider {
  async embed(text: string): Promise<number[]> {
    const vec = new Array(768).fill(0.01);
    vec[0] = text.length / 1000.0;
    return vec;
  }
  async chat() {
    return "mock response";
  }
}

describe("Phase 8.2 — End-to-End Document Processing Progress Pipeline", () => {
  let orgId: string;
  let workspaceId: string;
  let userId: string;
  let userToken: string;
  let provider: MockProvider;

  before(async () => {
    provider = new MockProvider();

    const org = await prisma.organization.create({
      data: { name: `E2E Progress Org ${randomUUID()}` },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        email: `e2e_prog_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId,
      },
    });
    userId = user.id;
    userToken = jwt.sign({ userId, orgId }, env.JWT_SECRET);

    const ws = await prisma.workspace.create({
      data: {
        name: "E2E Progress Workspace",
        orgId,
        memberships: {
          create: { userId, role: "MEMBER" },
        },
      },
    });
    workspaceId = ws.id;
  });

  after(async () => {
    await documentProcessingQueue.close();
  });

  it("19.1 - full E2E lifecycle: upload -> complete -> QUEUED (0%) -> worker -> PROCESSING (10%->30%->70%) -> READY (100%) -> SSE complete", async () => {
    // 1. Request upload URL
    const uploadUrlRes = await request(app)
      .post(`/documents/${workspaceId}/upload-url`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        filename: "e2e_sample.pdf",
        mimeType: "application/pdf",
        sizeBytes: 250,
      });

    assert.strictEqual(uploadUrlRes.status, 201);
    const { documentId, uploadUrl } = uploadUrlRes.body;
    assert.ok(documentId);
    assert.ok(uploadUrl);

    // 2. Upload file directly to S3/MinIO
    const storageDoc = await prisma.document.findUnique({ where: { id: documentId } });
    assert.ok(storageDoc);

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: storageDoc.storageKey,
        Body: Buffer.from("Sample PDF content for E2E document progress verification testing."),
        ContentType: "application/pdf",
      }),
    );

    // 3. Mark upload complete -> creates ProcessingJob with QUEUED 0%
    const completeRes = await request(app)
      .post(`/documents/${workspaceId}/${documentId}/complete`)
      .set("Authorization", `Bearer ${userToken}`);

    assert.strictEqual(completeRes.status, 200);
    assert.strictEqual(completeRes.body.status, "PROCESSING");

    const job = await prisma.processingJob.findFirst({
      where: { documentId },
    });
    assert.ok(job);
    assert.strictEqual(job.status, "QUEUED");
    assert.strictEqual(job.progress, 0);
    assert.strictEqual(job.progressMessage, "Job queued");

    // 4. Open SSE progress endpoint before worker finishes
    const ssePromise = request(app)
      .get(`/documents/${workspaceId}/${documentId}/progress`)
      .set("Authorization", `Bearer ${userToken}`);

    // 5. Run worker processing in background
    setTimeout(async () => {
      await processDocument(
        documentId,
        workspaceId,
        job.id,
        0,
        3,
        provider,
        prisma,
        {
          download: async () => {
            await new Promise((r) => setTimeout(r, 600));
            return Buffer.from("Sample extracted text content for E2E testing.");
          },
          extract: async () => {
            await new Promise((r) => setTimeout(r, 600));
            return {
              text: "Extracted text content for E2E testing.",
              pageCount: 1,
              characterCount: 40,
            };
          },
        },
      );
    }, 150);

    const sseRes = await ssePromise;
    assert.strictEqual(sseRes.status, 200);

    const text = sseRes.text;

    // Verify progress events recorded in stream
    assert.ok(text.includes('"progress":0'), "contains QUEUED 0%");
    assert.ok(text.includes('"progress":10'), "contains PROCESSING 10%");
    assert.ok(text.includes('"progress":30'), "contains EXTRACTING 30%");
    assert.ok(text.includes('"progress":70'), "contains INDEXING 70%");
    assert.ok(text.includes('"progress":100'), "contains READY 100%");
    assert.ok(text.includes('event: complete'), "contains complete event");

    // Verify database final state
    const finalDoc = await prisma.document.findUnique({ where: { id: documentId } });
    assert.strictEqual(finalDoc?.status, "READY");

    const finalJob = await prisma.processingJob.findUnique({ where: { id: job.id } });
    assert.strictEqual(finalJob?.status, "COMPLETED");
    assert.strictEqual(finalJob?.progress, 100);
  });
});
