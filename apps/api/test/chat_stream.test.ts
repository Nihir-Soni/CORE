import { describe, before, after, it } from "node:test";
import assert from "node:assert";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

import { prisma, withWorkspaceContext, disconnectDatabase } from "@core/database";
import { env, type WorkspaceRole } from "@core/shared";
import { app } from "../src/index.js";
import { setAIProvider } from "../src/routes/document.js";
import { documentProcessingQueue } from "@core/jobs";
import type { AIProvider, ChatInput } from "@core/ai";

class StreamingMockProvider implements AIProvider {
  async embed(text: string): Promise<number[]> {
    const vec = new Array(768).fill(0.01);
    vec[0] = text.length / 1000.0;
    return vec;
  }

  async chat(input: ChatInput): Promise<string> {
    if (input.userPrompt.includes("fail")) {
      throw new Error("Provider forced failure");
    }
    return "The contract specifies terms for delivery. [source:1]";
  }

  async *chatStream(input: ChatInput): AsyncIterable<string> {
    if (input.userPrompt.includes("fail_stream")) {
      throw new Error("Provider forced streaming failure");
    }
    yield "The contract ";
    yield "specifies terms ";
    yield "for delivery. [source:1]";
  }
}

describe("Phase 8.4 — SSE Streaming for Chat Responses", () => {
  let orgId: string;
  let workspaceA: string;
  let workspaceB: string;
  let memberUserId: string;
  let memberToken: string;
  let nonMemberUserId: string;
  let nonMemberToken: string;
  let docId: string;
  let provider: StreamingMockProvider;

  before(async () => {
    provider = new StreamingMockProvider();
    setAIProvider(provider);

    const org = await prisma.organization.create({
      data: { name: `Chat Stream Org ${randomUUID()}` },
    });
    orgId = org.id;

    const member = await prisma.user.create({
      data: {
        email: `chatstream_mem_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId,
      },
    });
    memberUserId = member.id;
    memberToken = jwt.sign({ userId: memberUserId, orgId }, env.JWT_SECRET);

    const nonMember = await prisma.user.create({
      data: {
        email: `chatstream_nonmem_${randomUUID()}@test.com`,
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
        name: "Chat Stream Workspace A",
        orgId,
        memberships: {
          create: { userId: memberUserId, role: "MEMBER" },
        },
      },
    });
    workspaceA = wsA.id;

    const wsB = await prisma.workspace.create({
      data: {
        name: "Chat Stream Workspace B",
        orgId,
        memberships: {
          create: { userId: memberUserId, role: "MEMBER" },
        },
      },
    });
    workspaceB = wsB.id;

    // Seed document & chunk with embedding in Workspace A
    await withWorkspaceContext(workspaceA, async (tx) => {
      const doc = await tx.document.create({
        data: {
          workspaceId: workspaceA,
          uploadedById: memberUserId,
          filename: "contract_terms.pdf",
          mimeType: "application/pdf",
          sizeBytes: 500,
          storageKey: `test/contract_${randomUUID()}.pdf`,
          status: "READY",
        },
      });
      docId = doc.id;

      const vec = await provider.embed("contract terms delivery");

      const chunk = await tx.chunk.create({
        data: {
          documentId: doc.id,
          workspaceId: workspaceA,
          content: "The contract specifies terms for delivery within 30 days.",
          chunkIndex: 0,
          pageNumber: 1,
          tokenCount: 10,
        },
      });

      await tx.$executeRawUnsafe(
        `INSERT INTO chunk_embeddings ("id", "chunkId", "embedding") VALUES ($1, $2, $3::vector)`,
        randomUUID(),
        chunk.id,
        `[${vec.join(",")}]`,
      );
    });
  });

  after(async () => {
    setAIProvider(undefined);
    await documentProcessingQueue.close();
    await disconnectDatabase();
  });

  describe("Security & Workspace Isolation", () => {
    it("8.4.1 - unauthenticated request returns 401", async () => {
      const res = await request(app)
        .post(`/documents/${workspaceA}/chat`)
        .send({ query: "contract delivery terms", stream: true });

      assert.strictEqual(res.status, 401);
    });

    it("8.4.2 - non-member request returns 403", async () => {
      const res = await request(app)
        .post(`/documents/${workspaceA}/chat`)
        .set("Authorization", `Bearer ${nonMemberToken}`)
        .send({ query: "contract delivery terms", stream: true });

      assert.strictEqual(res.status, 403);
    });
  });

  describe("SSE Streaming & Framing", () => {
    it("8.4.3 - streaming request (stream=true) returns 200, Content-Type text/event-stream, and valid SSE framing", async () => {
      const res = await request(app)
        .post(`/documents/${workspaceA}/chat`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ query: "contract delivery terms", stream: true });

      assert.strictEqual(res.status, 200);
      assert.ok(res.headers["content-type"].includes("text/event-stream"));

      const body = res.text;

      // Verify SSE framing correctness (\n\n double line break framing)
      assert.ok(body.includes("event: token\n"));
      assert.ok(body.includes("event: citations\n"));
      assert.ok(body.includes("event: complete\n"));

      // Verify event blocks end with double newline delimiter \n\n
      const blocks = body.split("\n\n");
      assert.ok(blocks.length >= 4, "contains multiple double-newline delimited SSE event frames");

      // Verify token progression & text chunks
      assert.ok(body.includes("The contract"));
      assert.ok(body.includes("specifies terms"));
      assert.ok(body.includes("for delivery. [source:1]"));

      // Verify mapped citations
      assert.ok(body.includes('"citations":['), "emits citations event payload");
      assert.ok(body.includes("contract_terms.pdf"), "contains mapped source filename in citations");
    });

    it("8.4.4 - empty retrieval context streams 'not enough information' fallback", async () => {
      const res = await request(app)
        .post(`/documents/${workspaceB}/chat`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ query: "unmatched obscure query string", stream: true });

      assert.strictEqual(res.status, 200);
      const body = res.text;

      assert.ok(body.includes("event: token"));
      assert.ok(body.includes("I couldn't find enough information"));
      assert.ok(body.includes('event: citations\ndata: {"citations":[]}'));
      assert.ok(body.includes("event: complete"));
    });

    it("8.4.5 - provider streaming failure emits event: error and closes cleanly", async () => {
      const res = await request(app)
        .post(`/documents/${workspaceA}/chat`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ query: "fail_stream contract delivery", stream: true });

      assert.strictEqual(res.status, 200);
      const body = res.text;

      assert.ok(body.includes("event: error"));
      assert.ok(body.includes('event: error\ndata: {"message":"Unable to generate a response"}\n\n'));
      assert.ok(!body.includes("Provider forced streaming failure"));
    });

    it("8.4.6 - backward compatibility: stream=false or absent returns Phase 5 JSON response", async () => {
      const res = await request(app)
        .post(`/documents/${workspaceA}/chat`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ query: "contract delivery terms" }); // no stream field

      assert.strictEqual(res.status, 200);
      assert.ok(res.headers["content-type"].includes("application/json"));
      assert.strictEqual(res.body.workspaceId, workspaceA);
      assert.ok(typeof res.body.answer === "string");
      assert.ok(Array.isArray(res.body.citations));
    });

    it("8.4.7 - client disconnect during streaming aborts generator and stops SSE writes", async () => {
      let chunksYielded = 0;

      class DisconnectMockProvider implements AIProvider {
        async embed(text: string): Promise<number[]> {
          return new Array(768).fill(0.01);
        }
        async chat(): Promise<string> {
          return "mock";
        }
        async *chatStream(): AsyncIterable<string> {
          chunksYielded++;
          yield "Chunk 1 ";
          await new Promise((r) => setTimeout(r, 200));
          chunksYielded++;
          yield "Chunk 2 ";
          await new Promise((r) => setTimeout(r, 200));
          chunksYielded++;
          yield "Chunk 3 ";
        }
      }

      setAIProvider(new DisconnectMockProvider());

      const reqStream = request(app)
        .post(`/documents/${workspaceA}/chat`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ query: "contract delivery terms", stream: true });

      // Abort HTTP request after 100ms (after first chunk received)
      setTimeout(() => {
        reqStream.abort();
      }, 100);

      try {
        await reqStream;
      } catch {
        // Expected client abort error
      }

      await new Promise((r) => setTimeout(r, 500));

      // Generator iteration should have terminated after chunk 1 or 2, without writing chunk 3
      assert.ok(chunksYielded < 3, `Generator aborted cleanly, yielded ${chunksYielded} chunks instead of 3`);
      setAIProvider(provider);
    });
  });
});
