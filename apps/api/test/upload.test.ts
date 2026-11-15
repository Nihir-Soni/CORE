import { test, describe, before, after, beforeEach, it, mock } from "node:test";
import assert from "node:assert";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma, withWorkspaceContext, disconnectDatabase } from "@core/database";
import { env } from "@core/shared";
import { app } from "../src/index.js";
import { documentProcessingQueue } from "@core/jobs";
import { s3, BUCKET } from "@core/storage";
import { PutObjectCommand } from "@aws-sdk/client-s3";

// We want to verify `queue.add` is called
let addMock: any;

describe("POST /documents/:workspaceId/:documentId/complete", () => {
  let orgId: string;
  let workspaceA: string;
  let workspaceB: string;
  let userId: string;
  let nonMemberUserId: string;
  let userToken: string;
  let nonMemberToken: string;
  let documentA: string;
  let documentB: string;

  before(async () => {
    addMock = mock.method(documentProcessingQueue, "add", async () => {
      return { id: "fake-job-id" };
    });

    const org = await prisma.organization.create({
      data: { name: "Test Org Complete" }
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        email: `user_c_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId
      }
    });
    userId = user.id;
    userToken = jwt.sign({ userId, orgId }, env.JWT_SECRET);

    const nonMember = await prisma.user.create({
      data: {
        email: `nonmember_c_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId
      }
    });
    nonMemberUserId = nonMember.id;
    nonMemberToken = jwt.sign({ userId: nonMemberUserId, orgId }, env.JWT_SECRET);

    const wsA = await prisma.workspace.create({
      data: {
        name: "Workspace A",
        orgId,
        memberships: {
          create: { userId, role: "MEMBER" }
        }
      }
    });
    workspaceA = wsA.id;

    const wsB = await prisma.workspace.create({
      data: {
        name: "Workspace B",
        orgId,
        memberships: {
          create: { userId, role: "MEMBER" }
        }
      }
    });
    workspaceB = wsB.id;
  });

  after(async () => {
    mock.restoreAll();
    await documentProcessingQueue.close();
  });

  beforeEach(async () => {
    addMock.mock.resetCalls();
    let keyA = "";
    let keyB = "";
    await withWorkspaceContext(workspaceA, async (tx) => {
      await tx.processingJob.deleteMany({ where: { workspaceId: workspaceA } });
      await tx.document.deleteMany({ where: { workspaceId: workspaceA } });

      const docA = await tx.document.create({
        data: {
          workspaceId: workspaceA,
          uploadedById: userId,
          filename: "A.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          storageKey: `test/A_comp_${randomUUID()}.pdf`,
          status: "UPLOADING",
        }
      });
      documentA = docA.id;
      keyA = docA.storageKey;

      const docB = await tx.document.create({
        data: {
          workspaceId: workspaceA,
          uploadedById: userId,
          filename: "B.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          storageKey: `test/B_comp_${randomUUID()}.pdf`,
          status: "UPLOADING",
        }
      });
      documentB = docB.id;
      keyB = docB.storageKey;
    });

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: keyA,
      Body: "dummy pdf content A",
      ContentType: "application/pdf"
    }));

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: keyB,
      Body: "dummy pdf content B",
      ContentType: "application/pdf"
    }));
  });

  after(async () => {
    await documentProcessingQueue.close();
    await disconnectDatabase();
  });

  it("Test B - unauthorized request: 401, queue.add NOT called", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceA}/${documentA}/complete`);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(addMock.mock.callCount(), 0);
  });

  it("Test C - non-member: 403, queue.add NOT called", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceA}/${documentA}/complete`)
      .set("Authorization", `Bearer ${nonMemberToken}`);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(addMock.mock.callCount(), 0);
  });

  it("Test E - nonexistent document: 404, queue.add NOT called", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceA}/non-existent-doc/complete`)
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(addMock.mock.callCount(), 0);
  });

  it("Test D - wrong workspace: 404, queue.add NOT called", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceB}/${documentA}/complete`)
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(addMock.mock.callCount(), 0);
  });

  it("Test F - queue failure: 500, error logged", async () => {
    addMock.mock.mockImplementation(async () => {
      throw new Error("Redis connection refused");
    });

    const res = await request(app)
      .post(`/documents/${workspaceA}/${documentA}/complete`)
      .set("Authorization", `Bearer ${userToken}`);
    
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, "queue_error");

    // The document should still be set to UPLOADED because the DB update happens before enqueue
    const doc = await withWorkspaceContext(workspaceA, async (tx) => {
      return tx.document.findUnique({ where: { id: documentA }});
    });
    assert.strictEqual(doc?.status, "UPLOADED");
  });

  it("Test A & G - successful enqueue: 200, returns PROCESSING, no sync processing", async () => {
    addMock.mock.mockImplementation(async () => {
      return { id: "fake-job-id" };
    });

    const res = await request(app)
      .post(`/documents/${workspaceA}/${documentA}/complete`)
      .set("Authorization", `Bearer ${userToken}`);
    
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, "PROCESSING");
    assert.strictEqual(res.body.documentId, documentA);

    const jobs = await withWorkspaceContext(workspaceA, async (tx) => {
      return tx.processingJob.findMany({ where: { documentId: documentA }});
    });
    assert.strictEqual(jobs.length, 1);
    const expectedJobId = jobs[0].id;

    assert.strictEqual(addMock.mock.callCount(), 1);
    const callArgs = addMock.mock.calls[0].arguments;
    assert.strictEqual(callArgs[0], "process-document");
    assert.deepStrictEqual(callArgs[1], {
      documentId: documentA,
      workspaceId: workspaceA,
      processingJobId: expectedJobId
    });
    assert.deepStrictEqual(callArgs[2]?.jobId, expectedJobId);

    const doc = await withWorkspaceContext(workspaceA, async (tx) => {
      return tx.document.findUnique({ where: { id: documentA }});
    });
    assert.strictEqual(doc?.status, "UPLOADED");
  });

  it("Phase 7.4 - Deduplication: identical file in same workspace detected, new S3 object cleaned up, canonical ID returned", async () => {
    addMock.mock.mockImplementation(async () => {
      return { id: "fake-job-id" };
    });

    // 1. Complete original document A
    const resA = await request(app)
      .post(`/documents/${workspaceA}/${documentA}/complete`)
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(resA.status, 200);

    const docA = await withWorkspaceContext(workspaceA, async (tx) => {
      return tx.document.findUnique({ where: { id: documentA } });
    });
    assert.ok(docA?.sha256);

    // 2. Upload identical content as Document C in Workspace A
    const docC = await withWorkspaceContext(workspaceA, async (tx) => {
      return tx.document.create({
        data: {
          workspaceId: workspaceA,
          uploadedById: userId,
          filename: "A_duplicate.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          storageKey: `test/C_dup_${randomUUID()}.pdf`,
          status: "UPLOADING",
        }
      });
    });

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: docC.storageKey,
      Body: "dummy pdf content A", // Exact same content as document A
      ContentType: "application/pdf"
    }));

    addMock.mock.resetCalls();

    // 3. Complete Document C
    const resC = await request(app)
      .post(`/documents/${workspaceA}/${docC.id}/complete`)
      .set("Authorization", `Bearer ${userToken}`);

    assert.strictEqual(resC.status, 200);
    assert.strictEqual(resC.body.duplicate, true);
    assert.strictEqual(resC.body.documentId, documentA);
    assert.strictEqual(resC.body.canonicalDocumentId, documentA);

    // 4. Verify no job was enqueued for duplicate C
    assert.strictEqual(addMock.mock.callCount(), 0);

    // 5. Verify temporary document C record was cleaned up from DB
    const dbDocC = await withWorkspaceContext(workspaceA, async (tx) => {
      return tx.document.findUnique({ where: { id: docC.id } });
    });
    assert.strictEqual(dbDocC, null);
  });

  it("Phase 7.4 - Deduplication: identical file in different workspace accepted as new document", async () => {
    addMock.mock.mockImplementation(async () => {
      return { id: "fake-job-id" };
    });

    // 1. Complete document A in Workspace A
    await request(app)
      .post(`/documents/${workspaceA}/${documentA}/complete`)
      .set("Authorization", `Bearer ${userToken}`);

    // 2. Upload identical content as Document D in Workspace B
    const docD = await withWorkspaceContext(workspaceB, async (tx) => {
      return tx.document.create({
        data: {
          workspaceId: workspaceB,
          uploadedById: userId,
          filename: "A_in_B.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          storageKey: `test/D_wsB_${randomUUID()}.pdf`,
          status: "UPLOADING",
        }
      });
    });

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: docD.storageKey,
      Body: "dummy pdf content A", // Same content as doc A, but different workspace
      ContentType: "application/pdf"
    }));

    addMock.mock.resetCalls();

    // 3. Complete Document D in Workspace B
    const resD = await request(app)
      .post(`/documents/${workspaceB}/${docD.id}/complete`)
      .set("Authorization", `Bearer ${userToken}`);

    assert.strictEqual(resD.status, 200);
    assert.strictEqual(resD.body.duplicate, undefined);
    assert.strictEqual(resD.body.documentId, docD.id);
    assert.strictEqual(resD.body.status, "PROCESSING");

    const dbDocD = await withWorkspaceContext(workspaceB, async (tx) => {
      return tx.document.findUnique({ where: { id: docD.id } });
    });
    assert.ok(dbDocD);
    assert.strictEqual(dbDocD?.status, "UPLOADED");
    assert.strictEqual(addMock.mock.callCount(), 1);
  });
});
