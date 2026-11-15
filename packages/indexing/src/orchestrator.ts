import { type PrismaClient, DocumentRepository, DocumentContentRepository, withWorkspaceContext } from "@core/database";
import type { AIProvider, EmbeddableChunk } from "@core/ai";
import { chunkDocument } from "@core/chunking";
import { embedChunks } from "@core/ai";

export type IndexingResult =
  | { ok: true; chunksProcessed: number; embeddingsGenerated: number }
  | { ok: false; error: "document_not_found" | "wrong_workspace" | "content_missing" };

/**
 * Orchestrates the indexing of a document.
 * 
 * 1. Verifies ownership and existence of the Document and its extracted DocumentContent.
 * 2. Generates new chunks deterministically based on the extracted text.
 * 3. Reconciles existing chunks in the database with the newly generated chunks:
 *    - Unchanged chunks are retained.
 *    - Changed chunks are updated (and their old embeddings deleted).
 *    - New chunks are inserted.
 *    - Obsolete chunks are deleted.
 * 4. Generates and persists embeddings exclusively for the new/changed chunks.
 * 5. Updates the document status to READY.
 * 
 * @param documentId The ID of the document to index.
 * @param workspaceId The ID of the workspace that must own the document.
 * @param provider The AIProvider for generating vector embeddings.
 * @param prisma The PrismaClient instance.
 */
export async function indexDocument(
  documentId: string,
  workspaceId: string,
  provider: AIProvider,
  prisma: PrismaClient
): Promise<IndexingResult> {
  const ctx = { workspaceId };

  // 1. Verify Document
  const doc = await DocumentRepository.findById(ctx, documentId);

  if (!doc) {
    return { ok: false, error: "document_not_found" };
  }
  if (doc.workspaceId !== workspaceId) {
    return { ok: false, error: "wrong_workspace" };
  }

  // 2. Verify DocumentContent
  const content = await DocumentContentRepository.findByDocumentId(ctx, documentId);

  if (!content) {
    return { ok: false, error: "content_missing" };
  }

  // 3. Generate new chunks in-memory
  const newChunks = chunkDocument(content.text, {
    maxTokens: 500, // Matching defaults or could pass options
  });

  // 4. Reconcile Database Chunks inside a single transaction with workspace context
  const chunksToEmbed: EmbeddableChunk[] = [];
  
  await withWorkspaceContext(workspaceId, async (tx) => {
    const docCheck = await tx.document.findFirst({
      where: { id: documentId, workspaceId: doc.workspaceId, status: { not: "DELETING" } },
    });
    if (!docCheck) {
      return; // Document was deleted or marked DELETING, abort chunk generation
    }

    const existingChunks = await tx.chunk.findMany({
      where: { documentId, workspaceId: doc.workspaceId },
      orderBy: { chunkIndex: "asc" },
      include: { embedding: { select: { id: true } } },
    });

    for (let i = 0; i < newChunks.length; i++) {
      const newChunkData = newChunks[i];

      if (i < existingChunks.length) {
        const existing = existingChunks[i];

        if (existing.content === newChunkData.content) {
          if (existing.embedding) {
            // Unchanged and embedding exists: preserve entirely
            continue;
          } else {
            // Unchanged but missing embedding: queue for embedding
            chunksToEmbed.push({
              id: existing.id,
              content: existing.content,
              chunkIndex: existing.chunkIndex,
            });
          }
        } else {
          // Changed: update chunk and queue for embedding
          const updated = await tx.chunk.update({
            where: { id: existing.id },
            data: {
              content: newChunkData.content,
              tokenCount: newChunkData.tokenCount,
              pageNumber: newChunkData.pageNumber ?? null,
            },
          });
          
          // Delete old stale embedding to prevent returning bad data if provider fails later
          await tx.chunkEmbedding.deleteMany({
            where: { chunkId: existing.id },
          });

          chunksToEmbed.push({
            id: updated.id,
            content: updated.content,
            chunkIndex: updated.chunkIndex,
          });
        }
      } else {
        // New chunk
        const created = await tx.chunk.create({
          data: {
            documentId,
            workspaceId: doc.workspaceId, // strictly from verified document
            content: newChunkData.content,
            chunkIndex: newChunkData.chunkIndex,
            tokenCount: newChunkData.tokenCount,
            pageNumber: newChunkData.pageNumber ?? null,
          },
        });

        chunksToEmbed.push({
          id: created.id,
          content: created.content,
          chunkIndex: created.chunkIndex,
        });
      }
    }

    // Delete obsolete trailing chunks if new content is shorter than old content
    if (existingChunks.length > newChunks.length) {
      const obsoleteIds = existingChunks.slice(newChunks.length).map((c) => c.id);
      await tx.chunk.deleteMany({
        where: { id: { in: obsoleteIds } },
      });
      // Their chunk_embeddings delete automatically via ON DELETE CASCADE
    }
  });

  // 5. Generate and persist embeddings safely outside the DB transaction boundary
  console.log("CHUNKS TO EMBED:", chunksToEmbed.length);
  if (chunksToEmbed.length > 0) {
    await embedChunks(chunksToEmbed, provider, prisma, ctx);
  }

  // 6. Update Document Status (fails if document was marked DELETING)
  const updatedDoc = await DocumentRepository.update(ctx, documentId, { status: "READY" });
  if (!updatedDoc) {
    return { ok: false, error: "document_not_found" };
  }

  return { 
    ok: true, 
    chunksProcessed: newChunks.length, 
    embeddingsGenerated: chunksToEmbed.length 
  };
}
