import { Router } from "express";

import { prisma, AuditAction, withWorkspaceContext } from "@core/database";
import {
    createInvitationSchema,
    changeMemberRoleSchema,
    createWorkspaceSchema,
    env,
} from "@core/shared";

import {
    requireAuth,
    type AuthedRequest,
} from "../middleware/requireAuth.ts";
import { requireWorkspaceRole } from "../middleware/requireWorkspaceRole.ts";
import {
    generateInvitationToken,
    getInvitationUrl,
} from "../lib/invitationToken.ts";
import { recordAuditLog } from "../lib/auditLogger.ts";

export const workspacesRouter: Router = Router();
export const workspaceRouter: Router = workspacesRouter;

// ── Workspaces listing & creation ────────────────────────────────────────────

/**
 * List all workspaces the authenticated user belongs to.
 * Accessible to any authenticated user.
 */
workspacesRouter.get(
    "/",
    requireAuth,
    async (req: AuthedRequest, res, next) => {
        try {
            const memberships = await prisma.membership.findMany({
                where: {
                    userId: req.user!.userId,
                },
                include: {
                    workspace: {
                        include: {
                            _count: {
                                select: {
                                    documents: true,
                                    memberships: true,
                                },
                            },
                        },
                    },
                },
                orderBy: {
                    createdAt: "asc",
                },
            });

            return res.json(
                memberships.map((m) => ({
                    id: m.workspace.id,
                    name: m.workspace.name,
                    orgId: m.workspace.orgId,
                    role: m.role,
                    createdAt: m.createdAt,
                    documentCount: m.workspace._count.documents,
                    memberCount: m.workspace._count.memberships,
                })),
            );
        } catch (error) {
            next(error);
        }
    },
);

/**
 * Create a new workspace.
 * Automatically adds the creator as OWNER of the new workspace.
 */
workspacesRouter.post(
    "/",
    requireAuth,
    async (req: AuthedRequest, res, next) => {
        try {
            const parseResult = createWorkspaceSchema.safeParse(req.body);
            if (!parseResult.success) {
                return res.status(400).json({
                    error: "invalid_request",
                    details: parseResult.error.format(),
                });
            }
            const input = parseResult.data;

            const user = await prisma.user.findUnique({
                where: { id: req.user!.userId },
                select: { id: true, orgId: true },
            });

            if (!user) {
                return res.status(404).json({
                    error: "user_not_found",
                });
            }

            const result = await prisma.$transaction(async (tx) => {
                const workspace = await tx.workspace.create({
                    data: {
                        name: input.name,
                        orgId: user.orgId,
                    },
                });

                const membership = await tx.membership.create({
                    data: {
                        userId: user.id,
                        workspaceId: workspace.id,
                        role: "OWNER",
                    },
                });

                return {
                    workspace,
                    role: membership.role,
                    createdAt: membership.createdAt,
                };
            });

            return res.status(201).json({
                id: result.workspace.id,
                name: result.workspace.name,
                orgId: result.workspace.orgId,
                role: result.role,
                createdAt: result.createdAt,
                documentCount: 0,
                memberCount: 1,
            });
        } catch (error) {
            next(error);
        }
    },
);

// ── Role inspection ──────────────────────────────────────────────────────────

workspacesRouter.get(
    "/:workspaceId/role",
    requireAuth,
    requireWorkspaceRole("MEMBER"),
    async (req: AuthedRequest, res, next) => {
        try {
            const rawWorkspaceId = req.params.workspaceId;
            const workspaceId = Array.isArray(rawWorkspaceId)
                ? rawWorkspaceId[0]
                : rawWorkspaceId;

            const membership = await prisma.membership.findUnique({
                where: {
                    userId_workspaceId: {
                        userId: req.user!.userId,
                        workspaceId,
                    },
                },
            });

            if (!membership) {
                return res.status(403).json({
                    error: "forbidden",
                });
            }

            return res.json({
                role: membership.role,
            });
        } catch (error) {
            next(error);
        }
    },
);

// ── Workspace details ────────────────────────────────────────────────────────

workspacesRouter.get(
    "/:workspaceId",
    requireAuth,
    requireWorkspaceRole("MEMBER"),
    async (req: AuthedRequest, res, next) => {
        try {
            const rawWorkspaceId = req.params.workspaceId;
            const workspaceId = Array.isArray(rawWorkspaceId)
                ? rawWorkspaceId[0]
                : rawWorkspaceId;

            const workspace = await prisma.workspace.findUnique({
                where: {
                    id: workspaceId,
                },
            });

            if (!workspace) {
                return res.status(404).json({
                    error: "workspace_not_found",
                });
            }

            const membership = await prisma.membership.findUnique({
                where: {
                    userId_workspaceId: {
                        userId: req.user!.userId,
                        workspaceId,
                    },
                },
            });

            return res.json({
                ...workspace,
                role: membership?.role ?? null,
            });
        } catch (error) {
            next(error);
        }
    },
);

// ── Members management ───────────────────────────────────────────────────────

/**
 * List workspace members.
 * Accessible to OWNER and ADMIN. MEMBER forbidden.
 */
workspacesRouter.get(
    "/:workspaceId/members",
    requireAuth,
    requireWorkspaceRole("ADMIN"),
    async (req: AuthedRequest, res, next) => {
        try {
            const rawWorkspaceId = req.params.workspaceId;
            const workspaceId = Array.isArray(rawWorkspaceId)
                ? rawWorkspaceId[0]
                : rawWorkspaceId;

            const members = await prisma.membership.findMany({
                where: { workspaceId },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                },
                orderBy: [
                    { role: "asc" },
                    { createdAt: "asc" },
                ],
            });

            return res.json(
                members.map((m) => ({
                    userId: m.userId,
                    name: m.user.name,
                    email: m.user.email,
                    role: m.role,
                    createdAt: m.createdAt,
                })),
            );
        } catch (error) {
            next(error);
        }
    },
);

/**
 * Change member role.
 * Only OWNER can change member roles. ADMIN and MEMBER are forbidden.
 * Cannot grant OWNER role in this phase.
 * Cannot demote the last OWNER of the workspace.
 */
workspacesRouter.patch(
    "/:workspaceId/members/:userId/role",
    requireAuth,
    requireWorkspaceRole("OWNER"),
    async (req: AuthedRequest, res, next) => {
        try {
            const rawWorkspaceId = req.params.workspaceId;
            const workspaceId = Array.isArray(rawWorkspaceId)
                ? rawWorkspaceId[0]
                : rawWorkspaceId;

            const rawTargetUserId = req.params.userId;
            const targetUserId = Array.isArray(rawTargetUserId)
                ? rawTargetUserId[0]
                : rawTargetUserId;

            // Cannot promote to OWNER
            if (req.body?.role === "OWNER") {
                return res.status(400).json({
                    error: "cannot_grant_owner",
                });
            }

            const parseResult = changeMemberRoleSchema.safeParse(req.body);
            if (!parseResult.success) {
                return res.status(400).json({
                    error: "invalid_request",
                    details: parseResult.error.format(),
                });
            }
            const input = parseResult.data;

            const targetMembership = await prisma.membership.findUnique({
                where: {
                    userId_workspaceId: {
                        userId: targetUserId,
                        workspaceId,
                    },
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                },
            });

            if (!targetMembership) {
                return res.status(404).json({
                    error: "member_not_found",
                });
            }

            // If demoting an OWNER, ensure it is not the last OWNER
            if (targetMembership.role === "OWNER") {
                const ownerCount = await prisma.membership.count({
                    where: {
                        workspaceId,
                        role: "OWNER",
                    },
                });

                if (ownerCount <= 1) {
                    return res.status(400).json({
                        error: "cannot_demote_last_owner",
                    });
                }
            }

            const updated = await prisma.membership.update({
                where: {
                    userId_workspaceId: {
                        userId: targetUserId,
                        workspaceId,
                    },
                },
                data: {
                    role: input.role,
                },
            });

            await recordAuditLog({
                workspaceId,
                userId: req.user!.userId,
                action: "ROLE_CHANGED",
                resourceId: targetUserId,
                resourceName: targetMembership.user?.name || targetMembership.user?.email || targetUserId,
                details: {
                    targetUserId,
                    targetEmail: targetMembership.user?.email,
                    targetName: targetMembership.user?.name,
                    oldRole: targetMembership.role,
                    newRole: input.role,
                },
            });

            return res.json({
                ok: true,
                userId: updated.userId,
                role: updated.role,
            });
        } catch (error) {
            next(error);
        }
    },
);

/**
 * Remove a member from the workspace.
 * OWNER can remove any ADMIN or MEMBER (cannot remove last OWNER).
 * ADMIN can only remove MEMBER (cannot remove OWNER or other ADMINs).
 * Does not delete user account, documents, chunks, or memberships in other workspaces.
 */
workspacesRouter.delete(
    "/:workspaceId/members/:userId",
    requireAuth,
    requireWorkspaceRole("ADMIN"),
    async (req: AuthedRequest, res, next) => {
        try {
            const rawWorkspaceId = req.params.workspaceId;
            const workspaceId = Array.isArray(rawWorkspaceId)
                ? rawWorkspaceId[0]
                : rawWorkspaceId;

            const rawTargetUserId = req.params.userId;
            const targetUserId = Array.isArray(rawTargetUserId)
                ? rawTargetUserId[0]
                : rawTargetUserId;

            const callerMembership = await prisma.membership.findUnique({
                where: {
                    userId_workspaceId: {
                        userId: req.user!.userId,
                        workspaceId,
                    },
                },
            });

            if (!callerMembership) {
                return res.status(403).json({
                    error: "forbidden",
                });
            }

            const targetMembership = await prisma.membership.findUnique({
                where: {
                    userId_workspaceId: {
                        userId: targetUserId,
                        workspaceId,
                    },
                },
            });

            if (!targetMembership) {
                return res.status(404).json({
                    error: "member_not_found",
                });
            }

            // If target is an OWNER
            if (targetMembership.role === "OWNER") {
                if (callerMembership.role !== "OWNER") {
                    return res.status(403).json({
                        error: "forbidden",
                    });
                }

                // Check last OWNER protection
                const ownerCount = await prisma.membership.count({
                    where: {
                        workspaceId,
                        role: "OWNER",
                    },
                });

                if (ownerCount <= 1) {
                    return res.status(400).json({
                        error: "cannot_remove_last_owner",
                    });
                }
            }

            // If target is an ADMIN and caller is an ADMIN (caller cannot remove other ADMINs)
            if (
                targetMembership.role === "ADMIN" &&
                callerMembership.role === "ADMIN" &&
                callerMembership.userId !== targetUserId
            ) {
                return res.status(403).json({
                    error: "admin_cannot_remove_admin",
                });
            }

            // Remove membership
            await prisma.membership.delete({
                where: {
                    userId_workspaceId: {
                        userId: targetUserId,
                        workspaceId,
                    },
                },
            });

            return res.json({
                ok: true,
                removedUserId: targetUserId,
            });
        } catch (error) {
            next(error);
        }
    },
);

// ── Invitations management ───────────────────────────────────────────────────

/**
 * Create a new workspace invitation.
 * OWNER and ADMIN allowed. MEMBER forbidden.
 * Cannot invite as OWNER.
 * Rejects if invitee email is already a member.
 */
workspacesRouter.post(
    "/:workspaceId/invitations",
    requireAuth,
    requireWorkspaceRole("ADMIN"),
    async (req: AuthedRequest, res, next) => {
        try {
            const rawWorkspaceId = req.params.workspaceId;
            const workspaceId = Array.isArray(rawWorkspaceId)
                ? rawWorkspaceId[0]
                : rawWorkspaceId;

            // Cannot invite as OWNER
            if (req.body?.role === "OWNER") {
                return res.status(400).json({
                    error: "cannot_invite_owner",
                });
            }

            const parseResult = createInvitationSchema.safeParse(req.body);
            if (!parseResult.success) {
                return res.status(400).json({
                    error: "invalid_request",
                    details: parseResult.error.format(),
                });
            }
            const input = parseResult.data;
            const normalizedEmail = input.email.trim().toLowerCase();

            // Check if user is already a member of this workspace
            const existingMember = await prisma.membership.findFirst({
                where: {
                    workspaceId,
                    user: {
                        email: {
                            equals: normalizedEmail,
                            mode: "insensitive",
                        },
                    },
                },
            });

            if (existingMember) {
                return res.status(409).json({
                    error: "already_member",
                });
            }

            // Revoke any pending invitations for the same email in this workspace
            await prisma.invitation.updateMany({
                where: {
                    workspaceId,
                    email: {
                        equals: normalizedEmail,
                        mode: "insensitive",
                    },
                    status: "PENDING",
                },
                data: {
                    status: "REVOKED",
                },
            });

            const { token, tokenHash, expiresAt } = generateInvitationToken();

            const invitation = await prisma.invitation.create({
                data: {
                    workspaceId,
                    email: normalizedEmail,
                    role: input.role,
                    tokenHash,
                    status: "PENDING",
                    expiresAt,
                    invitedById: req.user!.userId,
                },
            });

            const responsePayload: Record<string, unknown> = {
                id: invitation.id,
                workspaceId: invitation.workspaceId,
                email: invitation.email,
                role: invitation.role,
                status: invitation.status,
                expiresAt: invitation.expiresAt,
                createdAt: invitation.createdAt,
            };

            // In development mode only, expose inviteUrl for easy testing without an email service
            if (process.env.NODE_ENV !== "production") {
                responsePayload.inviteUrl = getInvitationUrl(token);
            }

            await recordAuditLog({
                workspaceId,
                userId: req.user!.userId,
                action: "MEMBER_INVITED",
                resourceId: invitation.id,
                resourceName: normalizedEmail,
                details: {
                    email: normalizedEmail,
                    role: input.role,
                },
            });

            return res.status(201).json(responsePayload);
        } catch (error) {
            next(error);
        }
    },
);

/**
 * List workspace invitations.
 * OWNER and ADMIN allowed. MEMBER forbidden.
 * Never returns tokenHash or raw token.
 */
workspacesRouter.get(
    "/:workspaceId/invitations",
    requireAuth,
    requireWorkspaceRole("ADMIN"),
    async (req: AuthedRequest, res, next) => {
        try {
            const rawWorkspaceId = req.params.workspaceId;
            const workspaceId = Array.isArray(rawWorkspaceId)
                ? rawWorkspaceId[0]
                : rawWorkspaceId;

            const invitations = await prisma.invitation.findMany({
                where: {
                    workspaceId,
                },
                include: {
                    invitedBy: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: "desc",
                },
            });

            const now = new Date();

            return res.json(
                invitations.map((inv) => {
                    const isExpired = inv.expiresAt <= now;
                    const status =
                        inv.status === "PENDING" && isExpired
                            ? "EXPIRED"
                            : inv.status;

                    return {
                        id: inv.id,
                        workspaceId: inv.workspaceId,
                        email: inv.email,
                        role: inv.role,
                        status,
                        expiresAt: inv.expiresAt,
                        createdAt: inv.createdAt,
                        invitedBy: inv.invitedBy,
                    };
                }),
            );
        } catch (error) {
            next(error);
        }
    },
);

/**
 * Revoke a pending invitation.
 * OWNER and ADMIN allowed.
 */
workspacesRouter.delete(
    "/:workspaceId/invitations/:invitationId",
    requireAuth,
    requireWorkspaceRole("ADMIN"),
    async (req: AuthedRequest, res, next) => {
        try {
            const rawWorkspaceId = req.params.workspaceId;
            const workspaceId = Array.isArray(rawWorkspaceId)
                ? rawWorkspaceId[0]
                : rawWorkspaceId;

            const rawInvitationId = req.params.invitationId;
            const invitationId = Array.isArray(rawInvitationId)
                ? rawInvitationId[0]
                : rawInvitationId;

            const invitation = await prisma.invitation.findFirst({
                where: {
                    id: invitationId,
                    workspaceId,
                },
            });

            if (!invitation) {
                return res.status(404).json({
                    error: "invitation_not_found",
                });
            }

            if (invitation.status !== "PENDING") {
                return res.status(400).json({
                    error: "invitation_not_pending",
                });
            }

            await prisma.invitation.update({
                where: {
                    id: invitation.id,
                },
                data: {
                    status: "REVOKED",
                },
            });

            return res.json({
                ok: true,
                status: "REVOKED",
            });
        } catch (error) {
            next(error);
        }
    },
);

// ── Activity and Audit Logs ───────────────────────────────────────────────────

/**
 * List audit logs for a workspace.
 * Accessible to OWNER and ADMIN. MEMBER forbidden.
 */
workspacesRouter.get(
    "/:workspaceId/audit-logs",
    requireAuth,
    requireWorkspaceRole("ADMIN"),
    async (req: AuthedRequest, res, next) => {
        try {
            const rawWorkspaceId = req.params.workspaceId;
            const workspaceId = Array.isArray(rawWorkspaceId)
                ? rawWorkspaceId[0]
                : rawWorkspaceId;

            const actionQuery = typeof req.query.action === "string" ? req.query.action.trim() : undefined;
            const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 100);
            const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

            const filterAction = actionQuery && Object.values(AuditAction).includes(actionQuery as any)
                ? (actionQuery as AuditAction)
                : undefined;

            const whereClause = {
                workspaceId,
                ...(filterAction ? { action: filterAction } : {}),
            };

            const [logs, total] = await Promise.all([
                prisma.auditLog.findMany({
                    where: whereClause,
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                            },
                        },
                    },
                    orderBy: {
                        createdAt: "desc",
                    },
                    take: limit,
                    skip: offset,
                }),
                prisma.auditLog.count({
                    where: whereClause,
                }),
            ]);

            return res.json({
                logs: logs.map((log) => ({
                    id: log.id,
                    workspaceId: log.workspaceId,
                    userId: log.userId,
                    action: log.action,
                    resourceId: log.resourceId,
                    resourceName: log.resourceName,
                    details: log.details,
                    createdAt: log.createdAt.toISOString(),
                    user: log.user,
                })),
                total,
                limit,
                offset,
            });
        } catch (error) {
            next(error);
        }
    },
);

// ── Workspace Analytics ───────────────────────────────────────────────────────

function getMimeLabel(mime: string): string {
    switch (mime) {
        case "application/pdf": return "PDF Document";
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "Word Document (DOCX)";
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return "Excel Spreadsheet (XLSX)";
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation": return "PowerPoint Presentation (PPTX)";
        case "image/png": return "PNG Image";
        case "image/jpeg": return "JPEG Image";
        case "image/webp": return "WebP Image";
        case "text/plain": return "Plain Text";
        default: return mime;
    }
}

function getFileCategory(mime: string): string {
    if (mime === "application/pdf") return "PDF";
    if (mime.includes("wordprocessingml") || mime.includes("document") || mime === "text/plain") return "Word / Text";
    if (mime.includes("spreadsheetml") || mime.includes("excel") || mime === "text/csv") return "Spreadsheets";
    if (mime.includes("presentationml") || mime.includes("powerpoint")) return "Presentations";
    if (mime.startsWith("image/")) return "Images";
    return "Other";
}

/**
 * Get comprehensive analytics for a workspace:
 * - Document processing statistics & jobs breakdown
 * - Storage consumption & category distribution
 * - AI usage (chunks, embeddings, indexed tokens, model info)
 * - Query & audit event counts
 * Accessible to any member of the workspace (OWNER, ADMIN, MEMBER).
 */
workspacesRouter.get(
    "/:workspaceId/analytics",
    requireAuth,
    requireWorkspaceRole("MEMBER"),
    async (req: AuthedRequest, res, next) => {
        try {
            const rawWorkspaceId = req.params.workspaceId;
            const workspaceId = Array.isArray(rawWorkspaceId)
                ? rawWorkspaceId[0]
                : rawWorkspaceId;

            const analytics = await withWorkspaceContext(workspaceId, async (tx) => {
                // 1. Fetch documents
                const docs = await tx.document.findMany({
                    where: { workspaceId },
                    select: {
                        id: true,
                        filename: true,
                        sizeBytes: true,
                        mimeType: true,
                        status: true,
                        createdAt: true,
                    },
                    orderBy: { sizeBytes: "desc" },
                });

                const totalDocuments = docs.length;
                const byStatus = {
                    READY: 0,
                    PROCESSING: 0,
                    UPLOADING: 0,
                    FAILED: 0,
                    DELETING: 0,
                };
                let totalBytes = 0;
                const mimeMap = new Map<string, { count: number; bytes: number }>();

                for (const doc of docs) {
                    if (doc.status in byStatus) {
                        byStatus[doc.status as keyof typeof byStatus] += 1;
                    }
                    totalBytes += doc.sizeBytes || 0;
                    const mime = doc.mimeType || "application/octet-stream";
                    const existing = mimeMap.get(mime) || { count: 0, bytes: 0 };
                    mimeMap.set(mime, {
                        count: existing.count + 1,
                        bytes: existing.bytes + (doc.sizeBytes || 0),
                    });
                }

                // 2. Processing Jobs
                const jobs = await tx.processingJob.findMany({
                    where: { workspaceId },
                    select: {
                        id: true,
                        status: true,
                        startedAt: true,
                        completedAt: true,
                    },
                });

                const jobsByStatus = {
                    QUEUED: 0,
                    PROCESSING: 0,
                    COMPLETED: 0,
                    FAILED: 0,
                };
                let durationSum = 0;
                let durationCount = 0;

                for (const job of jobs) {
                    if (job.status in jobsByStatus) {
                        jobsByStatus[job.status as keyof typeof jobsByStatus] += 1;
                    }
                    if (job.startedAt && job.completedAt) {
                        const dur = (job.completedAt.getTime() - job.startedAt.getTime()) / 1000;
                        if (dur >= 0) {
                            durationSum += dur;
                            durationCount += 1;
                        }
                    }
                }

                const totalJobs = jobs.length;
                const processingSuccessRate = totalJobs > 0
                    ? Math.round((jobsByStatus.COMPLETED / totalJobs) * 1000) / 10
                    : totalDocuments > 0
                        ? Math.round((byStatus.READY / totalDocuments) * 1000) / 10
                        : 100;

                const avgProcessingDurationSec = durationCount > 0
                    ? Math.round((durationSum / durationCount) * 10) / 10
                    : null;

                // 3. Document Content stats
                const contentAgg = await tx.documentContent.aggregate({
                    where: { document: { workspaceId } },
                    _sum: { pageCount: true, charCount: true },
                });

                // 4. Chunk & Embedding stats
                const chunkAgg = await tx.chunk.aggregate({
                    where: { workspaceId },
                    _count: true,
                    _sum: { tokenCount: true },
                    _avg: { tokenCount: true },
                });

                const totalEmbeddings = await tx.chunkEmbedding.count({
                    where: { chunk: { workspaceId } },
                });

                // 5. Audit stats
                const auditGroup = await tx.auditLog.groupBy({
                    by: ["action"],
                    where: { workspaceId },
                    _count: { _all: true },
                });

                const auditCounts: Record<string, number> = {};
                let totalAuditEvents = 0;
                for (const item of auditGroup) {
                    auditCounts[item.action] = item._count._all;
                    totalAuditEvents += item._count._all;
                }

                // Format mime types & categories
                const byMimeType = Array.from(mimeMap.entries())
                    .map(([mimeType, stat]) => ({
                        mimeType,
                        label: getMimeLabel(mimeType),
                        count: stat.count,
                        totalBytes: stat.bytes,
                        percentage: totalBytes > 0 ? Math.round((stat.bytes / totalBytes) * 1000) / 10 : 0,
                    }))
                    .sort((a, b) => b.totalBytes - a.totalBytes);

                // Group by higher level category
                const categoryMap = new Map<string, { count: number; bytes: number }>();
                for (const doc of docs) {
                    const cat = getFileCategory(doc.mimeType);
                    const existing = categoryMap.get(cat) || { count: 0, bytes: 0 };
                    categoryMap.set(cat, {
                        count: existing.count + 1,
                        bytes: existing.bytes + (doc.sizeBytes || 0),
                    });
                }

                const byCategory = Array.from(categoryMap.entries())
                    .map(([category, stat]) => ({
                        category,
                        count: stat.count,
                        bytes: stat.bytes,
                        percentage: totalBytes > 0 ? Math.round((stat.bytes / totalBytes) * 1000) / 10 : 0,
                    }))
                    .sort((a, b) => b.bytes - a.bytes);

                // Recent trend (past 7 days)
                const recentTrend: Array<{ date: string; uploads: number; ready: number }> = [];
                const dayMap = new Map<string, { uploads: number; ready: number }>();
                const now = new Date();
                for (let i = 6; i >= 0; i--) {
                    const d = new Date(now);
                    d.setDate(d.getDate() - i);
                    const dateKey = d.toISOString().slice(0, 10);
                    dayMap.set(dateKey, { uploads: 0, ready: 0 });
                }

                for (const doc of docs) {
                    const dateKey = doc.createdAt.toISOString().slice(0, 10);
                    if (dayMap.has(dateKey)) {
                        const entry = dayMap.get(dateKey)!;
                        entry.uploads += 1;
                        if (doc.status === "READY") {
                            entry.ready += 1;
                        }
                    }
                }

                for (const [date, val] of dayMap.entries()) {
                    recentTrend.push({ date, uploads: val.uploads, ready: val.ready });
                }

                return {
                    documentStats: {
                        totalDocuments,
                        byStatus,
                        processingSuccessRate,
                        totalJobs,
                        jobsByStatus,
                        avgProcessingDurationSec,
                        totalPagesExtracted: contentAgg._sum.pageCount || 0,
                        totalCharsExtracted: contentAgg._sum.charCount || 0,
                        byMimeType,
                        recentTrend,
                    },
                    storageStats: {
                        totalBytes,
                        avgSizeBytes: totalDocuments > 0 ? Math.round(totalBytes / totalDocuments) : 0,
                        largestDocument: docs[0]
                            ? {
                                id: docs[0].id,
                                filename: docs[0].filename,
                                sizeBytes: docs[0].sizeBytes,
                                mimeType: docs[0].mimeType,
                              }
                            : null,
                        byCategory,
                        largestDocuments: docs.slice(0, 5).map((d) => ({
                            id: d.id,
                            filename: d.filename,
                            sizeBytes: d.sizeBytes,
                            mimeType: d.mimeType,
                            createdAt: d.createdAt.toISOString(),
                        })),
                    },
                    aiStats: {
                        totalChunks: chunkAgg._count || 0,
                        totalEmbeddings,
                        totalIndexedTokens: chunkAgg._sum.tokenCount || 0,
                        avgTokensPerChunk: Math.round(chunkAgg._avg.tokenCount || 0),
                        avgChunksPerDocument: totalDocuments > 0
                            ? Math.round(((chunkAgg._count || 0) / totalDocuments) * 10) / 10
                            : 0,
                        embeddingModel: "gemini-embedding-001 (768-dim)",
                        chatModel: env.GEMINI_CHAT_MODEL || "gemini-3.8-flash",
                    },
                    queryStats: {
                        totalAuditEvents,
                        totalDownloads: auditCounts.DOCUMENT_DOWNLOADED || 0,
                        totalUploadEvents: auditCounts.DOCUMENT_UPLOADED || 0,
                        totalDeleteEvents: auditCounts.DOCUMENT_DELETED || 0,
                        totalMemberEvents: (auditCounts.MEMBER_INVITED || 0) + (auditCounts.ROLE_CHANGED || 0),
                    },
                };
            });

            return res.json(analytics);
        } catch (error) {
            next(error);
        }
    },
);

