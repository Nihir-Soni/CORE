import { describe, before, after, it, mock } from "node:test";
import assert from "node:assert";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma, disconnectDatabase } from "@core/database";
import { env } from "@core/shared";
import { app } from "../src/index.js";
import { generateInvitationToken, hashInvitationToken } from "../src/lib/invitationToken.js";
import { documentProcessingQueue } from "@core/jobs";

describe("Phase 12: Workspace Member Management & Invitations", () => {
  let orgId: string;
  let workspaceA: string;
  let workspaceB: string;

  let ownerId: string;
  let ownerEmail: string;
  let ownerToken: string;

  let admin1Id: string;
  let admin1Email: string;
  let admin1Token: string;

  let admin2Id: string;
  let admin2Email: string;
  let admin2Token: string;

  let memberId: string;
  let memberEmail: string;
  let memberToken: string;

  let outsiderId: string;
  let outsiderEmail: string;
  let outsiderToken: string;

  before(async () => {
    // 1. Create Organization
    const org = await prisma.organization.create({
      data: { name: `Org Members Test ${randomUUID()}` },
    });
    orgId = org.id;

    // 2. Create Users
    ownerEmail = `owner_${randomUUID()}@test.com`.toLowerCase();
    const owner = await prisma.user.create({
      data: { email: ownerEmail, name: "Alice Owner", passwordHash: "x", orgId },
    });
    ownerId = owner.id;
    ownerToken = jwt.sign({ userId: ownerId, email: ownerEmail }, env.JWT_SECRET);

    admin1Email = `admin1_${randomUUID()}@test.com`.toLowerCase();
    const admin1 = await prisma.user.create({
      data: { email: admin1Email, name: "Bob Admin", passwordHash: "x", orgId },
    });
    admin1Id = admin1.id;
    admin1Token = jwt.sign({ userId: admin1Id, email: admin1Email }, env.JWT_SECRET);

    admin2Email = `admin2_${randomUUID()}@test.com`.toLowerCase();
    const admin2 = await prisma.user.create({
      data: { email: admin2Email, name: "Charlie Admin", passwordHash: "x", orgId },
    });
    admin2Id = admin2.id;
    admin2Token = jwt.sign({ userId: admin2Id, email: admin2Email }, env.JWT_SECRET);

    memberEmail = `member_${randomUUID()}@test.com`.toLowerCase();
    const member = await prisma.user.create({
      data: { email: memberEmail, name: "David Member", passwordHash: "x", orgId },
    });
    memberId = member.id;
    memberToken = jwt.sign({ userId: memberId, email: memberEmail }, env.JWT_SECRET);

    outsiderEmail = `outsider_${randomUUID()}@test.com`.toLowerCase();
    const outsider = await prisma.user.create({
      data: { email: outsiderEmail, name: "Eve Outsider", passwordHash: "x", orgId },
    });
    outsiderId = outsider.id;
    outsiderToken = jwt.sign({ userId: outsiderId, email: outsiderEmail }, env.JWT_SECRET);

    // 3. Workspace A with owner, admin1, admin2, member
    const wsA = await prisma.workspace.create({
      data: {
        name: "Workspace A",
        orgId,
        memberships: {
          create: [
            { userId: ownerId, role: "OWNER" },
            { userId: admin1Id, role: "ADMIN" },
            { userId: admin2Id, role: "ADMIN" },
            { userId: memberId, role: "MEMBER" },
          ],
        },
      },
    });
    workspaceA = wsA.id;

    // 4. Workspace B with outsider as OWNER only
    const wsB = await prisma.workspace.create({
      data: {
        name: "Workspace B",
        orgId,
        memberships: {
          create: [{ userId: outsiderId, role: "OWNER" }],
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

  describe("1. Authentication & Permission Matrix", () => {
    it("unauthenticated request to list members returns 401 missing_token", async () => {
      const res = await request(app).get(`/workspaces/${workspaceA}/members`);
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, "missing_token");
    });

    it("non-member request to list members returns 403 forbidden", async () => {
      const res = await request(app)
        .get(`/workspaces/${workspaceA}/members`)
        .set("Authorization", `Bearer ${outsiderToken}`);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, "forbidden");
    });

    it("MEMBER role request to list members returns 403 forbidden", async () => {
      const res = await request(app)
        .get(`/workspaces/${workspaceA}/members`)
        .set("Authorization", `Bearer ${memberToken}`);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, "forbidden");
    });

    it("ADMIN can list members and receives safe member metadata without credentials", async () => {
      const res = await request(app)
        .get(`/workspaces/${workspaceA}/members`)
        .set("Authorization", `Bearer ${admin1Token}`);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.strictEqual(res.body.length, 4);

      // Verify no sensitive fields
      for (const m of res.body) {
        assert.ok(m.userId);
        assert.ok(m.role);
        assert.ok(m.email);
        assert.strictEqual(m.passwordHash, undefined);
        assert.strictEqual(m.tokenHash, undefined);
      }
    });

    it("OWNER can list members", async () => {
      const res = await request(app)
        .get(`/workspaces/${workspaceA}/members`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body));
    });
  });

  describe("2. Invitations Lifecycle & Permissions", () => {
    let createdInvitationId: string;
    let inviteToken: string;
    const testInviteeEmail = `invitee_${randomUUID()}@test.com`.toLowerCase();

    it("MEMBER cannot create invitations (403 forbidden)", async () => {
      const res = await request(app)
        .post(`/workspaces/${workspaceA}/invitations`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ email: testInviteeEmail, role: "MEMBER" });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, "forbidden");
    });

    it("cannot invite as OWNER (400 cannot_invite_owner)", async () => {
      const res = await request(app)
        .post(`/workspaces/${workspaceA}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: testInviteeEmail, role: "OWNER" });
      assert.strictEqual(res.status, 400);
    });

    it("cannot invite an existing member (409 already_member)", async () => {
      const res = await request(app)
        .post(`/workspaces/${workspaceA}/invitations`)
        .set("Authorization", `Bearer ${admin1Token}`)
        .send({ email: memberEmail, role: "MEMBER" });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error, "already_member");
    });

    it("ADMIN can create an invitation for MEMBER role and does not expose tokenHash", async () => {
      const res = await request(app)
        .post(`/workspaces/${workspaceA}/invitations`)
        .set("Authorization", `Bearer ${admin1Token}`)
        .send({ email: testInviteeEmail, role: "MEMBER" });

      assert.strictEqual(res.status, 201);
      assert.ok(res.body.id);
      assert.strictEqual(res.body.email, testInviteeEmail);
      assert.strictEqual(res.body.role, "MEMBER");
      assert.strictEqual(res.body.status, "PENDING");
      // tokenHash is strictly hidden
      assert.strictEqual(res.body.tokenHash, undefined);

      createdInvitationId = res.body.id;
      // In dev mode, inviteUrl is returned
      if (res.body.inviteUrl) {
        const parts = res.body.inviteUrl.split("/invite/");
        inviteToken = parts[1];
      }
    });

    it("ordinary list invitations never returns raw token or tokenHash", async () => {
      const res = await request(app)
        .get(`/workspaces/${workspaceA}/invitations`)
        .set("Authorization", `Bearer ${admin1Token}`);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body));
      const found = res.body.find((i: any) => i.id === createdInvitationId);
      assert.ok(found);
      assert.strictEqual(found.token, undefined);
      assert.strictEqual(found.tokenHash, undefined);
      assert.strictEqual(found.email, testInviteeEmail);
      assert.strictEqual(found.status, "PENDING");
    });

    it("ADMIN can revoke a pending invitation", async () => {
      const res = await request(app)
        .delete(`/workspaces/${workspaceA}/invitations/${createdInvitationId}`)
        .set("Authorization", `Bearer ${admin1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, "REVOKED");

      // Verify DB status
      const check = await prisma.invitation.findUnique({
        where: { id: createdInvitationId },
      });
      assert.strictEqual(check?.status, "REVOKED");
    });

    it("revoking already revoked invitation returns 400 invitation_not_pending", async () => {
      const res = await request(app)
        .delete(`/workspaces/${workspaceA}/invitations/${createdInvitationId}`)
        .set("Authorization", `Bearer ${admin1Token}`);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, "invitation_not_pending");
    });
  });

  describe("3. Acceptance Security & Token Lifecycle", () => {
    let acceptUserEmail: string;
    let acceptUserId: string;
    let acceptUserToken: string;

    let validToken: string;
    let validTokenHash: string;
    let validInvitationId: string;

    let expiredToken: string;
    let expiredTokenHash: string;

    let revokedToken: string;
    let revokedTokenHash: string;

    before(async () => {
      acceptUserEmail = `acceptuser_${randomUUID()}@test.com`.toLowerCase();
      const user = await prisma.user.create({
        data: { email: acceptUserEmail, name: "Accept User", passwordHash: "x", orgId },
      });
      acceptUserId = user.id;
      acceptUserToken = jwt.sign({ userId: acceptUserId, email: acceptUserEmail }, env.JWT_SECRET);

      // Create valid invitation
      const t1 = generateInvitationToken();
      validToken = t1.token;
      validTokenHash = t1.tokenHash;
      const inv1 = await prisma.invitation.create({
        data: {
          workspaceId: workspaceA,
          email: acceptUserEmail,
          role: "ADMIN",
          tokenHash: validTokenHash,
          status: "PENDING",
          expiresAt: t1.expiresAt,
          invitedById: ownerId,
        },
      });
      validInvitationId = inv1.id;

      // Create expired invitation
      const t2 = generateInvitationToken();
      expiredToken = t2.token;
      expiredTokenHash = t2.tokenHash;
      await prisma.invitation.create({
        data: {
          workspaceId: workspaceA,
          email: acceptUserEmail,
          role: "MEMBER",
          tokenHash: expiredTokenHash,
          status: "PENDING",
          expiresAt: new Date(Date.now() - 10000), // Expired in the past
          invitedById: ownerId,
        },
      });

      // Create revoked invitation
      const t3 = generateInvitationToken();
      revokedToken = t3.token;
      revokedTokenHash = t3.tokenHash;
      await prisma.invitation.create({
        data: {
          workspaceId: workspaceA,
          email: acceptUserEmail,
          role: "MEMBER",
          tokenHash: revokedTokenHash,
          status: "REVOKED",
          expiresAt: t3.expiresAt,
          invitedById: ownerId,
        },
      });
    });

    it("public token inspection returns safe details for valid token", async () => {
      const res = await request(app).get(`/invitations/${validToken}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.workspaceId, workspaceA);
      assert.strictEqual(res.body.email, acceptUserEmail);
      assert.strictEqual(res.body.role, "ADMIN");
      assert.strictEqual(res.body.status, "PENDING");
      assert.strictEqual(res.body.tokenHash, undefined);
    });

    it("inspecting invalid token returns 404 invitation_not_found", async () => {
      const res = await request(app).get(`/invitations/non-existent-token`);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, "invitation_not_found");
    });

    it("unauthenticated acceptance returns 401 missing_token", async () => {
      const res = await request(app)
        .post("/invitations/accept")
        .send({ token: validToken });
      assert.strictEqual(res.status, 401);
    });

    it("acceptance rejects when authenticated email does not match invitation (403 email_mismatch)", async () => {
      // outsider attempts to accept an invitation meant for acceptUserEmail
      const res = await request(app)
        .post("/invitations/accept")
        .set("Authorization", `Bearer ${outsiderToken}`)
        .send({ token: validToken });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, "email_mismatch");
    });

    it("acceptance rejects expired invitation (400 invitation_expired)", async () => {
      const res = await request(app)
        .post("/invitations/accept")
        .set("Authorization", `Bearer ${acceptUserToken}`)
        .send({ token: expiredToken });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, "invitation_expired");
    });

    it("acceptance rejects revoked invitation (400 invitation_revoked)", async () => {
      const res = await request(app)
        .post("/invitations/accept")
        .set("Authorization", `Bearer ${acceptUserToken}`)
        .send({ token: revokedToken });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, "invitation_revoked");
    });

    it("successful acceptance establishes membership with authorized role and marks invitation ACCEPTED", async () => {
      const res = await request(app)
        .post("/invitations/accept")
        .set("Authorization", `Bearer ${acceptUserToken}`)
        .send({ token: validToken });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.workspaceId, workspaceA);
      assert.strictEqual(res.body.role, "ADMIN");

      // Verify membership was created with ADMIN role
      const mem = await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: acceptUserId, workspaceId: workspaceA } },
      });
      assert.ok(mem);
      assert.strictEqual(mem.role, "ADMIN");

      // Verify invitation status is ACCEPTED
      const inv = await prisma.invitation.findUnique({
        where: { id: validInvitationId },
      });
      assert.strictEqual(inv?.status, "ACCEPTED");
    });

    it("accepting an already accepted invitation is rejected (400 invitation_already_accepted)", async () => {
      const res = await request(app)
        .post("/invitations/accept")
        .set("Authorization", `Bearer ${acceptUserToken}`)
        .send({ token: validToken });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, "invitation_already_accepted");
    });
  });

  describe("4. Role Modification Permissions & Guards", () => {
    it("ADMIN cannot change member roles (403 forbidden)", async () => {
      const res = await request(app)
        .patch(`/workspaces/${workspaceA}/members/${memberId}/role`)
        .set("Authorization", `Bearer ${admin1Token}`)
        .send({ role: "ADMIN" });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, "forbidden");
    });

    it("OWNER cannot promote a member to OWNER (400 cannot_grant_owner)", async () => {
      const res = await request(app)
        .patch(`/workspaces/${workspaceA}/members/${memberId}/role`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ role: "OWNER" });

      assert.strictEqual(res.status, 400);
    });

    it("OWNER can promote a MEMBER to ADMIN", async () => {
      const res = await request(app)
        .patch(`/workspaces/${workspaceA}/members/${memberId}/role`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ role: "ADMIN" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.role, "ADMIN");

      const mem = await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: memberId, workspaceId: workspaceA } },
      });
      assert.strictEqual(mem?.role, "ADMIN");
    });

    it("demoting the last OWNER of a workspace is rejected (400 cannot_demote_last_owner)", async () => {
      // workspaceA currently has only 1 OWNER (ownerId)
      const res = await request(app)
        .patch(`/workspaces/${workspaceA}/members/${ownerId}/role`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ role: "ADMIN" });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, "cannot_demote_last_owner");
    });
  });

  describe("5. Member Removal Permissions & Safeguards", () => {
    it("ADMIN cannot remove an OWNER (403 forbidden)", async () => {
      const res = await request(app)
        .delete(`/workspaces/${workspaceA}/members/${ownerId}`)
        .set("Authorization", `Bearer ${admin1Token}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, "forbidden");
    });

    it("ADMIN cannot remove another ADMIN (403 admin_cannot_remove_admin)", async () => {
      const res = await request(app)
        .delete(`/workspaces/${workspaceA}/members/${admin2Id}`)
        .set("Authorization", `Bearer ${admin1Token}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, "admin_cannot_remove_admin");
    });

    it("cannot remove the last OWNER (400 cannot_remove_last_owner)", async () => {
      const res = await request(app)
        .delete(`/workspaces/${workspaceA}/members/${ownerId}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, "cannot_remove_last_owner");
    });

    it("OWNER can remove an ADMIN member and preserves user account", async () => {
      const res = await request(app)
        .delete(`/workspaces/${workspaceA}/members/${admin2Id}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.removedUserId, admin2Id);

      // Verify membership is removed
      const mem = await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: admin2Id, workspaceId: workspaceA } },
      });
      assert.strictEqual(mem, null);

      // Verify User account is still intact
      const user = await prisma.user.findUnique({
        where: { id: admin2Id },
      });
      assert.ok(user);
      assert.strictEqual(user.id, admin2Id);
    });

    it("ADMIN can remove a MEMBER", async () => {
      // Demote memberId back to MEMBER first
      await prisma.membership.update({
        where: { userId_workspaceId: { userId: memberId, workspaceId: workspaceA } },
        data: { role: "MEMBER" },
      });

      const res = await request(app)
        .delete(`/workspaces/${workspaceA}/members/${memberId}`)
        .set("Authorization", `Bearer ${admin1Token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.removedUserId, memberId);

      const mem = await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: memberId, workspaceId: workspaceA } },
      });
      assert.strictEqual(mem, null);
    });
  });
});
