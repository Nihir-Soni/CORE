import { prisma, type Prisma } from "@core/database";

import { generateRefreshToken, hashRefreshToken } from "./refreshToken.ts";

export async function createRefreshToken(
    userId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
) {
    const generated = generateRefreshToken();

    await db.refreshToken.create({
        data: {
            userId,
            tokenHash: generated.tokenHash,
            expiresAt: generated.expiresAt,
        },
    });

    return generated.token;
}


export async function findRefreshToken(token: string) {
    const tokenHash = hashRefreshToken(token);

    return prisma.refreshToken.findUnique({
        where: {
            tokenHash,
        },
    });
}