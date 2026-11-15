import { type DatabaseClient, withWorkspaceContext, Prisma } from "@core/database";
import type { AIProvider } from "./types.js";
import { serializeVector } from "./pgvector.js";

export type SearchMode = "hybrid" | "vector" | "text";

export type SearchResult = {
  chunkId: string;
  documentId: string;
  workspaceId: string;
  filename: string;
  content: string;
  chunkIndex: number;
  pageNumber: number | null;
  tokenCount: number;
  similarity: number;
  score?: number;
  vectorScore?: number;
  textScore?: number;
};

export type Citation = SearchResult;

export type SearchOptions = {
  query: string;
  workspaceId: string;
  provider: AIProvider;
  prisma: DatabaseClient;
  topK?: number;
  mode?: SearchMode;
  vectorWeight?: number;
  textWeight?: number;
  rrfK?: number;
  documentIds?: string[];
};

/**
 * Searches for chunks similar to the provided natural language query using
 * vector search (pgvector), full-text BM25 search (PostgreSQL tsvector), or
 * hybrid search (Reciprocal Rank Fusion - RRF).
 * 
 * Multi-tenant workspace isolation is strictly enforced inside PostgreSQL SQL and under RLS.
 * 
 * @returns Ordered array of SearchResult, highest relevance score first.
 */
export async function searchHybridChunks({
  query,
  workspaceId,
  provider,
  prisma,
  topK = 10,
  mode = "hybrid",
  vectorWeight = 1.0,
  textWeight = 1.0,
  rrfK = 60,
  documentIds,
}: SearchOptions): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return [];
  }

  const boundedTopK = Math.max(1, Math.min(Math.floor(topK), 50));
  const candidateLimit = Math.max(boundedTopK * 3, 30);

  const docFilter =
    documentIds && documentIds.length > 0
      ? Prisma.sql`AND c."documentId" IN (${Prisma.join(documentIds)})`
      : Prisma.empty;

  if (mode === "text") {
    // Pure Full-Text Search (BM25 rank)
    const rawResults = await withWorkspaceContext(workspaceId, async (db) => {
      return db.$queryRaw<
        Array<{
          chunkId: string;
          documentId: string;
          workspaceId: string;
          filename: string;
          content: string;
          chunkIndex: number;
          pageNumber: number | null;
          tokenCount: number;
          similarity: number;
          score: number;
          textScore: number;
        }>
      >`
        SELECT
          c.id AS "chunkId",
          c."documentId",
          c."workspaceId",
          d.filename,
          c.content,
          c."chunkIndex",
          c."pageNumber",
          c."tokenCount",
          0.0 AS similarity,
          ts_rank_cd(to_tsvector('english', c.content), websearch_to_tsquery('english', ${trimmedQuery})) AS score,
          ts_rank_cd(to_tsvector('english', c.content), websearch_to_tsquery('english', ${trimmedQuery})) AS "textScore"
        FROM chunks c
        JOIN "Document" d ON d.id = c."documentId"
        WHERE c."workspaceId" = ${workspaceId}
          AND d."workspaceId" = ${workspaceId}
          AND d.status::text = 'READY'
          ${docFilter}
          AND to_tsvector('english', c.content) @@ websearch_to_tsquery('english', ${trimmedQuery})
        ORDER BY score DESC
        LIMIT ${boundedTopK};
      `;
    });

    return rawResults.map((r) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      workspaceId: r.workspaceId,
      filename: r.filename,
      content: r.content,
      chunkIndex: r.chunkIndex,
      pageNumber: r.pageNumber,
      tokenCount: r.tokenCount,
      similarity: 0,
      score: typeof r.score === 'number' ? r.score : parseFloat(r.score as unknown as string),
      textScore: typeof r.textScore === 'number' ? r.textScore : parseFloat(r.textScore as unknown as string),
    }));
  }

  // Generate vector embedding for vector or hybrid mode
  const queryVector = await provider.embed(trimmedQuery);
  const serializedVector = serializeVector(queryVector);

  if (mode === "vector") {
    // Pure Vector Search (Cosine Similarity)
    const rawResults = await withWorkspaceContext(workspaceId, async (db) => {
      return db.$queryRaw<
        Array<{
          chunkId: string;
          documentId: string;
          workspaceId: string;
          filename: string;
          content: string;
          chunkIndex: number;
          pageNumber: number | null;
          tokenCount: number;
          similarity: number;
        }>
      >`
        SELECT
          c.id AS "chunkId",
          c."documentId",
          c."workspaceId",
          d.filename,
          c.content,
          c."chunkIndex",
          c."pageNumber",
          c."tokenCount",
          1 - (ce.embedding <=> ${serializedVector}::vector) AS similarity
        FROM chunk_embeddings ce
        JOIN chunks c ON c.id = ce."chunkId"
        JOIN "Document" d ON d.id = c."documentId"
        WHERE c."workspaceId" = ${workspaceId}
          AND d."workspaceId" = ${workspaceId}
          AND d.status::text = 'READY'
          ${docFilter}
        ORDER BY ce.embedding <=> ${serializedVector}::vector ASC
        LIMIT ${boundedTopK};
      `;
    });

    return rawResults.map((r) => {
      const sim = typeof r.similarity === 'number' ? r.similarity : parseFloat(r.similarity as unknown as string);
      return {
        chunkId: r.chunkId,
        documentId: r.documentId,
        workspaceId: r.workspaceId,
        filename: r.filename,
        content: r.content,
        chunkIndex: r.chunkIndex,
        pageNumber: r.pageNumber,
        tokenCount: r.tokenCount,
        similarity: sim,
        score: sim,
        vectorScore: sim,
      };
    });
  }

  // Hybrid Mode (Vector + Full-Text Search via CTE & Reciprocal Rank Fusion)
  const rawResults = await withWorkspaceContext(workspaceId, async (db) => {
    return db.$queryRaw<
      Array<{
        chunkId: string;
        documentId: string;
        workspaceId: string;
        filename: string;
        content: string;
        chunkIndex: number;
        pageNumber: number | null;
        tokenCount: number;
        similarity: number;
        vectorScore: number;
        textScore: number;
        score: number;
      }>
    >`
      WITH vector_matches AS (
        SELECT
          c.id AS "chunkId",
          c."documentId",
          c."workspaceId",
          d.filename,
          c.content,
          c."chunkIndex",
          c."pageNumber",
          c."tokenCount",
          1 - (ce.embedding <=> ${serializedVector}::vector) AS similarity,
          ROW_NUMBER() OVER (ORDER BY ce.embedding <=> ${serializedVector}::vector ASC) AS vec_rank
        FROM chunk_embeddings ce
        JOIN chunks c ON c.id = ce."chunkId"
        JOIN "Document" d ON d.id = c."documentId"
        WHERE c."workspaceId" = ${workspaceId}
          AND d."workspaceId" = ${workspaceId}
          AND d.status::text = 'READY'
          ${docFilter}
        LIMIT ${candidateLimit}
      ),
      text_matches AS (
        SELECT
          c.id AS "chunkId",
          c."documentId",
          c."workspaceId",
          d.filename,
          c.content,
          c."chunkIndex",
          c."pageNumber",
          c."tokenCount",
          ts_rank_cd(to_tsvector('english', c.content), websearch_to_tsquery('english', ${trimmedQuery})) AS text_rank_score,
          ROW_NUMBER() OVER (ORDER BY ts_rank_cd(to_tsvector('english', c.content), websearch_to_tsquery('english', ${trimmedQuery})) DESC) AS text_rank
        FROM chunks c
        JOIN "Document" d ON d.id = c."documentId"
        WHERE c."workspaceId" = ${workspaceId}
          AND d."workspaceId" = ${workspaceId}
          AND d.status::text = 'READY'
          ${docFilter}
          AND to_tsvector('english', c.content) @@ websearch_to_tsquery('english', ${trimmedQuery})
        LIMIT ${candidateLimit}
      ),
      combined AS (
        SELECT
          COALESCE(v."chunkId", t."chunkId") AS "chunkId",
          COALESCE(v."documentId", t."documentId") AS "documentId",
          COALESCE(v."workspaceId", t."workspaceId") AS "workspaceId",
          COALESCE(v.filename, t.filename) AS filename,
          COALESCE(v.content, t.content) AS content,
          COALESCE(v."chunkIndex", t."chunkIndex") AS "chunkIndex",
          COALESCE(v."pageNumber", t."pageNumber") AS "pageNumber",
          COALESCE(v."tokenCount", t."tokenCount") AS "tokenCount",
          COALESCE(v.similarity, 0.0) AS similarity,
          COALESCE(v.similarity, 0.0) AS "vectorScore",
          COALESCE(t.text_rank_score, 0.0) AS "textScore",
          (
            COALESCE(${vectorWeight}::float8 / (${rrfK}::float8 + v.vec_rank::float8), 0.0::float8) +
            COALESCE(${textWeight}::float8 / (${rrfK}::float8 + t.text_rank::float8), 0.0::float8)
          ) AS score
        FROM vector_matches v
        FULL OUTER JOIN text_matches t ON v."chunkId" = t."chunkId"
      )
      SELECT * FROM combined
      ORDER BY score DESC
      LIMIT ${boundedTopK};
    `;
  });

  return rawResults.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    workspaceId: r.workspaceId,
    filename: r.filename,
    content: r.content,
    chunkIndex: r.chunkIndex,
    pageNumber: r.pageNumber,
    tokenCount: r.tokenCount,
    similarity: typeof r.similarity === 'number' ? r.similarity : parseFloat(r.similarity as unknown as string),
    vectorScore: typeof r.vectorScore === 'number' ? r.vectorScore : parseFloat(r.vectorScore as unknown as string),
    textScore: typeof r.textScore === 'number' ? r.textScore : parseFloat(r.textScore as unknown as string),
    score: typeof r.score === 'number' ? r.score : parseFloat(r.score as unknown as string),
  }));
}

/**
 * Backward-compatible searchSimilarChunks signature.
 * Delegates to searchHybridChunks.
 */
export async function searchSimilarChunks(
  options: SearchOptions
): Promise<SearchResult[]> {
  const mode = options.mode ?? "vector";
  return searchHybridChunks({ ...options, mode });
}
