import { describe, before, after, it, mock } from "node:test";
import assert from "node:assert";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma, disconnectDatabase, withWorkspaceContext } from "@core/database";
import { env } from "@core/shared";
import { app } from "../src/index.js";
import { documentProcessingQueue } from "@core/jobs";

describe("Workspace Analytics API", () => {
  let orgId: string;
  let workspaceId: string;

  let ownerId: string;
  let ownerEmail: string;
  let ownerToken: string;

  let memberId: string;
  let memberEmail: string;
  let memberToken: string;

  let outsiderId: string;
  let outsiderEmail: string;
  let outsiderToken: string;

  before(async () => {
    // 1. Create Organization
    const org = await prisma.organization.create({
      data: { name: `Analytics Test Org ${randomUUID()}` },
    });
    orgId = org.id;

    // 2. Create Users
    ownerEmail = `analytics_owner_${randomUUID()}@test.com`.toLowerCase();
    const owner = await prisma.user.create({
      data: { email: ownerEmail, name: "Analytics Owner", passwordHash: "x", orgId },
    });
    ownerId = owner.id;
    ownerToken = jwt.sign({ userId: ownerId, email: ownerEmail }, env.JWT_SECRET);

    memberEmail = `analytics_member_${randomUUID()}@test.com`.toLowerCase();
    const member = await prisma.user.create({
      data: { email: memberEmail, name: "Analytics Member", passwordHash: "x", orgId },
    });
    memberId = member.id;
    memberToken = jwt.sign({ userId: memberId, email: memberEmail }, env.JWT_SECRET);

    outsiderEmail = `analytics_outsider_${randomUUID()}@test.com`.toLowerCase();
    const outsider = await prisma.user.create({
      data: { email: outsiderEmail, name: "Analytics Outsider", passwordHash: "x", orgId },
    });
    outsiderId = outsider.id;
    outsiderToken = jwt.sign({ userId: outsiderId, email: outsiderEmail }, env.JWT_SECRET);

    // 3. Workspace
    const ws = await prisma.workspace.create({
      data: {
        name: "Analytics Workspace",
        orgId,
        memberships: {
          create: [
            { userId: ownerId, role: "OWNER" },
            { userId: memberId, role: "MEMBER" },
          ],
        },
      },
    });
    workspaceId = ws.id;

    // 4. Create sample document, chunks, jobs, and audit log
    await withWorkspaceContext(workspaceId, async (tx) => {
      const doc = await tx.document.create({
        data: {
          workspaceId,
          uploadedById: ownerId,
          filename: "Project_Specs.pdf",
          mimeType: "application/pdf",
          sizeBytes: 250000,
          storageKey: `workspaces/${workspaceId}/docs/${randomUUID()}/Project_Specs.pdf`,
          status: "READY",
        },
      });

      await tx.documentContent.create({
        data: {
          documentId: doc.id,
          text: "Full text content of project specifications",
          pageCount: 5,
          charCount: 42,
        },
      });

      await tx.processingJob.create({
        data: {
          workspaceId,
          documentId: doc.id,
          status: "COMPLETED",
          progress: 100,
          startedAt: new Date(Date.now() - 5000),
          completedAt: new Date(),
        },
      });

      await tx.chunk.create({
        data: {
          workspaceId,
          documentId: doc.id,
          chunkIndex: 0,
          content: "Sample chunk content",
          tokenCount: 120,
        },
      });

      await tx.auditLog.create({
        data: {
          workspaceId,
          userId: ownerId,
          action: "DOCUMENT_UPLOADED",
          resourceId: doc.id,
          resourceName: doc.filename,
        },
      });
    });
  });

  after(async () => {
    mock.restoreAll();
    await documentProcessingQueue.close();
    await prisma.$disconnect();
    await disconnectDatabase();
  });

  it("denies access to unauthenticated requests (401)", async () => {
    const res = await request(app).get(`/workspaces/${workspaceId}/analytics`);
    assert.strictEqual(res.status, 401);
  });

  it("denies access to non-workspace members (403)", async () => {
    const res = await request(app)
      .get(`/workspaces/${workspaceId}/analytics`)
      .set("Authorization", `Bearer ${outsiderToken}`);
    assert.strictEqual(res.status, 403);
  });

  it("allows access to workspace member and returns detailed statistics (200)", async () => {
    const res = await request(app)
      .get(`/workspaces/${workspaceId}/analytics`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.strictEqual(res.status, 200);

    // Verify document stats
    const { documentStats, storageStats, aiStats, queryStats } = res.body;
    assert.ok(documentStats);
    assert.strictEqual(documentStats.totalDocuments, 1);
    assert.strictEqual(documentStats.byStatus.READY, 1);
    assert.strictEqual(documentStats.totalPagesExtracted, 5);
    assert.ok(Array.isArray(documentStats.byMimeType));
    assert.ok(Array.isArray(documentStats.recentTrend));

    // Verify storage stats
    assert.ok(storageStats);
    assert.strictEqual(storageStats.totalBytes, 250000);
    assert.strictEqual(storageStats.largestDocument?.filename, "Project_Specs.pdf");
    assert.ok(Array.isArray(storageStats.byCategory));

    // Verify AI stats
    assert.ok(aiStats);
    assert.strictEqual(aiStats.totalChunks, 1);
    assert.strictEqual(aiStats.totalIndexedTokens, 120);
    assert.strictEqual(aiStats.avgTokensPerChunk, 120);

    // Verify query & audit stats
    assert.ok(queryStats);
    assert.strictEqual(queryStats.totalUploadEvents, 1);
  });
});
