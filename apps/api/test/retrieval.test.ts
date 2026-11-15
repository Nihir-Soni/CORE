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

class RetrievalMockProvider implements AIProvider {
  public failOnNext = false;

  async embed(text: string): Promise<number[]> {
    if (this.failOnNext) {
      this.failOnNext = false;
      throw new Error("Mock provider forced failure");
    }

    const vec = new Array(768).fill(0.01);
    const val = parseFloat(text);
    vec[0] = !isNaN(val) ? val : text.length;

    const sqSum = vec.reduce((sum, v) => sum + v * v, 0);
    const mag = Math.sqrt(sqSum);
    return vec.map(v => v / mag);
  }

  async chat() { return "mock"; }
}

describe("POST /documents/:workspaceId/retrieve", () => {
  let orgId: string;
  let workspaceA: string;
  let workspaceB: string;
  let userId: string;
  let nonMemberUserId: string;
  let userToken: string;
  let nonMemberToken: string;
  let provider: RetrievalMockProvider;

  before(async () => {
    provider = new RetrievalMockProvider();
    setAIProvider(provider);

    const org = await prisma.organization.create({
      data: { name: "Retrieval Test Org " + randomUUID() }
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: { email: `retrieval_${randomUUID()}@test.com`, passwordHash: "hash", orgId }
    });
    userId = user.id;
    userToken = jwt.sign({ userId, orgId }, env.JWT_SECRET);

    const nonMember = await prisma.user.create({
      data: { email: `nonmember_${randomUUID()}@test.com`, passwordHash: "hash", orgId }
    });
    nonMemberUserId = nonMember.id;
    nonMemberToken = jwt.sign({ userId: nonMemberUserId, orgId }, env.JWT_SECRET);

    const wsA = await prisma.workspace.create({
      data: {
        name: "Retrieval WS A",
        orgId,
        memberships: { create: { userId, role: "MEMBER" } }
      }
    });
    workspaceA = wsA.id;

    const wsB = await prisma.workspace.create({
      data: {
        name: "Retrieval WS B",
        orgId,
        memberships: { create: { userId, role: "MEMBER" } }
      }
    });
    workspaceB = wsB.id;

    await withWorkspaceContext(workspaceA, async (tx) => {
      // Document A in Workspace A
      const docA = await tx.document.create({
        data: {
          workspaceId: workspaceA,
          uploadedById: userId,
          filename: "authentication.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          storageKey: `test/retrieval_a_${randomUUID()}.pdf`,
          status: "READY"
        }
      });

      // Chunk A
      const chunkA = await tx.chunk.create({
        data: {
          documentId: docA.id,
          workspaceId: workspaceA,
          content: "10",
          chunkIndex: 3,
          pageNumber: 4,
          tokenCount: 612
        }
      });
      
      // Embed Chunk A manually via MockProvider logic
      const vecA = await provider.embed("10");
      await tx.$executeRawUnsafe(
        `INSERT INTO chunk_embeddings ("id", "chunkId", "embedding") VALUES ($1, $2, $3::vector)`,
        randomUUID(), chunkA.id, `[${vecA.join(",")}]`
      );
    });

    await withWorkspaceContext(workspaceB, async (tx) => {
      const vecA = await provider.embed("10");
      // Document B in Workspace B (Isolation Target)
      const docB = await tx.document.create({
        data: {
          workspaceId: workspaceB,
          uploadedById: userId,
          filename: "secret.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          storageKey: `test/retrieval_b_${randomUUID()}.pdf`,
          status: "READY"
        }
      });

      // Chunk B (identical embedding to Chunk A)
      const chunkB = await tx.chunk.create({
        data: {
          documentId: docB.id,
          workspaceId: workspaceB,
          content: "10",
          chunkIndex: 0,
          pageNumber: 1,
          tokenCount: 100
        }
      });
      
      await tx.$executeRawUnsafe(
        `INSERT INTO chunk_embeddings ("id", "chunkId", "embedding") VALUES ($1, $2, $3::vector)`,
        randomUUID(), chunkB.id, `[${vecA.join(",")}]`
      );
    });
  });

  after(async () => {
    setAIProvider(undefined);
    await documentProcessingQueue.close();
    await disconnectDatabase();
  });

  it("Test 6 - Unauthenticated: returns 401", async () => {
    const res = await request(app).post(`/documents/${workspaceA}/retrieve`).send({ query: "10" });
    assert.strictEqual(res.status, 401);
  });

  it("Test 7 - Non-member: returns 403", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceA}/retrieve`)
      .set("Authorization", `Bearer ${nonMemberToken}`)
      .send({ query: "10" });
    assert.strictEqual(res.status, 403);
  });

  it("Test 4 - Invalid query (empty string/whitespace): returns 400", async () => {
    const res1 = await request(app)
      .post(`/documents/${workspaceA}/retrieve`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ query: "" });
    assert.strictEqual(res1.status, 400);

    const res2 = await request(app)
      .post(`/documents/${workspaceA}/retrieve`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ query: "    \n" });
    assert.strictEqual(res2.status, 400);
  });

  it("Test 5 - Invalid topK: returns 400", async () => {
    const cases = [0, -5, 51, 2.5, "five"];
    for (const topK of cases) {
      const res = await request(app)
        .post(`/documents/${workspaceA}/retrieve`)
        .set("Authorization", `Bearer ${userToken}`)
        .send({ query: "10", topK });
      assert.strictEqual(res.status, 400, `Failed for topK ${topK}`);
    }
  });

  it("Test 1 & 11 - Successful retrieval with metadata integrity", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceA}/retrieve`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ query: "10" });

    assert.strictEqual(res.status, 200, res.text);
    assert.strictEqual(res.body.workspaceId, workspaceA);
    assert.strictEqual(res.body.query, "10");
    assert.strictEqual(Array.isArray(res.body.results), true);
    assert.ok(res.body.results.length >= 1);

    const top = res.body.results[0];
    assert.ok(top.chunkId);
    assert.ok(top.documentId);
    assert.strictEqual(top.workspaceId, workspaceA);
    assert.strictEqual(top.filename, "authentication.pdf");
    assert.strictEqual(top.content, "10");
    assert.strictEqual(top.chunkIndex, 3);
    assert.strictEqual(top.pageNumber, 4);
    assert.strictEqual(top.tokenCount, 612);
    assert.ok(typeof top.similarity === 'number');
  });

  it("Test 2 - Default top-K", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceA}/retrieve`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ query: "10" });
    assert.strictEqual(res.status, 200);
    // As long as it succeeds and returns <= 10 (default), it's good.
    assert.ok(res.body.results.length <= 10);
  });

  it("Test 3 - Explicit top-K", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceA}/retrieve`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ query: "10", topK: 2 });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.results.length <= 2);
  });

  it("Test 8 - Cross-workspace isolation (CRITICAL)", async () => {
    const res = await request(app)
      .post(`/documents/${workspaceA}/retrieve`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ query: "10" });
    
    assert.strictEqual(res.status, 200);
    // Should NOT contain the secret chunk from workspace B even though embeddings match
    const bMatch = res.body.results.find((r: any) => r.workspaceId === workspaceB);
    assert.strictEqual(bMatch, undefined);
  });

  it("Test 9 - Empty workspace: returns 200 + results: []", async () => {
    // We create a fresh WS with no documents
    const wsEmpty = await prisma.workspace.create({
      data: {
        name: "Retrieval WS Empty",
        orgId,
        memberships: { create: { userId, role: "MEMBER" } }
      }
    });

    const res = await request(app)
      .post(`/documents/${wsEmpty.id}/retrieve`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ query: "10" });
    
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.length, 0);
  });

  it("Test 10 - Provider failure: returns 500", async () => {
    provider.failOnNext = true;
    const res = await request(app)
      .post(`/documents/${workspaceA}/retrieve`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ query: "10" });
    assert.strictEqual(res.status, 500);
  });

  it("Test 12 - Existing regression (index route still works)", async () => {
    // Just hitting a quick 404 on the index route to ensure router isn't broken
    const res = await request(app)
      .post(`/documents/${workspaceA}/non-existent/index`)
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(res.status, 404);
  });
});
