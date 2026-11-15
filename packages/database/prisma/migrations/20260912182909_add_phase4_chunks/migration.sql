-- Phase 4.1: Enable pgvector extension, create Chunk and ChunkEmbedding tables

-- Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable: chunks
CREATE TABLE "chunks" (
    "id"          TEXT        NOT NULL,
    "documentId"  TEXT        NOT NULL,
    "workspaceId" TEXT        NOT NULL,
    "content"     TEXT        NOT NULL,
    "pageNumber"  INTEGER,
    "chunkIndex"  INTEGER     NOT NULL,
    "tokenCount"  INTEGER     NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable: chunk_embeddings
-- embedding column uses pgvector native type vector(768)
-- Model: gemini-embedding-001 with outputDimensionality=768 (L2-normalised before storage)
CREATE TABLE "chunk_embeddings" (
    "id"        TEXT    NOT NULL,
    "chunkId"   TEXT    NOT NULL,
    "embedding" vector(768) NOT NULL,

    CONSTRAINT "chunk_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: chunks.documentId
CREATE INDEX "chunks_documentId_idx" ON "chunks"("documentId");

-- CreateIndex: chunks.workspaceId
CREATE INDEX "chunks_workspaceId_idx" ON "chunks"("workspaceId");

-- CreateIndex: unique (documentId, chunkIndex) — idempotency for repeated indexing
CREATE UNIQUE INDEX "chunks_documentId_chunkIndex_key" ON "chunks"("documentId", "chunkIndex");

-- CreateIndex: chunk_embeddings.chunkId — unique (one embedding per chunk)
CREATE UNIQUE INDEX "chunk_embeddings_chunkId_key" ON "chunk_embeddings"("chunkId");

-- CreateIndex: IVFFlat ANN index on embedding (lists=100, operator=vector_cosine_ops)
-- Placeholder for Phase 4.2+ retrieval; requires at least one row to query effectively.
-- Phase 4.1 only creates the index structure; no data is inserted here.
CREATE INDEX "chunk_embeddings_embedding_ivfflat_idx"
    ON "chunk_embeddings"
    USING ivfflat ("embedding" vector_cosine_ops)
    WITH (lists = 100);

-- AddForeignKey: chunks → documents
ALTER TABLE "chunks"
    ADD CONSTRAINT "chunks_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: chunks → workspaces
ALTER TABLE "chunks"
    ADD CONSTRAINT "chunks_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: chunk_embeddings → chunks
ALTER TABLE "chunk_embeddings"
    ADD CONSTRAINT "chunk_embeddings_chunkId_fkey"
    FOREIGN KEY ("chunkId") REFERENCES "chunks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
