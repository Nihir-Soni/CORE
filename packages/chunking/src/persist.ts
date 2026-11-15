/**
 * Chunk persistence layer.
 *
 * persistChunks() is the single operation that takes generated Chunk objects
 * and writes them to the database.
 *
 * Ownership verification
 * ----------------------
 * Before writing, this function:
 *  1. Fetches the Document by documentId, asserting it belongs to workspaceId.
 *     Returns a structured error if not found or if workspaceId is wrong.
 *  2. Asserts that a DocumentContent row exists for the document.
 *     Chunking requires extracted text; if content is missing, it returns an error.
 *
 * The workspaceId written to each chunk row is always taken from the verified
 * Document — never from the caller's argument alone — preventing accidental
 * cross-workspace writes.
 *
 * Idempotency
 * -----------
 * All writes happen inside a Prisma interactive transaction:
 *  1. DELETE all existing chunks for this documentId (cascades to chunk_embeddings
 *     via FK, which is safe at Phase 4.2 because embeddings are not yet written).
 *  2. INSERT the new chunks via createMany.
 *
 * This guarantees UNIQUE(documentId, chunkIndex) is never violated by re-runs.
 * It is safe at Phase 4.2 because no embeddings exist yet. Phase 4.3+ must
 * revisit this strategy to preserve or re-generate embeddings during re-indexing.
 *
 * Return value
 * ------------
 * Returns either a success payload or a typed error. Does NOT throw on
 * expected failures (document not found, content missing). Does let
 * unexpected database errors propagate as exceptions.
 */

import { type PrismaClient, DocumentRepository, DocumentContentRepository, ChunkRepository } from "@core/database";
import type { Chunk } from "./types.js";

export type PersistResult =
  | { ok: true; chunkCount: number }
  | { ok: false; error: "document_not_found" | "wrong_workspace" | "content_missing" };

export async function persistChunks(
  prisma: PrismaClient,
  documentId: string,
  workspaceId: string,
  chunks: Chunk[]
): Promise<PersistResult> {
  const ctx = { workspaceId };

  // 1. Verify document exists and belongs to the given workspace.
  const doc = await DocumentRepository.findById(ctx, documentId);

  if (!doc) {
    return { ok: false, error: "document_not_found" };
  }

  if (doc.workspaceId !== workspaceId) {
    return { ok: false, error: "wrong_workspace" };
  }

  // 2. Verify DocumentContent exists.
  const content = await DocumentContentRepository.findByDocumentId(ctx, documentId);

  if (!content) {
    return { ok: false, error: "content_missing" };
  }

  // 3. Persist atomically: delete old chunks, insert new ones.
  if (chunks.length === 0) {
    // No chunks to write — delete any stale rows and return.
    await ChunkRepository.deleteByDocumentId(ctx, documentId);
    return { ok: true, chunkCount: 0 };
  }

  await prisma.$transaction(async (tx) => {
    // Delete existing chunks (cascade will remove chunk_embeddings too).
    await tx.chunk.deleteMany({
      where: { documentId, workspaceId: doc.workspaceId },
    });

    // Insert new chunks. workspaceId is always taken from the verified document.
    await tx.chunk.createMany({
      data: chunks.map((c) => ({
        documentId,
        workspaceId: doc.workspaceId,
        content: c.content,
        chunkIndex: c.chunkIndex,
        tokenCount: c.tokenCount,
        pageNumber: c.pageNumber ?? null,
      })),
    });
  });

  return { ok: true, chunkCount: chunks.length };
}
