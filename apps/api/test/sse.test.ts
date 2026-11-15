import { describe, before, after, it } from "node:test";
import assert from "node:assert";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { prisma, disconnectDatabase } from "@core/database";
import { env } from "@core/shared";
import { app } from "../src/index.js";
import { SSESession } from "../src/lib/sse.js";
import { documentProcessingQueue } from "@core/jobs";

describe("Phase 8.1 — SSE Foundation & Connection Lifecycle", () => {
  let orgId: string;
  let workspaceId: string;
  let memberUserId: string;
  let memberToken: string;
  let nonMemberUserId: string;
  let nonMemberToken: string;

  before(async () => {
    const org = await prisma.organization.create({
      data: { name: `SSE Test Org ${randomUUID()}` },
    });
    orgId = org.id;

    const member = await prisma.user.create({
      data: {
        email: `sse_member_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId,
      },
    });
    memberUserId = member.id;
    memberToken = jwt.sign({ userId: memberUserId, orgId }, env.JWT_SECRET);

    const nonMember = await prisma.user.create({
      data: {
        email: `sse_nonmember_${randomUUID()}@test.com`,
        passwordHash: "hash",
        orgId,
      },
    });
    nonMemberUserId = nonMember.id;
    nonMemberToken = jwt.sign(
      { userId: nonMemberUserId, orgId },
      env.JWT_SECRET,
    );

    const ws = await prisma.workspace.create({
      data: {
        name: "SSE Workspace",
        orgId,
        memberships: {
          create: { userId: memberUserId, role: "MEMBER" },
        },
      },
    });
    workspaceId = ws.id;
  });

  after(async () => {
    await documentProcessingQueue.close();
    await disconnectDatabase();
  });

  describe("Authentication & Workspace Isolation", () => {
    it("11.1 - unauthenticated request returns 401", async () => {
      const res = await request(app).get(`/events/${workspaceId}/test`);
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, "missing_token");
    });

    it("11.2 - invalid Bearer token returns 401", async () => {
      const res = await request(app)
        .get(`/events/${workspaceId}/test`)
        .set("Authorization", "Bearer invalid-token-string");
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, "invalid_token");
    });

    it("11.3 - invalid query token returns 401", async () => {
      const res = await request(app).get(
        `/events/${workspaceId}/test?token=invalid-query-token`,
      );
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, "invalid_token");
    });

    it("11.4 - authenticated non-member returns 403", async () => {
      const res = await request(app)
        .get(`/events/${workspaceId}/test`)
        .set("Authorization", `Bearer ${nonMemberToken}`);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, "forbidden");
    });

    it("11.5 - wrong / unknown workspace ID returns 404", async () => {
      const unknownWorkspaceId = randomUUID();
      const res = await request(app)
        .get(`/events/${unknownWorkspaceId}/test`)
        .set("Authorization", `Bearer ${memberToken}`);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, "workspace_not_found");
    });
  });

  describe("SSE Headers & Transport", () => {
    it("11.6 - authenticated member receives 200 and required SSE headers", async () => {
      const res = await request(app)
        .get(`/events/${workspaceId}/test`)
        .set("Authorization", `Bearer ${memberToken}`);

      assert.strictEqual(res.status, 200);
      assert.ok(
        res.headers["content-type"]?.includes("text/event-stream"),
        `content-type header should be text/event-stream, got: ${res.headers["content-type"]}`,
      );
      assert.strictEqual(
        res.headers["cache-control"],
        "no-cache, no-transform",
      );
      assert.strictEqual(res.headers["connection"], "keep-alive");
      assert.strictEqual(res.headers["x-accel-buffering"], "no");
    });

    it("11.7 - authenticated member via query token receives 200 and SSE headers", async () => {
      const res = await request(app).get(
        `/events/${workspaceId}/test?token=${memberToken}`,
      );

      assert.strictEqual(res.status, 200);
      assert.ok(
        res.headers["content-type"]?.includes("text/event-stream"),
      );
    });

    it("11.8 - receives deterministic event sequence in exact order and closes cleanly", async () => {
      const res = await request(app)
        .get(`/events/${workspaceId}/test`)
        .set("Authorization", `Bearer ${memberToken}`);

      assert.strictEqual(res.status, 200);
      const text = res.text;

      // Verify presence and order of events
      const connectedIndex = text.indexOf("event: connected\ndata: {\"connected\":true}\n\n");
      const test1Index = text.indexOf("event: test\ndata: {\"sequence\":1}\n\n");
      const test2Index = text.indexOf("event: test\ndata: {\"sequence\":2}\n\n");
      const test3Index = text.indexOf("event: test\ndata: {\"sequence\":3}\n\n");
      const completeIndex = text.indexOf("event: complete\ndata: {\"complete\":true}\n\n");

      assert.ok(connectedIndex >= 0, "connected event found");
      assert.ok(test1Index > connectedIndex, "test 1 event follows connected");
      assert.ok(test2Index > test1Index, "test 2 event follows test 1");
      assert.ok(test3Index > test2Index, "test 3 event follows test 2");
      assert.ok(completeIndex > test3Index, "complete event follows test 3");
    });
  });

  describe("SSESession Unit & Lifecycle Tests", () => {
    it("11.9 - heartbeats write SSE comment with configurable interval", async () => {
      let writtenData = "";
      const fakeReq = new EventEmitter() as any;
      const fakeRes = new EventEmitter() as any;
      fakeRes.setHeader = () => {};
      fakeRes.write = (chunk: string) => {
        writtenData += chunk;
        return true;
      };
      fakeRes.end = () => {
        fakeRes.writableEnded = true;
      };
      fakeRes.writableEnded = false;

      const session = new SSESession(fakeReq, fakeRes, {
        heartbeatIntervalMs: 20,
      });

      await new Promise((r) => setTimeout(r, 80));

      session.close();

      assert.ok(
        writtenData.includes(": heartbeat\n\n"),
        "heartbeat comment written",
      );
      const matches = writtenData.match(/: heartbeat\n\n/g);
      assert.ok(matches && matches.length >= 2, "multiple heartbeats emitted");
    });

    it("11.10 - client disconnect clears heartbeat timer and invokes onClose cleanup without leaks", async () => {
      let closedCalled = false;
      let writtenData = "";

      const fakeReq = new EventEmitter() as any;
      const fakeRes = new EventEmitter() as any;
      fakeRes.setHeader = () => {};
      fakeRes.write = (chunk: string) => {
        writtenData += chunk;
        return true;
      };
      fakeRes.end = () => {
        fakeRes.writableEnded = true;
      };
      fakeRes.writableEnded = false;

      const session = new SSESession(fakeReq, fakeRes, {
        heartbeatIntervalMs: 20,
        onClose: () => {
          closedCalled = true;
        },
      });

      assert.strictEqual(session.isClosed(), false);

      // Simulate client abort event
      fakeReq.emit("close");

      assert.strictEqual(session.isClosed(), true);
      assert.strictEqual(closedCalled, true);

      // Verify no further heartbeats are sent after closing
      const snapshotLen = writtenData.length;
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(writtenData.length, snapshotLen, "no write after close");
    });

    it("11.11 - SSESession close is idempotent and onClose is invoked at most once", async () => {
      let closeCount = 0;
      const fakeReq = new EventEmitter() as any;
      const fakeRes = new EventEmitter() as any;
      fakeRes.setHeader = () => {};
      fakeRes.write = () => true;
      fakeRes.end = () => { fakeRes.writableEnded = true; };
      fakeRes.writableEnded = false;

      const session = new SSESession(fakeReq, fakeRes, {
        onClose: () => { closeCount++; }
      });

      session.close();
      session.close();
      session.close();

      assert.strictEqual(session.isClosed(), true);
      assert.strictEqual(closeCount, 1, "onClose invoked exactly once");
    });

    it("11.12 - send returns false and bypasses write when closed or response destroyed", async () => {
      let writeCalled = false;
      const fakeReq = new EventEmitter() as any;
      const fakeRes = new EventEmitter() as any;
      fakeRes.setHeader = () => {};
      fakeRes.write = () => { writeCalled = true; return true; };
      fakeRes.end = () => { fakeRes.writableEnded = true; };
      fakeRes.writableEnded = false;

      const session = new SSESession(fakeReq, fakeRes);
      session.close();

      const success = session.send({ event: "test", data: { hello: "world" } });
      assert.strictEqual(success, false);
      assert.strictEqual(writeCalled, false, "no res.write after close");
    });
  });
});
