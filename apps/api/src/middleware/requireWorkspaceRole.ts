import type { NextFunction, Response } from "express";

import { prisma } from "@core/database";

import type { AuthedRequest } from "./requireAuth.ts";

const ROLE_RANK = {
    MEMBER: 0,
    ADMIN: 1,
    OWNER: 2,
} as const;

type Role = keyof typeof ROLE_RANK;

export function requireWorkspaceRole(minRole: Role) {
    return async (
        req: AuthedRequest,
        res: Response,
        next: NextFunction,
    ) => {
        const rawWorkspaceId =
            req.params.workspaceId ??
            req.body?.workspaceId;

        const workspaceId = Array.isArray(rawWorkspaceId)
            ? rawWorkspaceId[0]
            : rawWorkspaceId;

        if (!workspaceId || typeof workspaceId !== "string") {
            return res.status(400).json({
                error: "workspace_id_required",
            });
        }

        if (!req.user) {
            return res.status(401).json({
                error: "missing_authenticated_user",
            });
        }

        try {
            const workspace = await prisma.workspace.findUnique({
                where: { id: workspaceId },
            });

            if (!workspace) {
                return res.status(404).json({
                    error: "workspace_not_found",
                });
            }

            const membership = await prisma.membership.findUnique({
                where: {
                    userId_workspaceId: {
                        userId: req.user.userId,
                        workspaceId,
                    },
                },
            });

            if (
                !membership ||
                ROLE_RANK[membership.role] < ROLE_RANK[minRole]
            ) {
                return res.status(403).json({
                    error: "forbidden",
                });
            }

            next();
        } catch (error) {
            next(error);
        }
    };
}