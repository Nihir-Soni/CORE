import { describe, before, after, it, mock } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../src/index.js";
import { prisma, withWorkspaceContext, disconnectDatabase } from "@core/database";
import jwt from "jsonwebtoken";
import { env } from "@core/shared";
import { randomUUID } from "node:crypto";
import { documentProcessingQueue } from "@core/jobs";
import { setMultipartStorageOps, resetMultipartStorageOps } from "../src/routes/multipart.js";

// ── Per-test controllable state ──────────────────────────────────────────────
let _initUploadId = "mock-upload-id";
let _listPartsResult: Array<{ PartNumber: number; ETag: string }> = [];
let _completeError: Error | null = null;

function mockStorageOps() {
    setMultipartStorageOps({
        initiateMultipartUpload: async (_key: string, _ct: string) => ({ uploadId: _initUploadId }),
        presignUploadPart: async (_key: string, _uid: string, partNumber: number) =>
            `https://minio.local/presigned-url/part-${partNumber}`,
        listMultipartParts: async (_key: string, _uid: string) => _listPartsResult,
        completeMultipartUpload: async (_key: string, _uid: string, _parts: any[]) => {
            if (_completeError) throw _completeError;
        },
        abortMultipartUpload: async (_key: string, _uid: string) => {},
        computeObjectSha256: async (key: string) => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
        deleteObject: async (_key: string) => {},
    });
}

describe("Multipart Upload API", () => {
    let orgId: string;
    let workspaceAId: string;
    let workspaceBId: string;
    let userAToken: string;
    let userBToken: string;
    let queueMock: any;

    before(async () => {
        mockStorageOps();
        queueMock = mock.method(documentProcessingQueue, "add", async () => ({ id: "mock-queue-job" }));

        const org = await prisma.organization.create({ data: { name: `MP Org ${randomUUID()}` } });
        orgId = org.id;

        const userA = await prisma.user.create({
            data: { email: `a_${randomUUID()}@mp.test`, passwordHash: "hash", orgId }
        });
        userAToken = jwt.sign({ userId: userA.id, orgId }, env.JWT_SECRET);

        const userB = await prisma.user.create({
            data: { email: `b_${randomUUID()}@mp.test`, passwordHash: "hash", orgId }
        });
        userBToken = jwt.sign({ userId: userB.id, orgId }, env.JWT_SECRET);

        const wa = await prisma.workspace.create({
            data: {
                name: "WA", orgId,
                memberships: { create: { userId: userA.id, role: "MEMBER" } }
            }
        });
        workspaceAId = wa.id;

        const wb = await prisma.workspace.create({
            data: {
                name: "WB", orgId,
                memberships: { create: { userId: userB.id, role: "MEMBER" } }
            }
        });
        workspaceBId = wb.id;
    });

    after(async () => {
        resetMultipartStorageOps();
        mock.restoreAll();
        await documentProcessingQueue.close();
        await disconnectDatabase();
    });

    // Helper: initiate a fresh session
    async function initiate(sizeBytes = 80 * 1024 * 1024) {
        _initUploadId = `uid-${randomUUID()}`;
        const res = await request(app)
            .post(`/documents/${workspaceAId}/multipart/initiate`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({ filename: "file.pdf", mimeType: "application/pdf", sizeBytes })
            .expect(201);
        return res.body as {
            sessionId: string;
            documentId: string;
            uploadId: string;
            partSizeBytes: number;
            totalParts: number;
        };
    }

    // ── Test A — initiate ────────────────────────────────────────────────────
    it("Test A — initiate creates session and returns correct fields", async () => {
        const res = await initiate();
        assert.ok(res.sessionId, "sessionId missing");
        assert.ok(res.documentId, "documentId missing");
        assert.ok(res.uploadId, "uploadId missing");
        assert.ok(typeof res.partSizeBytes === "number" && res.partSizeBytes > 0);
        assert.ok(res.totalParts > 0);

        const doc = await withWorkspaceContext(workspaceAId, async (tx) => tx.document.findUnique({ where: { id: res.documentId } }));
        assert.equal(doc?.status, "UPLOADING");

        const sess = await withWorkspaceContext(workspaceAId, async (tx) => tx.uploadSession.findUnique({ where: { id: res.sessionId } }));
        assert.equal(sess?.status, "INITIATED");
        assert.equal(sess?.uploadId, res.uploadId);
    });

    it("Test A security — no auth → 401", async () => {
        await request(app)
            .post(`/documents/${workspaceAId}/multipart/initiate`)
            .send({ filename: "f.pdf", mimeType: "application/pdf", sizeBytes: 10 * 1024 * 1024 })
            .expect(401);
    });

    it("Test A security — non-member → 403", async () => {
        await request(app)
            .post(`/documents/${workspaceAId}/multipart/initiate`)
            .set("Authorization", `Bearer ${userBToken}`)
            .send({ filename: "f.pdf", mimeType: "application/pdf", sizeBytes: 10 * 1024 * 1024 })
            .expect(403);
    });

    it("Initiate validation — file_too_large > 2GB → 400", async () => {
        await request(app)
            .post(`/documents/${workspaceAId}/multipart/initiate`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({ filename: "huge.pdf", mimeType: "application/pdf", sizeBytes: 3 * 1024 * 1024 * 1024 })
            .expect(400);
    });

    it("Initiate validation — unsupported MIME → 400", async () => {
        await request(app)
            .post(`/documents/${workspaceAId}/multipart/initiate`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({ filename: "v.mp4", mimeType: "video/mp4", sizeBytes: 50 * 1024 * 1024 })
            .expect(400);
    });

    // ── Test B — part URL ────────────────────────────────────────────────────
    it("Test B — part-url returns presigned URL", async () => {
        const sess = await initiate();
        const res = await request(app)
            .post(`/documents/${workspaceAId}/multipart/${sess.sessionId}/part-url`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({ partNumber: 1 })
            .expect(200);

        assert.ok(res.body.uploadUrl, "uploadUrl missing");
        assert.equal(res.body.partNumber, 1);
        assert.ok(res.body.uploadUrl.includes("presigned-url"));
    });

    // ── Test C — invalid part number: 0 ─────────────────────────────────────
    it("Test C — partNumber=0 → 400", async () => {
        const sess = await initiate();
        await request(app)
            .post(`/documents/${workspaceAId}/multipart/${sess.sessionId}/part-url`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({ partNumber: 0 })
            .expect(400);
    });

    // ── Test D — partNumber > totalParts ─────────────────────────────────────
    it("Test D — partNumber > totalParts → 400", async () => {
        const sess = await initiate();
        await request(app)
            .post(`/documents/${workspaceAId}/multipart/${sess.sessionId}/part-url`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({ partNumber: sess.totalParts + 1 })
            .expect(400);
    });

    // ── Test J security on part-url ───────────────────────────────────────────
    it("Test J — wrong workspace on part-url → 404", async () => {
        const sess = await initiate();
        await request(app)
            .post(`/documents/${workspaceBId}/multipart/${sess.sessionId}/part-url`)
            .set("Authorization", `Bearer ${userBToken}`)
            .send({ partNumber: 1 })
            .expect(404);
    });

    // ── Test E — resume/status ───────────────────────────────────────────────
    it("Test E — GET session returns ListParts from MinIO", async () => {
        const sess = await initiate();
        _listPartsResult = [
            { PartNumber: 1, ETag: '"etag-1"' },
            { PartNumber: 2, ETag: '"etag-2"' },
        ];

        const res = await request(app)
            .get(`/documents/${workspaceAId}/multipart/${sess.sessionId}`)
            .set("Authorization", `Bearer ${userAToken}`)
            .expect(200);

        assert.equal(res.body.sessionId, sess.sessionId);
        assert.equal(res.body.status, "INITIATED");
        assert.equal(res.body.uploadedParts.length, 2);
        assert.equal(res.body.uploadedParts[0].partNumber, 1);
        assert.equal(res.body.uploadedParts[0].etag, "etag-1"); // quotes stripped
        assert.equal(res.body.uploadedParts[1].partNumber, 2);
    });

    // ── Test F — incomplete completion ───────────────────────────────────────
    it("Test F — completing with fewer parts than totalParts → 400", async () => {
        // 16MB → 2 parts
        const sess = await initiate(16 * 1024 * 1024);
        _listPartsResult = [{ PartNumber: 1, ETag: '"etag-1"' }];

        await request(app)
            .post(`/documents/${workspaceAId}/multipart/${sess.sessionId}/complete`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({ parts: [{ partNumber: 1, etag: "etag-1" }] })
            .expect(400);
    });

    // ── Test G — successful completion ───────────────────────────────────────
    it("Test G — complete all parts → UPLOADED + ProcessingJob queued", async () => {
        const sess = await initiate(16 * 1024 * 1024); // 2 parts
        _listPartsResult = [
            { PartNumber: 1, ETag: '"etag-a1"' },
            { PartNumber: 2, ETag: '"etag-a2"' },
        ];
        _completeError = null;
        queueMock.mock.resetCalls();

        const res = await request(app)
            .post(`/documents/${workspaceAId}/multipart/${sess.sessionId}/complete`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({
                parts: [
                    { partNumber: 1, etag: "etag-a1" },
                    { partNumber: 2, etag: "etag-a2" },
                ]
            })
            .expect(200);

        assert.equal(res.body.status, "COMPLETED");
        assert.equal(res.body.documentId, sess.documentId);

        const doc = await withWorkspaceContext(workspaceAId, async (tx) => tx.document.findUnique({ where: { id: sess.documentId } }));
        assert.equal(doc?.status, "UPLOADED");

        const jobs = await withWorkspaceContext(workspaceAId, async (tx) => tx.processingJob.findMany({ where: { documentId: sess.documentId } }));
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].status, "QUEUED");
        assert.equal(queueMock.mock.callCount(), 1);
    });

    // ── Test H — duplicate completion is idempotent ───────────────────────────
    it("Test H — duplicate complete is safe and creates only one job", async () => {
        const sess = await initiate(16 * 1024 * 1024);
        _listPartsResult = [
            { PartNumber: 1, ETag: '"etag-b1"' },
            { PartNumber: 2, ETag: '"etag-b2"' },
        ];
        _completeError = null;
        queueMock.mock.resetCalls();

        const completeParts = [
            { partNumber: 1, etag: "etag-b1" },
            { partNumber: 2, etag: "etag-b2" },
        ];

        // First completion
        await request(app)
            .post(`/documents/${workspaceAId}/multipart/${sess.sessionId}/complete`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({ parts: completeParts })
            .expect(200);

        // Second completion (session is now COMPLETED — idempotent)
        const res2 = await request(app)
            .post(`/documents/${workspaceAId}/multipart/${sess.sessionId}/complete`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({ parts: completeParts })
            .expect(200);

        assert.equal(res2.body.status, "COMPLETED");

        const jobs = await withWorkspaceContext(workspaceAId, async (tx) => tx.processingJob.findMany({ where: { documentId: sess.documentId } }));
        assert.equal(jobs.length, 1, "Only one job should exist");
        assert.equal(queueMock.mock.callCount(), 1, "Queue.add called only once");
    });

    // ── ETag mismatch rejection ───────────────────────────────────────────────
    it("ETag mismatch → 400", async () => {
        const sess = await initiate(16 * 1024 * 1024);
        _listPartsResult = [
            { PartNumber: 1, ETag: '"etag-real"' },
            { PartNumber: 2, ETag: '"etag-real2"' },
        ];

        await request(app)
            .post(`/documents/${workspaceAId}/multipart/${sess.sessionId}/complete`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({
                parts: [
                    { partNumber: 1, etag: "etag-wrong" },
                    { partNumber: 2, etag: "etag-real2" },
                ]
            })
            .expect(400);
    });

    // ── Duplicate partNumbers in completion body ───────────────────────────────
    it("Duplicate partNumbers in completion body → 400", async () => {
        const sess = await initiate(16 * 1024 * 1024);
        _listPartsResult = [
            { PartNumber: 1, ETag: '"etag-c1"' },
            { PartNumber: 2, ETag: '"etag-c2"' },
        ];

        await request(app)
            .post(`/documents/${workspaceAId}/multipart/${sess.sessionId}/complete`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({
                parts: [
                    { partNumber: 1, etag: "etag-c1" },
                    { partNumber: 1, etag: "etag-c1" }, // duplicate
                ]
            })
            .expect(400);
    });

    // ── Test I — abort ───────────────────────────────────────────────────────
    it("Test I — abort sets ABORTED + Document FAILED, no job created", async () => {
        const sess = await initiate();
        queueMock.mock.resetCalls();

        const res = await request(app)
            .post(`/documents/${workspaceAId}/multipart/${sess.sessionId}/abort`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send()
            .expect(200);

        assert.equal(res.body.status, "ABORTED");

        const doc = await withWorkspaceContext(workspaceAId, async (tx) => tx.document.findUnique({ where: { id: sess.documentId } }));
        assert.equal(doc?.status, "FAILED");

        const session = await withWorkspaceContext(workspaceAId, async (tx) => tx.uploadSession.findUnique({ where: { id: sess.sessionId } }));
        assert.equal(session?.status, "ABORTED");

        const jobs = await withWorkspaceContext(workspaceAId, async (tx) => tx.processingJob.findMany({ where: { documentId: sess.documentId } }));
        assert.equal(jobs.length, 0);
        assert.equal(queueMock.mock.callCount(), 0);
    });

    it("Abort after complete → 400", async () => {
        const sess = await initiate(16 * 1024 * 1024);
        _listPartsResult = [
            { PartNumber: 1, ETag: '"etag-d1"' },
            { PartNumber: 2, ETag: '"etag-d2"' },
        ];
        _completeError = null;

        await request(app)
            .post(`/documents/${workspaceAId}/multipart/${sess.sessionId}/complete`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({ parts: [{ partNumber: 1, etag: "etag-d1" }, { partNumber: 2, etag: "etag-d2" }] })
            .expect(200);

        await request(app)
            .post(`/documents/${workspaceAId}/multipart/${sess.sessionId}/abort`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send()
            .expect(400);
    });

    // ── Test J — cross-workspace isolation ────────────────────────────────────
    it("Test J — workspace B cannot access workspace A session status", async () => {
        const sess = await initiate();
        await request(app)
            .get(`/documents/${workspaceBId}/multipart/${sess.sessionId}`)
            .set("Authorization", `Bearer ${userBToken}`)
            .expect(404);
    });

    it("Test J — workspace B cannot abort workspace A session", async () => {
        const sess = await initiate();
        await request(app)
            .post(`/documents/${workspaceBId}/multipart/${sess.sessionId}/abort`)
            .set("Authorization", `Bearer ${userBToken}`)
            .send()
            .expect(404);
    });

    it("Test J — workspace B cannot complete workspace A session", async () => {
        const sess = await initiate(16 * 1024 * 1024);
        await request(app)
            .post(`/documents/${workspaceBId}/multipart/${sess.sessionId}/complete`)
            .set("Authorization", `Bearer ${userBToken}`)
            .send({ parts: [{ partNumber: 1, etag: "x" }, { partNumber: 2, etag: "y" }] })
            .expect(404);
    });

    // ── Phase 7.4 Deduplication Tests ───────────────────────────────────────
    it("Phase 7.4 — Multipart complete deduplication in same workspace returns canonical documentId", async () => {
        const fixedHash = "a3f5" + "0".repeat(60);
        let deletedKeys: string[] = [];

        setMultipartStorageOps({
            computeObjectSha256: async () => fixedHash,
            deleteObject: async (key: string) => { deletedKeys.push(key); }
        });

        // First session initiation & completion
        const sess1 = await initiate(16 * 1024 * 1024);
        _listPartsResult = [
            { PartNumber: 1, ETag: '"etag-1"' },
            { PartNumber: 2, ETag: '"etag-2"' },
        ];
        _completeError = null;
        queueMock.mock.resetCalls();

        const res1 = await request(app)
            .post(`/documents/${workspaceAId}/multipart/${sess1.sessionId}/complete`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({ parts: [{ partNumber: 1, etag: "etag-1" }, { partNumber: 2, etag: "etag-2" }] })
            .expect(200);

        assert.equal(res1.body.status, "COMPLETED");
        assert.equal(res1.body.documentId, sess1.documentId);
        assert.equal(res1.body.duplicate, undefined);

        // Second session initiation & completion (same hash)
        const sess2 = await initiate(16 * 1024 * 1024);
        queueMock.mock.resetCalls();

        const res2 = await request(app)
            .post(`/documents/${workspaceAId}/multipart/${sess2.sessionId}/complete`)
            .set("Authorization", `Bearer ${userAToken}`)
            .send({ parts: [{ partNumber: 1, etag: "etag-1" }, { partNumber: 2, etag: "etag-2" }] })
            .expect(200);

        assert.equal(res2.body.status, "COMPLETED");
        assert.equal(res2.body.duplicate, true);
        assert.equal(res2.body.documentId, sess1.documentId);
        assert.equal(res2.body.canonicalDocumentId, sess1.documentId);

        // Verify queue.add was NOT called for session 2
        assert.equal(queueMock.mock.callCount(), 0);

        // Verify session 2 document and session records were removed
        const dbDoc2 = await prisma.document.findUnique({ where: { id: sess2.documentId } });
        assert.equal(dbDoc2, null);

        const dbSess2 = await prisma.uploadSession.findUnique({ where: { id: sess2.sessionId } });
        assert.equal(dbSess2, null);
    });
});
