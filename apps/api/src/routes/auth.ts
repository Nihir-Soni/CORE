import { Router } from "express";

import { prisma } from "@core/database";
import {
    registerSchema,
    loginSchema,
} from "@core/shared";

import { hashPassword, verifyPassword } from "../lib/password.ts";
import { signAccessToken } from "../lib/jwt.ts";
import { createRefreshToken } from "../lib/refreshTokenStore.ts";
import { hashRefreshToken } from "../lib/refreshToken.ts";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.ts";

export const authRouter: Router = Router();

authRouter.post("/register", async (req, res, next) => {
    try {
        const input = registerSchema.parse(req.body);

        const existingUser = await prisma.user.findUnique({
            where: {
                email: input.email,
            },
        });

        if (existingUser) {
            return res.status(409).json({
                error: "email_taken",
            });
        }

        const passwordHash = await hashPassword(input.password);

        const result = await prisma.$transaction(async (tx) => {
            const organization = await tx.organization.create({
                data: {
                    name: input.orgName,
                },
            });

            const workspace = await tx.workspace.create({
                data: {
                    name: "Default",
                    orgId: organization.id,
                },
            });

            const user = await tx.user.create({
                data: {
                    email: input.email,
                    passwordHash,
                    name: input.name,
                    orgId: organization.id,
                },
            });

            await tx.membership.create({
                data: {
                    userId: user.id,
                    workspaceId: workspace.id,
                    role: "OWNER",
                },
            });

            const refreshToken = await createRefreshToken(
                user.id,
                tx,
            );

            return {
                user,
                workspace,
                refreshToken,
            };
        });

        const token = signAccessToken({
            userId: result.user.id,
            email: result.user.email,
            name: result.user.name ?? null,
        });

        return res.status(201).json({
            token,
            refreshToken: result.refreshToken,
            workspaceId: result.workspace.id,
        });
    } catch (error) {
        next(error);
    }
});

authRouter.post("/login", async (req, res, next) => {
    try {
        const input = loginSchema.parse(req.body);

        const user = await prisma.user.findUnique({
            where: {
                email: input.email,
            },
        });

        if (
            !user ||
            !(await verifyPassword(
                input.password,
                user.passwordHash,
            ))
        ) {
            return res.status(401).json({
                error: "invalid_credentials",
            });
        }

        const token = signAccessToken({
            userId: user.id,
            email: user.email,
            name: user.name ?? null,
        });

        const refreshToken = await createRefreshToken(user.id);

        const membership = await prisma.membership.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true },
        });

        return res.json({
            token,
            refreshToken,
            workspaceId: membership?.workspaceId ?? null,
        });
    } catch (error) {
        next(error);
    }
});


authRouter.post("/refresh", async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (
            typeof refreshToken !== "string" ||
            refreshToken.length === 0
        ) {
            return res.status(400).json({
                error: "refresh_token_required",
            });
        }

        const tokenHash = hashRefreshToken(refreshToken);

        const result = await prisma.$transaction(async (tx) => {
            const storedToken = await tx.refreshToken.findUnique({
                where: {
                    tokenHash,
                },
                include: {
                    user: true,
                },
            });

            if (!storedToken) {
                return null;
            }

            if (storedToken.revoked) {
                return null;
            }

            if (storedToken.expiresAt <= new Date()) {
                return null;
            }

            await tx.refreshToken.update({
                where: {
                    id: storedToken.id,
                },
                data: {
                    revoked: true,
                },
            });

            const newRefreshToken = await createRefreshToken(
                storedToken.userId,
                tx,
            );

            const accessToken = signAccessToken({
                userId: storedToken.user.id,
                email: storedToken.user.email,
                name: storedToken.user.name ?? null,
            });

            return {
                accessToken,
                refreshToken: newRefreshToken,
            };
        });

        if (!result) {
            return res.status(401).json({
                error: "invalid_refresh_token",
            });
        }

        return res.json({
            token: result.accessToken,
            refreshToken: result.refreshToken,
        });
    } catch (error) {
        next(error);
    }
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { id: true, email: true, name: true },
        });

        if (!user) {
            return res.status(404).json({ error: "user_not_found" });
        }

        return res.json({
            id: user.id,
            email: user.email,
            name: user.name,
        });
    } catch (error) {
        next(error);
    }
});

authRouter.post("/logout", async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (
            typeof refreshToken !== "string" ||
            refreshToken.length === 0
        ) {
            return res.status(400).json({
                error: "refresh_token_required",
            });
        }

        const tokenHash = hashRefreshToken(refreshToken);

        await prisma.refreshToken.updateMany({
            where: {
                tokenHash,
                revoked: false,
            },
            data: {
                revoked: true,
            },
        });

        return res.status(204).send();
    } catch (error) {
        next(error);
    }
});