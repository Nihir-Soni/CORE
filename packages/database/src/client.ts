import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "./generated/prisma/client.ts";
import type { WorkspaceContext } from "./workspaceContext.ts";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new pg.Pool({
  connectionString,
  allowExitOnIdle: true,
  max: 20,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 10000,
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
});

export type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export async function disconnectDatabase() {
  await prisma.$disconnect();
}


export async function withWorkspaceContext<T>(
  workspaceId: string,
  callback: (db: Prisma.TransactionClient, ctx: WorkspaceContext) => Promise<T>,
): Promise<T> {
  if (!workspaceId) throw new Error("workspaceId is required");

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
      return callback(tx, { workspaceId, db: tx });
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
}
