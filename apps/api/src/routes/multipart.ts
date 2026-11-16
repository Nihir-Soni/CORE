import { Router } from "express";
import { DocumentRepository, UploadSessionRepository, ProcessingJobRepository } from "@core/database";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.ts";
import { requireWorkspaceRole } from "../middleware/requireWorkspaceRole.ts";
import { recordAuditLog } from "../lib/auditLogger.ts";
import {
    buildStorageKey,
} from "@core/storage";
import * as storage from "@core/storage";
import { documentProcessingQueue } from "@core/jobs";
import { dispatchDocumentProcessingWorkflow } from "../lib/githubActions.ts";
import { ALLOWED_MIME_SET, resolveMimeType } from "@core/shared";

export const multipartRouter: Router = Router({ mergeParams: true });

const MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const PART_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

// Testable storage operations - can be replaced in tests
export type MultipartStorageOps = {
    initiateMultipartUpload: typeof storage.initiateMultipartUpload;
    presignUploadPart: typeof storage.presignUploadPart;
    listMultipartParts: typeof storage.listMultipartParts;
    completeMultipartUpload: typeof storage.completeMultipartUpload;
    abortMultipartUpload: typeof storage.abortMultipartUpload;
    computeObjectSha256: typeof storage.computeObjectSha256;
    deleteObject: typeof storage.deleteObject;
};

let storageOps: MultipartStorageOps = {
    initiateMultipartUpload: storage.initiateMultipartUpload,
    presignUploadPart: storage.presignUploadPart,
    listMultipartParts: storage.listMultipartParts,
    completeMultipartUpload: storage.completeMultipartUpload,
    abortMultipartUpload: storage.abortMultipartUpload,
    computeObjectSha256: storage.computeObjectSha256,
    deleteObject: storage.deleteObject,
};

export function setMultipartStorageOps(ops: Partial<MultipartStorageOps>) {
    storageOps = { ...storageOps, ...ops };
}

export function resetMultipartStorageOps() {
    storageOps = {
        initiateMultipartUpload: storage.initiateMultipartUpload,
        presignUploadPart: storage.presignUploadPart,
        listMultipartParts: storage.listMultipartParts,
        completeMultipartUpload: storage.completeMultipartUpload,
        abortMultipartUpload: storage.abortMultipartUpload,
        computeObjectSha256: storage.computeObjectSha256,
        deleteObject: storage.deleteObject,
    };
}

const ALLOWED_MIME = ALLOWED_MIME_SET;

multipartRouter.post(
    "/initiate",
    requireAuth,
    requireWorkspaceRole("MEMBER"),
    async (req: AuthedRequest, res, next) => {
        try {
            let { filename, mimeType, sizeBytes } = req.body;

            const resolvedMime = resolveMimeType(filename, mimeType);
            if (!resolvedMime) {
                return res.status(400).json({ error: "unsupported_file_type" });
            }
            mimeType = resolvedMime;

            if (typeof sizeBytes !== "number" || sizeBytes <= 0) {
                return res.status(400).json({ error: "invalid_file_size" });
            }

            if (sizeBytes > MAX_SIZE_BYTES) {
                return res.status(400).json({ error: "file_too_large" });
            }

            if (typeof filename !== "string" || filename.trim().length === 0) {
                return res.status(400).json({ error: "invalid_filename" });
            }

            const rawWorkspaceId = req.params.workspaceId;
            const workspaceId = Array.isArray(rawWorkspaceId) ? rawWorkspaceId[0] : rawWorkspaceId;
            const ctx = { workspaceId };

            const storageKey = buildStorageKey(workspaceId, filename);
            const totalParts = Math.ceil(sizeBytes / PART_SIZE_BYTES);

            const document = await DocumentRepository.create(ctx, {
                uploadedById: req.user!.userId,
                filename,
                mimeType,
                sizeBytes,
                storageKey,
                status: "UPLOADING",
            });

            let uploadId: string;
            try {
                const initRes = await storageOps.initiateMultipartUpload(storageKey, mimeType);
                uploadId = initRes.uploadId;
            } catch (err) {
                await DocumentRepository.update(ctx, document.id, { status: "FAILED" });
                return res.status(500).json({ error: "storage_initiation_failed" });
            }

            const session = await UploadSessionRepository.create(ctx, {
                documentId: document.id,
                uploadId,
                storageKey,
                filename,
                mimeType,
                sizeBytes: BigInt(sizeBytes),
                partSizeBytes: PART_SIZE_BYTES,
                totalParts,
            });

            return res.status(201).json({
                sessionId: session.id,
                documentId: document.id,
                uploadId,
                storageKey,
                partSizeBytes: PART_SIZE_BYTES,
                totalParts,
            });
        } catch (err) {
            next(err);
        }
    }
);

multipartRouter.post(
    "/:sessionId/part-url",
    requireAuth,
    requireWorkspaceRole("MEMBER"),
    async (req: AuthedRequest, res, next) => {
        try {
            const { partNumber } = req.body;
            const workspaceId = req.params.workspaceId as string;
            const sessionId = req.params.sessionId as string;
            const ctx = { workspaceId };

            if (typeof partNumber !== "number" || !Number.isInteger(partNumber) || partNumber < 1) {
                return res.status(400).json({ error: "invalid_part_number" });
            }

            const session = await UploadSessionRepository.findById(ctx, sessionId);

            if (!session) {
                return res.status(404).json({ error: "not_found" });
            }

            if (session.status !== "INITIATED") {
                return res.status(400).json({ error: "invalid_session_status" });
            }

            if (partNumber > session.totalParts) {
                return res.status(400).json({ error: "part_number_out_of_bounds" });
            }

            const uploadUrl = await storageOps.presignUploadPart(session.storageKey, session.uploadId, partNumber);

            return res.json({ partNumber, uploadUrl });
        } catch (err) {
            next(err);
        }
    }
);

multipartRouter.get(
    "/:sessionId",
    requireAuth,
    requireWorkspaceRole("MEMBER"),
    async (req: AuthedRequest, res, next) => {
        try {
            const workspaceId = req.params.workspaceId as string;
            const sessionId = req.params.sessionId as string;
            const ctx = { workspaceId };

            const session = await UploadSessionRepository.findById(ctx, sessionId);

            if (!session) {
                return res.status(404).json({ error: "not_found" });
            }

            // Always fetch actual MinIO state for in-progress sessions
            let uploadedParts: Array<{ partNumber: number; etag: string }> = [];
            if (session.status === "INITIATED" || session.status === "COMPLETING") {
                try {
                    const partsFromS3 = await storageOps.listMultipartParts(session.storageKey, session.uploadId);
                    uploadedParts = partsFromS3.map((p: any) => ({
                        partNumber: p.PartNumber,
                        etag: p.ETag?.replace(/"/g, "")
                    }));
                } catch (e) {
                    console.error("Failed to list parts:", e);
                }
            }

            return res.json({
                sessionId: session.id,
                documentId: session.documentId,
                status: session.status,
                partSizeBytes: Number(session.partSizeBytes),
                totalParts: session.totalParts,
                uploadedParts,
            });
        } catch (err) {
            next(err);
        }
    }
);

multipartRouter.post(
    "/:sessionId/complete",
    requireAuth,
    requireWorkspaceRole("MEMBER"),
    async (req: AuthedRequest, res, next) => {
        try {
            const workspaceId = req.params.workspaceId as string;
            const sessionId = req.params.sessionId as string;
            const { parts } = req.body;
            const ctx = { workspaceId };

            const session = await UploadSessionRepository.findById(ctx, sessionId);

            if (!session) {
                return res.status(404).json({ error: "not_found" });
            }

            // Idempotency: if already completed, return existing state
            if (session.status === "COMPLETED") {
                return res.json({
                    sessionId: session.id,
                    documentId: session.documentId,
                    status: "COMPLETED"
                });
            }

            if (!Array.isArray(parts) || parts.length === 0) {
                return res.status(400).json({ error: "invalid_parts" });
            }
            if (parts.length !== session.totalParts) {
                return res.status(400).json({ error: "missing_parts" });
            }

            // Verify ETags against actual MinIO state - do not trust the client
            let s3Parts: any[] = [];
            try {
                s3Parts = await storageOps.listMultipartParts(session.storageKey, session.uploadId);
            } catch (err) {
                return res.status(500).json({ error: "storage_verification_failed" });
            }

            const s3PartsMap = new Map<number, string>();
            for (const sp of s3Parts) {
                s3PartsMap.set(sp.PartNumber, sp.ETag?.replace(/"/g, ""));
            }

            const seen = new Set<number>();
            for (const p of parts) {
                if (typeof p.partNumber !== "number" || typeof p.etag !== "string") {
                    return res.status(400).json({ error: "invalid_parts_format" });
                }
                if (p.partNumber < 1 || p.partNumber > session.totalParts) {
                    return res.status(400).json({ error: "invalid_part_number" });
                }
                if (seen.has(p.partNumber)) {
                    return res.status(400).json({ error: "duplicate_part_number" });
                }
                seen.add(p.partNumber);

                const realETag = s3PartsMap.get(p.partNumber);
                if (!realETag || realETag !== p.etag.replace(/"/g, "")) {
                    return res.status(400).json({ error: "etag_mismatch", partNumber: p.partNumber });
                }
            }

            // Mark as COMPLETING to handle crashes between S3 complete and DB update
            await UploadSessionRepository.update(ctx, session.id, { status: "COMPLETING" });

            try {
                await storageOps.completeMultipartUpload(session.storageKey, session.uploadId, parts);
            } catch (err) {
                return res.status(500).json({ error: "storage_completion_failed" });
            }

            let sha256: string;
            try {
                sha256 = await storageOps.computeObjectSha256(session.storageKey);
            } catch (hashErr) {
                console.error(`Hashing failed for multipart session ${session.id}:`, hashErr);
                await DocumentRepository.update(ctx, session.documentId, { status: "FAILED" }).catch(e => console.error(e));
                await UploadSessionRepository.update(ctx, session.id, { status: "FAILED" }).catch(e => console.error(e));

                return res.status(500).json({ error: "hashing_failed" });
            }

            const existingDoc = await DocumentRepository.findBySha256(ctx, sha256, session.documentId);

            if (existingDoc) {
                await storageOps.deleteObject(session.storageKey).catch(e => console.error("Failed to delete duplicate S3 object:", e));
                await UploadSessionRepository.delete(ctx, session.id).catch(e => console.error(e));
                await DocumentRepository.delete(ctx, session.documentId).catch(e => console.error(e));

                return res.json({
                    sessionId: session.id,
                    documentId: existingDoc.id,
                    canonicalDocumentId: existingDoc.id,
                    status: "COMPLETED",
                    duplicate: true,
                });
            }

            let updatedDoc: any;
            try {
                updatedDoc = await DocumentRepository.update(ctx, session.documentId, {
                    sha256,
                    status: "UPLOADED",
                });
            } catch (dbErr: any) {
                if (dbErr?.code === "P2002") {
                    const canonical = await DocumentRepository.findBySha256(ctx, sha256, session.documentId);

                    if (canonical) {
                        await storageOps.deleteObject(session.storageKey).catch(e => console.error(e));
                        await UploadSessionRepository.delete(ctx, session.id).catch(e => console.error(e));
                        await DocumentRepository.delete(ctx, session.documentId).catch(e => console.error(e));

                        return res.json({
                            sessionId: session.id,
                            documentId: canonical.id,
                            canonicalDocumentId: canonical.id,
                            status: "COMPLETED",
                            duplicate: true,
                        });
                    }
                }
                throw dbErr;
            }

            await UploadSessionRepository.update(ctx, session.id, {
                status: "COMPLETED",
                completedAt: new Date(),
            });

            // Idempotent job creation — reuse existing job if one exists
            let processingJob = await ProcessingJobRepository.findLatestByDocumentId(ctx, updatedDoc!.id);

            if (!processingJob) {
                try {
                    processingJob = await ProcessingJobRepository.create(ctx, {
                        documentId: updatedDoc!.id,
                        status: "QUEUED",
                        progress: 0,
                        progressMessage: "Job queued",
                    });
                } catch (err) {
                    console.error(`Failed to create ProcessingJob for document ${updatedDoc!.id}:`, err);
                    return res.status(500).json({ error: "internal_error" });
                }

                try {
                    await documentProcessingQueue.add("process-document", {
                        documentId: updatedDoc!.id,
                        workspaceId: updatedDoc!.workspaceId,
                        processingJobId: processingJob.id,
                    }, {
                        jobId: processingJob.id,
                    });
                } catch (err) {
                    console.error(`Failed to enqueue job for document ${updatedDoc!.id}:`, err);
                    await ProcessingJobRepository.update(ctx, processingJob.id, {
                        status: "FAILED",
                        lastError: "Enqueue failed",
                    }).catch(e => console.error(e));

                    return res.status(500).json({ error: "queue_error" });
                }
                await dispatchDocumentProcessingWorkflow({
                    documentId: updatedDoc!.id,
                });
            }

            await recordAuditLog({
                workspaceId,
                userId: req.user!.userId,
                action: "DOCUMENT_UPLOADED",
                resourceId: updatedDoc!.id,
                resourceName: updatedDoc!.filename,
                details: {
                    sizeBytes: updatedDoc!.sizeBytes,
                    mimeType: updatedDoc!.mimeType,
                    multipart: true,
                },
            });

            return res.json({
                sessionId: session.id,
                documentId: updatedDoc!.id,
                status: "COMPLETED"
            });
        } catch (err) {
            next(err);
        }
    }
);

multipartRouter.post(
    "/:sessionId/abort",
    requireAuth,
    requireWorkspaceRole("MEMBER"),
    async (req: AuthedRequest, res, next) => {
        try {
            const workspaceId = req.params.workspaceId as string;
            const sessionId = req.params.sessionId as string;
            const ctx = { workspaceId };

            const session = await UploadSessionRepository.findById(ctx, sessionId);

            if (!session) {
                return res.status(404).json({ error: "not_found" });
            }

            // Already terminal states
            if (session.status === "ABORTED" || session.status === "FAILED") {
                return res.json({ status: "ABORTED" });
            }
            if (session.status === "COMPLETED") {
                return res.status(400).json({ error: "cannot_abort_completed" });
            }

            try {
                await storageOps.abortMultipartUpload(session.storageKey, session.uploadId);
            } catch (err) {
                // Ignore missing uploads in MinIO if already gone
            }

            await DocumentRepository.update(ctx, session.documentId, { status: "FAILED" });
            await UploadSessionRepository.update(ctx, session.id, { status: "ABORTED" });

            return res.json({ status: "ABORTED" });
        } catch (err) {
            next(err);
        }
    }
);
