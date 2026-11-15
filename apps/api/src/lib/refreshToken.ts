import { createHash, randomBytes } from "node:crypto";

const REFRESH_TOKEN_BYTES = 32;
const REFRESH_TOKEN_TTL_DAYS = 30;

export function generateRefreshToken() {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString("hex");

    return {
        token,
        tokenHash: hashRefreshToken(token),
        expiresAt: new Date(
            Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
        ),
    };
}

export function hashRefreshToken(token: string) {
    return createHash("sha256")
        .update(token)
        .digest("hex");
}