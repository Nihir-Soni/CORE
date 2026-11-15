import { describe, before, after, it } from "node:test";
import assert from "node:assert";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma, disconnectDatabase } from "@core/database";
import { env } from "@core/shared";
import { app } from "../src/index.js";

describe("Workspace Listing & Creation (Switcher Support)", () => {
  let orgId: string;
  let user1Id: string;
  let user1Email: string;
  let user1Token: string;

  let workspace1Id: string;
  let workspace2Id: string;

  before(async () => {
    // 1. Create Organization
    const org = await prisma.organization.create({
      data: { name: `Org Switcher Test ${randomUUID()}` },
    });
    orgId = org.id;

    // 2. Create User 1
    user1Email = `user1_${randomUUID()}@test.com`.toLowerCase();
    const user1 = await prisma.user.create({
      data: { email: user1Email, name: "User One", passwordHash: "x", orgId },
    });
    user1Id = user1.id;
    user1Token = jwt.sign({ userId: user1Id, email: user1Email }, env.JWT_SECRET);

    // 3. Create initial workspace 1
    const ws1 = await prisma.workspace.create({
      data: {
        name: "Initial Workspace",
        orgId,
        memberships: {
          create: [{ userId: user1Id, role: "OWNER" }],
        },
      },
    });
    workspace1Id = ws1.id;

    // 4. Create initial workspace 2 with member role
    const ws2 = await prisma.workspace.create({
      data: {
        name: "Secondary Workspace",
        orgId,
        memberships: {
          create: [{ userId: user1Id, role: "MEMBER" }],
        },
      },
    });
    workspace2Id = ws2.id;
  });

  after(async () => {
    await prisma.membership.deleteMany({ where: { userId: user1Id } }).catch(() => {});
    await prisma.workspace.deleteMany({ where: { orgId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: user1Id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
    await disconnectDatabase().catch(() => {});
  });

  it("GET /workspaces requires authentication", async () => {
    const res = await request(app).get("/workspaces");
    assert.strictEqual(res.status, 401);
  });

  it("GET /workspaces returns all workspaces user is a member of with roles", async () => {
    const res = await request(app)
      .get("/workspaces")
      .set("Authorization", `Bearer ${user1Token}`);

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.strictEqual(res.body.length, 2);

    const ws1 = res.body.find((w: any) => w.id === workspace1Id);
    assert.ok(ws1);
    assert.strictEqual(ws1.name, "Initial Workspace");
    assert.strictEqual(ws1.role, "OWNER");
    assert.strictEqual(typeof ws1.memberCount, "number");
    assert.strictEqual(typeof ws1.documentCount, "number");

    const ws2 = res.body.find((w: any) => w.id === workspace2Id);
    assert.ok(ws2);
    assert.strictEqual(ws2.name, "Secondary Workspace");
    assert.strictEqual(ws2.role, "MEMBER");
  });

  it("POST /workspaces validates workspace name", async () => {
    const res = await request(app)
      .post("/workspaces")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({ name: "   " });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "invalid_request");
  });

  it("POST /workspaces creates a new workspace and sets creator as OWNER", async () => {
    const res = await request(app)
      .post("/workspaces")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({ name: "Project Apollo" });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.name, "Project Apollo");
    assert.strictEqual(res.body.role, "OWNER");
    assert.strictEqual(res.body.orgId, orgId);
    assert.ok(res.body.id);

    // Verify it is now listed in GET /workspaces
    const listRes = await request(app)
      .get("/workspaces")
      .set("Authorization", `Bearer ${user1Token}`);

    assert.strictEqual(listRes.status, 200);
    assert.strictEqual(listRes.body.length, 3);
    const created = listRes.body.find((w: any) => w.id === res.body.id);
    assert.ok(created);
    assert.strictEqual(created.name, "Project Apollo");
    assert.strictEqual(created.role, "OWNER");
  });
});
