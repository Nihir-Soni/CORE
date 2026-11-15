import type { Prisma } from "./generated/prisma/client.ts";

export interface WorkspaceContext {
  workspaceId: string;
  db?: Prisma.TransactionClient;
}
