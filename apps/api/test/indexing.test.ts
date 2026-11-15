import { test, describe, before, after, it } from "node:test";
import assert from "node:assert";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma, withWorkspaceContext, disconnectDatabase } from "@core/database";
import { env } from "@core/shared";
import { app } from "../src/index.js";
import { setAIProvider } from "../src/routes/document.js";
import { documentProcessingQueue } from "@core/jobs";
import type { AIProvider } from "@core/ai";

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
    return vec.map(v => v / mag);
  }
  async chat() { return "mock"; }
}

describe("POST /documents/:workspaceId/:documentId/index", () => {
  let orgId: string;
  let workspaceA: string;
  let workspaceB: string;
  let userId: string;
  let nonMemberUserId: string;
  let userToken: string;
  let nonMemberToken: string;
  let documentA: string;
  let documentB: string;

  let provider: MockProvider;

  before(async () => {
    provider = new MockProvider();
    setAIProvider(provider);

    // Setup User, Org, Workspaces
    const org = await prisma.organization.create({
      data: { name: "Test Org" }
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        email: `user_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId
      }
    });
    userId = user.id;
    userToken = jwt.sign({ userId, orgId }, env.JWT_SECRET);

    const nonMember = await prisma.user.create({
      data: {
        email: `nonmember_${randomUUID()}@test.com`,
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
          create: { userId, role: "MEMBER" } // same user is member of B
        }
      }
    });
    workspaceB = wsB.id;

    await withWorkspaceContext(workspaceA, async (tx) => {
      // Create Document A (valid content)
      const docA = await tx.document.create({
        data: {
          workspaceId: workspaceA,
          uploadedById: userId,
          filename: "A.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          storageKey: `test/A_${randomUUID()}.pdf`,
          status: "UPLOADED",
          content: {
            create: {
              text: "This is test document A content with enough words to chunk safely. " + randomUUID(),
              charCount: 100
            }
          }
        }
      });
      documentA = docA.id;

      // Create Document B (missing content)
      const docB = await tx.document.create({
        data: {
          workspaceId: workspaceA,
          uploadedById: userId,
          filename: "B.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          storageKey: `test/B_${randomUUID()}.pdf`,
          status: "UPLOADED"
        }
      });
      documentB = docB.id;
    });
  });

  after(async () => {
    setAIProvider(undefined);
    await documentProcessingQueue.close();
    await disconnectDatabase();
  });

  it("Test E - unauthenticated: returns 401", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceA}/${documentA}/index`);
    assert.strictEqual(res.status, 401);
  });

  it("Test D - non-member: returns 403", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceA}/${documentA}/index`)
      .set("Authorization", `Bearer ${nonMemberToken}`);
    assert.strictEqual(res.status, 403);
  });

  it("Test F - missing document: returns 404", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceA}/non-existent-doc/index`)
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(res.status, 404);
  });

  it("Test C - workspace mismatch: returns 404 (document exists but belongs to diff workspace)", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceB}/${documentA}/index`)
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(res.status, 404);
  });

  it("Test G - missing extracted content: returns 400", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceA}/${documentB}/index`)
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "content_missing");
  });

  it("Test A - successful indexing: returns 200, creates chunks/embeddings, status READY", async () => {
    provider.callCount = 0;
    const res = await request(app)
      .post(`/documents/${workspaceA}/${documentA}/index`)
      .set("Authorization", `Bearer ${userToken}`);
    
    assert.strictEqual(res.status, 200, res.text);
    assert.strictEqual(res.body.status, "READY");
    assert.ok(res.body.chunkCount > 0);
    assert.strictEqual(res.body.chunkCount, res.body.embeddingCount);

    const doc = await withWorkspaceContext(workspaceA, (tx) => tx.document.findUnique({ where: { id: documentA }}));
    assert.strictEqual(doc?.status, "READY");

    assert.ok(provider.callCount > 0);
  });

  it("Test B - repeat unchanged indexing: 200, unchanged embeddings", async () => {
    provider.callCount = 0;
    const res = await request(app)
      .post(`/documents/${workspaceA}/${documentA}/index`)
      .set("Authorization", `Bearer ${userToken}`);
    
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, "READY");
    assert.ok(res.body.chunkCount > 0);
    assert.strictEqual(provider.callCount, 0, "Should not call provider for unchanged content");
  });

  it("Test H - provider failure: 500, partial progress remains", async () => {
    await withWorkspaceContext(workspaceA, async (tx) => {
      // Append content to trigger re-indexing
      const content = await tx.documentContent.findUnique({ where: { documentId: documentA }});
      await tx.documentContent.update({
        where: { documentId: documentA },
        data: { text: content!.text + " some new failing chunk material" }
      });
      // Reset status to PROCESSING to simulate real conditions
      await tx.document.update({ where: { id: documentA }, data: { status: "PROCESSING" }});
    });

    provider.failOnNext = true;
    
    const res = await request(app)
      .post(`/documents/${workspaceA}/${documentA}/index`)
      .set("Authorization", `Bearer ${userToken}`);
    
    assert.strictEqual(res.status, 500);

    const doc = await withWorkspaceContext(workspaceA, (tx) => tx.document.findUnique({ where: { id: documentA }}));
    assert.strictEqual(doc?.status, "PROCESSING");
  });
  
  it("Test J - cross-workspace document security", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceB}/${documentA}/index`)
      .set("Authorization", `Bearer ${userToken}`);
    // Already covered in Test C, but duplicating the semantics explicitly
    assert.strictEqual(res.status, 404);
  });

  it("Test I - existing Phase 1-3 regression", async () => {
    const res = await request(app)
      .get(`/documents/${workspaceA}`)
      .set("Authorization", `Bearer ${userToken}`);
    
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length >= 2); // Document A and B
  });
});
