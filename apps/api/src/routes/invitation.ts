import { Router } from "express";

import { prisma } from "@core/database";
import { acceptInvitationSchema } from "@core/shared";

import {
    requireAuth,
    type AuthedRequest,
} from "../middleware/requireAuth.ts";
import { hashInvitationToken } from "../lib/invitationToken.ts";

export const invitationsRouter: Router = Router();
export const invitationRouter: Router = invitationsRouter;

/**
 * Inspect invitation by raw token.
 * Open to invitees (can be unauthenticated or authenticated).
 * Returns safe details about the invitation, workspace, and inviter.
 */
invitationsRouter.get("/:token", async (req, res, next) => {
    try {
        const rawToken = req.params.token;
        const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

        if (!token || typeof token !== "string") {
            return res.status(400).json({ error: "token_required" });
        }

        const tokenHash = hashInvitationToken(token);

        const invitation = await prisma.invitation.findUnique({
            where: { tokenHash },
            include: {
                workspace: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                invitedBy: {
                    select: {
                        name: true,
                        email: true,
                    },
                },
            },
        });

        if (!invitation) {
            return res.status(404).json({ error: "invitation_not_found" });
        }

        const now = new Date();
        const isExpired = invitation.expiresAt <= now;
        const status =
            invitation.status === "PENDING" && isExpired
                ? "EXPIRED"
                : invitation.status;

        return res.json({
            id: invitation.id,
            workspaceId: invitation.workspaceId,
            workspaceName: invitation.workspace.name,
            email: invitation.email,
            role: invitation.role,
            status,
            expiresAt: invitation.expiresAt,
            invitedBy: invitation.invitedBy,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Accept an invitation.
 * Requires authentication.
 * Transaction-safe against concurrent acceptance, duplicate membership,
 * email mismatches, and expired/revoked invitations.
 */
invitationsRouter.post("/accept", requireAuth, async (req: AuthedRequest, res, next) => {
    try {
        const parseResult = acceptInvitationSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                error: "invalid_request",
                details: parseResult.error.format(),
            });
        }
        const input = parseResult.data;
        const tokenHash = hashInvitationToken(input.token);
        const authedUser = req.user!;
        const authedEmail = authedUser.email.trim().toLowerCase();

        const result = await prisma.$transaction(async (tx) => {
            const invitation = await tx.invitation.findUnique({
                where: { tokenHash },
                include: {
                    workspace: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            });

            if (!invitation) {
                return { status: 404, error: "invitation_not_found" };
            }

            if (invitation.status === "REVOKED") {
                return { status: 400, error: "invitation_revoked" };
            }

            if (invitation.status === "ACCEPTED") {
                return { status: 400, error: "invitation_already_accepted" };
            }

            if (invitation.expiresAt <= new Date() || invitation.status === "EXPIRED") {
                return { status: 400, error: "invitation_expired" };
            }

            if (invitation.status !== "PENDING") {
                return { status: 400, error: "invitation_invalid" };
            }

            // Verify email match (case-insensitive)
            if (invitation.email.trim().toLowerCase() !== authedEmail) {
                return {
                    status: 403,
                    error: "email_mismatch",
                    expectedEmail: invitation.email,
                };
            }

            // Check if already a member
            const existingMembership = await tx.membership.findUnique({
                where: {
                    userId_workspaceId: {
                        userId: authedUser.userId,
                        workspaceId: invitation.workspaceId,
                    },
                },
            });

            if (existingMembership) {
                // Mark invitation as accepted if already a member
                await tx.invitation.update({
                    where: { id: invitation.id },
                    data: { status: "ACCEPTED" },
                });
                return {
                    status: 409,
                    error: "already_member",
                    workspaceId: invitation.workspaceId,
                };
            }

            // Atomically create membership and mark invitation as ACCEPTED
            const membership = await tx.membership.create({
                data: {
                    userId: authedUser.userId,
                    workspaceId: invitation.workspaceId,
                    role: invitation.role, // role specified on invitation
                },
            });

            await tx.invitation.update({
                where: { id: invitation.id },
                data: { status: "ACCEPTED" },
            });

            return {
                status: 200,
                data: {
                    ok: true,
                    workspaceId: invitation.workspaceId,
                    workspaceName: invitation.workspace.name,
                    role: membership.role,
                },
            };
        });

        if (result.status !== 200) {
            return res.status(result.status).json({
                error: result.error,
                ...(result.expectedEmail ? { expectedEmail: result.expectedEmail } : {}),
                ...(result.workspaceId ? { workspaceId: result.workspaceId } : {}),
            });
        }

        return res.json(result.data);
    } catch (error) {
        next(error);
    }
});
