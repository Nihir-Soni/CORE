import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../src/index.js";
import { prisma, withWorkspaceContext } from "@core/database";
import jwt from "jsonwebtoken";
import { env } from "@core/shared";
import { randomUUID } from "node:crypto";
import { documentProcessingQueue } from "@core/jobs";

describe("POST /documents/:workspaceId/upload-url", () => {
  let orgId: string;
  let workspaceId: string;
  let userId: string;
  let userToken: string;

  before(async () => {
    const org = await prisma.organization.create({
      data: { name: `Upload Test Org ${randomUUID()}` },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        email: `uploader_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId,
      },
    });
    userId = user.id;
    userToken = jwt.sign({ userId, orgId }, env.JWT_SECRET);

    const ws = await prisma.workspace.create({
      data: {
        name: "Upload Workspace",
        orgId,
        memberships: {
          create: { userId, role: "MEMBER" },
        },
      },
    });
    workspaceId = ws.id;
  });

  after(async () => {
    await withWorkspaceContext(workspaceId, async (tx) => {
      await tx.document.deleteMany({ where: { workspaceId } });
    });
    await documentProcessingQueue.close();
  });

  it("successfully requests upload URL for a PNG file with image/png", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceId}/upload-url`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        filename: "screenshot.png",
        mimeType: "image/png",
        sizeBytes: 2048,
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.documentId);
    assert.ok(res.body.uploadUrl);
    assert.ok(res.body.uploadUrl.includes("screenshot.png") || res.body.uploadUrl.length > 0);
  });

  it("successfully normalizes legacy image/x-png to image/png for .png files", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceId}/upload-url`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        filename: "legacy_format.png",
        mimeType: "image/x-png",
        sizeBytes: 1024,
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.documentId);
    assert.ok(res.body.uploadUrl);

    // Verify stored document has normalized mimeType
    const doc = await withWorkspaceContext(workspaceId, async (tx) => {
      return tx.document.findUnique({
        where: { id: res.body.documentId },
      });
    });
    assert.equal(doc?.mimeType, "image/png");
  });

  it("successfully infers image/png from filename when mimeType is empty", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceId}/upload-url`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        filename: "untyped_diagram.png",
        mimeType: "",
        sizeBytes: 512,
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.documentId);
    const doc = await withWorkspaceContext(workspaceId, async (tx) => {
      return tx.document.findUnique({
        where: { id: res.body.documentId },
      });
    });
    assert.equal(doc?.mimeType, "image/png");
  });

  it("rejects unsupported file formats like executable .exe", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceId}/upload-url`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        filename: "malware.exe",
        mimeType: "application/x-msdownload",
        sizeBytes: 1024,
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "unsupported_file_type");
  });
});
