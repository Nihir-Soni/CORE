import { withWorkspaceContext } from "../client.ts";
import type { WorkspaceContext } from "../workspaceContext.ts";
import type { ChunkEmbedding, Prisma } from "../generated/prisma/client.ts";

export class ChunkEmbeddingRepository {
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
   * Finds a ChunkEmbedding by chunkId, joining against Chunk to verify workspace ownership in the query.
   */
  static async findByChunkId(
    ctx: WorkspaceContext,
    chunkId: string
  ): Promise<ChunkEmbedding | null> {
    return this.run(ctx, (db) =>
      db.chunkEmbedding.findFirst({
        where: {
          chunkId,
          chunk: {
            workspaceId: ctx.workspaceId,
          },
        },
      })
    );
  }

  /**
   * Upserts a pgvector ChunkEmbedding using $executeRaw, verifying Chunk workspace ownership in the DB query.
   * Returns true on success, false if chunk is not found or belongs to another workspace.
   */
  static async upsert(
    ctx: WorkspaceContext,
    chunkId: string,
    embeddingHex: string
  ): Promise<boolean> {
    return this.run(ctx, async (db) => {
      // 1. Verify chunk workspace ownership in DB
      const chunk = await db.chunk.findFirst({
        where: {
          id: chunkId,
          workspaceId: ctx.workspaceId,
        },
      });

      if (!chunk) return false;

      // 2. Perform raw vector upsert using transaction client
      const count = await db.$executeRaw`
        INSERT INTO chunk_embeddings (id, "chunkId", embedding)
        VALUES (gen_random_uuid(), ${chunkId}, ${embeddingHex}::vector)
        ON CONFLICT ("chunkId")
        DO UPDATE SET embedding = ${embeddingHex}::vector;
      `;

      return count > 0;
    });
  }

  /**
   * Counts chunk embeddings for a document within the workspace context.
   */
  static async countByDocumentId(
    ctx: WorkspaceContext,
    documentId: string
  ): Promise<number> {
    return this.run(ctx, (db) =>
      db.chunkEmbedding.count({
        where: {
          chunk: {
            documentId,
            workspaceId: ctx.workspaceId,
          },
        },
      })
    );
  }
}
