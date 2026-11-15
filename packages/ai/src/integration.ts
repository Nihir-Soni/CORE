import { randomUUID } from "node:crypto";
import { type PrismaClient, ChunkEmbeddingRepository, type WorkspaceContext, withWorkspaceContext } from "@core/database";
import type { AIProvider } from "./types.js";
import { serializeVector } from "./pgvector.js";

export type EmbeddableChunk = {
  id: string;
  content: string;
  chunkIndex: number;
  workspaceId?: string;
};

/**
 * Sequentially embeds a list of chunks and persists them to the chunk_embeddings table.
 * Processing is done in ascending order of chunkIndex to remain deterministic.
 * Utilizes ChunkEmbeddingRepository when workspace context is provided.
 * 
 * @param chunks The array of chunks to embed. Must contain id, content, and chunkIndex.
 * @param provider The AI Provider used to generate embeddings.
 * @param prisma The Prisma client instance for database operations.
 * @param ctx Optional WorkspaceContext for workspace-isolated persistence.
 */
export async function embedChunks(
  chunks: EmbeddableChunk[],
  provider: AIProvider,
  prisma: PrismaClient,
  ctx?: WorkspaceContext
): Promise<void> {
  // Sort chunks deterministically by chunkIndex ascending
  const sortedChunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

  for (const chunk of sortedChunks) {
    // 1. Request the embedding from the provider
    const vector = await provider.embed(chunk.content);

    // 2. Serialize to pgvector format
    const serialized = serializeVector(vector);

    // 3. Persist via repository if workspace context is supplied
    const effectiveWsId = ctx?.workspaceId || chunk.workspaceId;
    if (effectiveWsId) {
      await ChunkEmbeddingRepository.upsert({ workspaceId: effectiveWsId }, chunk.id, serialized);
      continue;
    }

    // Fallback for raw queries without workspace context
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO chunk_embeddings (id, "chunkId", embedding)
      VALUES ($1, $2, $3::vector)
      ON CONFLICT ("chunkId") DO UPDATE SET embedding = EXCLUDED.embedding
      `,
      id,
      chunk.id,
      serialized
    );
  }
}
