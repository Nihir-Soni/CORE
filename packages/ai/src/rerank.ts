import type { SearchResult } from "./search.js";

export type RerankResult = SearchResult & {
  rerankScore: number;
  rankReason?: string;
};

export interface Reranker {
  rerank(query: string, candidates: SearchResult[]): Promise<RerankResult[]>;
}

/**
 * Default hybrid semantic reranker.
 * 
 * Re-evaluates candidate chunks using a multi-signal scoring model:
 * 1. Exact query term density & frequency in chunk content and filename.
 * 2. Exact phrase match boost.
 * 3. Base vector similarity score.
 * 4. Text BM25 rank score.
 * 5. Position tie-breaking penalty (favors earlier chunks).
 */
export class DefaultReranker implements Reranker {
  async rerank(query: string, candidates: SearchResult[]): Promise<RerankResult[]> {
    if (!candidates || candidates.length === 0) {
      return [];
    }

    const normalizedQuery = query.toLowerCase().trim();
    const queryTerms = Array.from(
      new Set(normalizedQuery.split(/\s+/).filter((t) => t.length > 1))
    );

    const scored = candidates.map((candidate) => {
      const contentLower = candidate.content.toLowerCase();
      const filenameLower = candidate.filename.toLowerCase();

      // 1. Exact phrase match boost
      const exactPhraseMatch = normalizedQuery.length > 2 && contentLower.includes(normalizedQuery);
      const exactPhraseScore = exactPhraseMatch ? 1.0 : 0.0;

      // 2. Term coverage ratio (what fraction of query terms appear in content or filename)
      let matchedTerms = 0;
      let totalTermHits = 0;

      for (const term of queryTerms) {
        if (contentLower.includes(term) || filenameLower.includes(term)) {
          matchedTerms++;
          const occurrences = (contentLower.match(new RegExp(escapeRegExp(term), "g")) || []).length;
          totalTermHits += occurrences;
        }
      }

      const termCoverageScore = queryTerms.length > 0 ? matchedTerms / queryTerms.length : 0.0;
      const termFrequencyScore = Math.min(totalTermHits / 10, 1.0);

      // 3. Base similarity score (vector or score)
      const baseSimilarity = Math.max(0, Math.min(candidate.similarity ?? candidate.score ?? 0, 1.0));
      const baseTextScore = Math.min(candidate.textScore ?? 0, 1.0);

      // 4. Filename term match boost
      const filenameMatch = queryTerms.some((t) => filenameLower.includes(t));
      const filenameScore = filenameMatch ? 0.5 : 0.0;

      // 5. Chunk index tie-breaker (slight preference for earlier chunks in document)
      const positionScore = Math.max(0, 1.0 - candidate.chunkIndex * 0.01);

      // Combined Rerank Score
      const rerankScore =
        termCoverageScore * 0.35 +
        baseSimilarity * 0.30 +
        exactPhraseScore * 0.15 +
        termFrequencyScore * 0.10 +
        filenameScore * 0.08 +
        baseTextScore * 0.02;

      return {
        ...candidate,
        rerankScore: parseFloat(rerankScore.toFixed(6)),
        rankReason: exactPhraseMatch
          ? "Exact phrase match"
          : termCoverageScore > 0.5
          ? "High term coverage"
          : "Vector similarity",
      };
    });

    // Sort descending by rerankScore
    return scored.sort((a, b) => b.rerankScore - a.rerankScore);
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convenience function to rerank search results using the default or custom reranker.
 */
export async function rerankSearchResults(
  query: string,
  candidates: SearchResult[],
  options?: { reranker?: Reranker; topK?: number }
): Promise<RerankResult[]> {
  if (!candidates || candidates.length === 0) {
    return [];
  }
  const reranker = options?.reranker ?? new DefaultReranker();
  const reranked = await reranker.rerank(query, candidates);
  const topK = options?.topK ? Math.max(1, Math.floor(options.topK)) : reranked.length;
  return reranked.slice(0, topK);
}
