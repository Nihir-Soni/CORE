import { describe, before, after, it, mock } from "node:test";
import assert from "node:assert";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma, disconnectDatabase, withWorkspaceContext } from "@core/database";
import { env } from "@core/shared";
import { app } from "../src/index.js";
import { documentProcessingQueue } from "@core/jobs";

describe("Audit Logs & Activity Tracking", () => {
  let orgId: string;
  let workspaceId: string;

  let ownerId: string;
  let ownerEmail: string;
  let ownerToken: string;

  let adminId: string;
  let adminEmail: string;
  let adminToken: string;

  let memberId: string;
  let memberEmail: string;
  let memberToken: string;

  before(async () => {
    // 1. Create Organization
    const org = await prisma.organization.create({
      data: { name: `Audit Test Org ${randomUUID()}` },
    });
    orgId = org.id;

    // 2. Create Users
    ownerEmail = `audit_owner_${randomUUID()}@test.com`.toLowerCase();
    const owner = await prisma.user.create({
      data: { email: ownerEmail, name: "Audit Owner", passwordHash: "x", orgId },
    });
    ownerId = owner.id;
    ownerToken = jwt.sign({ userId: ownerId, email: ownerEmail }, env.JWT_SECRET);

    adminEmail = `audit_admin_${randomUUID()}@test.com`.toLowerCase();
    const admin = await prisma.user.create({
      data: { email: adminEmail, name: "Audit Admin", passwordHash: "x", orgId },
    });
    adminId = admin.id;
    adminToken = jwt.sign({ userId: adminId, email: adminEmail }, env.JWT_SECRET);

    memberEmail = `audit_member_${randomUUID()}@test.com`.toLowerCase();
    const member = await prisma.user.create({
      data: { email: memberEmail, name: "Audit Member", passwordHash: "x", orgId },
    });
    memberId = member.id;
    memberToken = jwt.sign({ userId: memberId, email: memberEmail }, env.JWT_SECRET);

    // 3. Workspace
    const ws = await prisma.workspace.create({
      data: {
        name: "Audit Workspace",
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
    workspaceId = ws.id;
  });

  after(async () => {
    mock.restoreAll();
    await documentProcessingQueue.close();
    await prisma.$disconnect();
    await disconnectDatabase();
  });

  it("denies access to audit logs for unauthenticated users (401)", async () => {
    const res = await request(app).get(`/workspaces/${workspaceId}/audit-logs`);
    assert.strictEqual(res.status, 401);
  });

  it("denies access to audit logs for MEMBER role (403)", async () => {
    const res = await request(app)
      .get(`/workspaces/${workspaceId}/audit-logs`)
      .set("Authorization", `Bearer ${memberToken}`);
    assert.strictEqual(res.status, 403);
  });

  it("allows access to audit logs for ADMIN and OWNER (200)", async () => {
    const adminRes = await request(app)
      .get(`/workspaces/${workspaceId}/audit-logs`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.strictEqual(adminRes.status, 200);
    assert.ok(Array.isArray(adminRes.body.logs));

    const ownerRes = await request(app)
      .get(`/workspaces/${workspaceId}/audit-logs`)
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.strictEqual(ownerRes.status, 200);
    assert.ok(Array.isArray(ownerRes.body.logs));
  });

  it("records an audit log when a member is invited", async () => {
    const inviteeEmail = `invitee_${randomUUID()}@test.com`.toLowerCase();
    const res = await request(app)
      .post(`/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: inviteeEmail, role: "MEMBER" });

    assert.strictEqual(res.status, 201);

    // Fetch audit logs
    const auditRes = await request(app)
      .get(`/workspaces/${workspaceId}/audit-logs?action=MEMBER_INVITED`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.strictEqual(auditRes.status, 200);
    const log = auditRes.body.logs.find(
      (l: any) => l.action === "MEMBER_INVITED" && l.resourceName === inviteeEmail
    );
    assert.ok(log, "Expected MEMBER_INVITED audit log to exist");
    assert.strictEqual(log.userId, adminId);
    assert.strictEqual(log.user.email, adminEmail);
    assert.strictEqual(log.details?.role, "MEMBER");
  });

  it("records an audit log when a member permission/role is changed", async () => {
    const res = await request(app)
      .patch(`/workspaces/${workspaceId}/members/${memberId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "ADMIN" });

    assert.strictEqual(res.status, 200);

    const auditRes = await request(app)
      .get(`/workspaces/${workspaceId}/audit-logs?action=ROLE_CHANGED`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.strictEqual(auditRes.status, 200);
    const log = auditRes.body.logs.find(
      (l: any) => l.action === "ROLE_CHANGED" && l.resourceId === memberId
    );
    assert.ok(log, "Expected ROLE_CHANGED audit log to exist");
    assert.strictEqual(log.userId, ownerId);
    assert.strictEqual(log.details?.oldRole, "MEMBER");
    assert.strictEqual(log.details?.newRole, "ADMIN");
  });

  it("records audit logs for document download", async () => {
    // Create a mock document in the database
    const doc = await withWorkspaceContext(workspaceId, async (tx) => {
      return tx.document.create({
        data: {
          workspaceId,
          uploadedById: ownerId,
          filename: "test-policy.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          storageKey: `workspaces/${workspaceId}/docs/${randomUUID()}/test-policy.pdf`,
          status: "READY",
        },
      });
    });

    // Request download-url
    const downloadRes = await request(app)
      .get(`/documents/${workspaceId}/${doc.id}/download-url`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.strictEqual(downloadRes.status, 200);

    // Verify DOCUMENT_DOWNLOADED log
    const auditRes = await request(app)
      .get(`/workspaces/${workspaceId}/audit-logs?action=DOCUMENT_DOWNLOADED`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.strictEqual(auditRes.status, 200);
    const log = auditRes.body.logs.find(
      (l: any) => l.action === "DOCUMENT_DOWNLOADED" && l.resourceId === doc.id
    );
    assert.ok(log, "Expected DOCUMENT_DOWNLOADED audit log to exist");
    assert.strictEqual(log.userId, adminId);
    assert.strictEqual(log.resourceName, "test-policy.pdf");
  });

  it("records audit logs for document deletion", async () => {
    // Create a mock document
    const doc = await withWorkspaceContext(workspaceId, async (tx) => {
      return tx.document.create({
        data: {
          workspaceId,
          uploadedById: ownerId,
          filename: "obsolete-spec.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          storageKey: `workspaces/${workspaceId}/docs/${randomUUID()}/obsolete-spec.pdf`,
          status: "READY",
        },
      });
    });

    // Delete the document
    const deleteRes = await request(app)
      .delete(`/documents/${workspaceId}/${doc.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.strictEqual(deleteRes.status, 200);

    // Verify DOCUMENT_DELETED log
    const auditRes = await request(app)
      .get(`/workspaces/${workspaceId}/audit-logs?action=DOCUMENT_DELETED`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.strictEqual(auditRes.status, 200);
    const log = auditRes.body.logs.find(
      (l: any) => l.action === "DOCUMENT_DELETED" && l.resourceId === doc.id
    );
    assert.ok(log, "Expected DOCUMENT_DELETED audit log to exist");
    assert.strictEqual(log.userId, ownerId);
    assert.strictEqual(log.resourceName, "obsolete-spec.pdf");
  });
});
