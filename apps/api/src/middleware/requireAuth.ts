import type { NextFunction, Response } from "express";
import type { Request } from "express";

import { verifyAccessToken } from "../lib/jwt.ts";

export interface AuthedRequest extends Request {
    user?: {
        userId: string;
        email: string;
    };
}

export function requireAuth(
    req: AuthedRequest,
    res: Response,
    next: NextFunction,
) {
    let token: string | undefined;

    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
        token = header.slice(7);
    } else if (typeof req.query?.token === "string" && req.query.token.trim().length > 0) {
        token = req.query.token.trim();
    }

    if (!token) {
        return res.status(401).json({
            error: "missing_token",
        });
    }

    try {
        req.user = verifyAccessToken(token);
        next();
    } catch {
        return res.status(401).json({
            error: "invalid_token",
        });
    }
}