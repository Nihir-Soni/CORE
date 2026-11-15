import { withWorkspaceContext } from "../client.ts";
import type { WorkspaceContext } from "../workspaceContext.ts";
import type { Chunk, Prisma } from "../generated/prisma/client.ts";

export interface CreateChunkInput {
  documentId: string;
  content: string;
  pageNumber?: number | null;
  chunkIndex: number;
  tokenCount: number;
}

export class ChunkRepository {
  private static async run<T>(
    ctx: WorkspaceContext,
    fn: (db: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    if (ctx.db) {
      return fn(ctx.db);
    }
    return withWorkspaceContext(ctx.workspaceId, (db) => fn(db));
  }

  /**
   * Creates a chunk, enforcing workspace ownership.
   */
  static async create(ctx: WorkspaceContext, data: CreateChunkInput): Promise<Chunk> {
    return this.run(ctx, (db) =>
      db.chunk.create({
        data: {
          workspaceId: ctx.workspaceId,
          documentId: data.documentId,
          content: data.content,
          pageNumber: data.pageNumber ?? null,
          chunkIndex: data.chunkIndex,
          tokenCount: data.tokenCount,
        },
      })
    );
  }

  /**
   * Finds chunks for a document within the workspace context.
   */
  static async findByDocumentId(
    ctx: WorkspaceContext,
    documentId: string
  ): Promise<Chunk[]> {
    return this.run(ctx, (db) =>
      db.chunk.findMany({
        where: {
          documentId,
          workspaceId: ctx.workspaceId,
        },
        orderBy: { chunkIndex: "asc" },
      })
    );
  }

  /**
   * Deletes all chunks for a document within the workspace context.
   */
  static async deleteByDocumentId(
    ctx: WorkspaceContext,
    documentId: string
  ): Promise<number> {
    return this.run(ctx, async (db) => {
      const result = await db.chunk.deleteMany({
        where: {
          documentId,
          workspaceId: ctx.workspaceId,
        },
      });
      return result.count;
    });
  }

  /**
   * Counts chunks within the workspace context.
   */
  static async count(
    ctx: WorkspaceContext,
    documentId?: string
  ): Promise<number> {
    return this.run(ctx, (db) =>
      db.chunk.count({
        where: {
          workspaceId: ctx.workspaceId,
          ...(documentId ? { documentId } : {}),
        },
      })
    );
  }
}
