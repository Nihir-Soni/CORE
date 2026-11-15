import { describe, before, after, it } from "node:test";
import assert from "node:assert";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

import { prisma, withWorkspaceContext, disconnectDatabase } from "@core/database";
import { env } from "@core/shared";
import { app } from "../src/index.js";
import { documentProcessingQueue } from "@core/jobs";

describe("Phase 8.2 — Worker → SSE Document Processing Progress", () => {
  let orgId: string;
  let workspaceA: string;
  let workspaceB: string;
  let memberUserId: string;
  let memberToken: string;
  let nonMemberUserId: string;
  let nonMemberToken: string;

  before(async () => {
    const org = await prisma.organization.create({
      data: { name: `Progress Test Org ${randomUUID()}` },
    });
    orgId = org.id;

    const member = await prisma.user.create({
      data: {
        email: `prog_member_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId,
      },
    });
    memberUserId = member.id;
    memberToken = jwt.sign({ userId: memberUserId, orgId }, env.JWT_SECRET);

    const nonMember = await prisma.user.create({
      data: {
        email: `prog_nonmember_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId,
      },
    });
    nonMemberUserId = nonMember.id;
    nonMemberToken = jwt.sign(
      { userId: nonMemberUserId, orgId },
      env.JWT_SECRET,
    );

    const wsA = await prisma.workspace.create({
      data: {
        name: "Workspace A",
        orgId,
        memberships: {
          create: { userId: memberUserId, role: "MEMBER" },
        },
      },
    });
    workspaceA = wsA.id;

    const wsB = await prisma.workspace.create({
      data: {
        name: "Workspace B",
        orgId,
        memberships: {
          create: { userId: memberUserId, role: "MEMBER" },
        },
      },
    });
    workspaceB = wsB.id;
  });

  after(async () => {
    await documentProcessingQueue.close();
    await disconnectDatabase();
  });

  describe("Security & Isolation", () => {
    it("8.2.1 - unauthenticated request returns 401", async () => {
      const res = await request(app).get(
        `/documents/${workspaceA}/fake-doc/progress`,
      );
      assert.strictEqual(res.status, 401);
    });

    it("8.2.2 - invalid query token returns 401", async () => {
      const res = await request(app).get(
        `/documents/${workspaceA}/fake-doc/progress?token=bad-token`,
      );
      assert.strictEqual(res.status, 401);
    });

    it("8.2.3 - authenticated non-member returns 403", async () => {
      const doc = await withWorkspaceContext(workspaceA, async (tx) => {
        return tx.document.create({
          data: {
            workspaceId: workspaceA,
            uploadedById: memberUserId,
            filename: "sec.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storageKey: `test/sec_${randomUUID()}.pdf`,
            status: "UPLOADED",
          },
        });
      });

      const res = await request(app)
        .get(`/documents/${workspaceA}/${doc.id}/progress`)
        .set("Authorization", `Bearer ${nonMemberToken}`);

      assert.strictEqual(res.status, 403);
    });

    it("8.2.4 - unknown workspace ID returns 404", async () => {
      const fakeWs = randomUUID();
      const res = await request(app)
        .get(`/documents/${fakeWs}/fake-doc/progress`)
        .set("Authorization", `Bearer ${memberToken}`);

      assert.strictEqual(res.status, 404);
    });

    it("8.2.5 - document belonging to another workspace returns 404", async () => {
      const docInA = await withWorkspaceContext(workspaceA, async (tx) => {
        return tx.document.create({
          data: {
            workspaceId: workspaceA,
            uploadedById: memberUserId,
            filename: "docInA.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storageKey: `test/docA_${randomUUID()}.pdf`,
            status: "UPLOADED",
          },
        });
      });

      // Attempt to access document in Workspace A via Workspace B path
      const res = await request(app)
        .get(`/documents/${workspaceB}/${docInA.id}/progress`)
        .set("Authorization", `Bearer ${memberToken}`);

      assert.strictEqual(res.status, 404);
    });
  });

  describe("Initial State & Terminal Reconnection", () => {
    it("8.2.6 - connecting to READY document immediately returns READY 100% and complete event", async () => {
      const docReady = await withWorkspaceContext(workspaceA, async (tx) => {
        return tx.document.create({
          data: {
            workspaceId: workspaceA,
            uploadedById: memberUserId,
            filename: "ready.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storageKey: `test/ready_${randomUUID()}.pdf`,
            status: "READY",
            processingJobs: {
              create: {
                workspaceId: workspaceA,
                status: "COMPLETED",
                progress: 100,
                progressMessage: "Document ready",
              },
            },
          },
        });
      });

      const res = await request(app)
        .get(`/documents/${workspaceA}/${docReady.id}/progress`)
        .set("Authorization", `Bearer ${memberToken}`);

      assert.strictEqual(res.status, 200);
      const text = res.text;

      assert.ok(text.includes('"status":"READY"'));
      assert.ok(text.includes('"progress":100'));
      assert.ok(text.includes('event: complete'));
    });

    it("8.2.7 - connecting to FAILED document immediately returns FAILED and error event", async () => {
      const docFailed = await withWorkspaceContext(workspaceA, async (tx) => {
        return tx.document.create({
          data: {
            workspaceId: workspaceA,
            uploadedById: memberUserId,
            filename: "failed.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storageKey: `test/failed_${randomUUID()}.pdf`,
            status: "FAILED",
            processingJobs: {
              create: {
                workspaceId: workspaceA,
                status: "FAILED",
                progress: 30,
                progressMessage: "Corrupt file format",
                lastError: "Corrupt file format",
              },
            },
          },
        });
      });

      const res = await request(app)
        .get(`/documents/${workspaceA}/${docFailed.id}/progress`)
        .set("Authorization", `Bearer ${memberToken}`);

      assert.strictEqual(res.status, 200);
      const text = res.text;

      assert.ok(text.includes('"status":"FAILED"'));
      assert.ok(text.includes('"progress":30'));
      assert.ok(text.includes('"message":"Corrupt file format"'));
      assert.ok(text.includes('event: error'));
    });

    it("8.2.8 - reconnecting to QUEUED document emits initial state QUEUED 0%", async () => {
      const docQueued = await withWorkspaceContext(workspaceA, async (tx) => {
        return tx.document.create({
          data: {
            workspaceId: workspaceA,
            uploadedById: memberUserId,
            filename: "queued.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storageKey: `test/queued_${randomUUID()}.pdf`,
            status: "UPLOADED",
            processingJobs: {
              create: {
                workspaceId: workspaceA,
                status: "QUEUED",
                progress: 0,
                progressMessage: "Job queued",
              },
            },
          },
        });
      });

      setTimeout(async () => {
        await withWorkspaceContext(workspaceA, async (tx) => {
          await tx.document.update({
            where: { id: docQueued.id },
            data: { status: "READY" },
          });
        });
      }, 100);

      const res = await request(app)
        .get(`/documents/${workspaceA}/${docQueued.id}/progress`)
        .set("Authorization", `Bearer ${memberToken}`);

      assert.strictEqual(res.status, 200);
      const text = res.text;

      assert.ok(text.includes('"status":"QUEUED"'));
      assert.ok(text.includes('"progress":0'));
      assert.ok(text.includes('"message":"Job queued"'));
    });
  });

  describe("Live Progress Streaming", () => {
    it("8.2.9 - live observer streams milestone updates until READY complete", async () => {
      const { docLive, job } = await withWorkspaceContext(workspaceA, async (tx) => {
        const docLive = await tx.document.create({
          data: {
            workspaceId: workspaceA,
            uploadedById: memberUserId,
            filename: "live.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storageKey: `test/live_${randomUUID()}.pdf`,
            status: "PROCESSING",
          },
        });

        const job = await tx.processingJob.create({
          data: {
            documentId: docLive.id,
            workspaceId: workspaceA,
            status: "PROCESSING",
            progress: 10,
            progressMessage: "Processing document",
          },
        });
        return { docLive, job };
      });

      // Simulate worker advancing milestones in background
      setTimeout(async () => {
        await withWorkspaceContext(workspaceA, async (tx) => {
          await tx.processingJob.update({
            where: { id: job.id },
            data: { progress: 30, progressMessage: "Extracting document" },
          });
        });
      }, 600);

      setTimeout(async () => {
        await withWorkspaceContext(workspaceA, async (tx) => {
          await tx.processingJob.update({
            where: { id: job.id },
            data: { progress: 70, progressMessage: "Indexing document" },
          });
        });
      }, 1200);

      setTimeout(async () => {
        await withWorkspaceContext(workspaceA, async (tx) => {
          await tx.document.update({
            where: { id: docLive.id },
            data: { status: "READY" },
          });
          await tx.processingJob.update({
            where: { id: job.id },
            data: { status: "COMPLETED", progress: 100, progressMessage: "Document ready" },
          });
        });
      }, 1800);

      const res = await request(app)
        .get(`/documents/${workspaceA}/${docLive.id}/progress`)
        .set("Authorization", `Bearer ${memberToken}`);

      assert.strictEqual(res.status, 200);
      const text = res.text;

      assert.ok(text.includes('"progress":10'));
      assert.ok(text.includes('"progress":30'));
      assert.ok(text.includes('"progress":70'));
      assert.ok(text.includes('"progress":100'));
      assert.ok(text.includes('event: complete'));
    });
  });
});
