import type { Citation, SearchResult } from "./search.js";

export type RagContextOptions = {
  maxTokens?: number;
  tokenizer?: (text: string) => number;
};

export type RagContext = {
  text: string;
  sources: Citation[];
  totalTokens: number;
  maxTokens: number;
  includedCount: number;
  totalCandidates: number;
  isTruncated: boolean;
};

/**
 * Estimates token count for text using character/word heuristics if no custom tokenizer is provided.
 * Standard heuristic: ~4 characters per token.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Constructs a token-budgeted text context for an LLM from retrieved search results.
 * 
 * 1. Iterates through search results in order of relevance score.
 * 2. Formats each source block with deterministic tags ([source:N], Document, Page).
 * 3. Enforces strict maxTokens budgeting so total context tokens stay within budget.
 * 4. Omits low-ranking candidates if including them would exceed maxTokens.
 * 
 * @param results The retrieved SearchResults ordered by similarity/rerank score.
 * @param options Optional maxTokens budget (default: 4000) and tokenizer function.
 * @returns A RagContext containing formatted text, included sources, token metrics, and truncation flag.
 */
export function buildRagContext(
  results: SearchResult[],
  options?: RagContextOptions
): RagContext {
  const maxTokens = options?.maxTokens && options.maxTokens > 0 ? options.maxTokens : 4000;
  const tokenizer = options?.tokenizer ?? estimateTokens;

  if (!results || results.length === 0) {
    return {
      text: "No context available.",
      sources: [],
      totalTokens: 0,
      maxTokens,
      includedCount: 0,
      totalCandidates: 0,
      isTruncated: false,
    };
  }

  const sources: Citation[] = [];
  const textBlocks: string[] = [];
  let currentTokens = 0;
  let isTruncated = false;

  const totalCandidates = results.length;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const sourceId = sources.length + 1;
    const pageLine = result.pageNumber !== null ? `\nPage: ${result.pageNumber}` : "";

    const block = `[source:${sourceId}]
Document: ${result.filename}${pageLine}

${result.content}`;

    const blockTokens = tokenizer(block);
    const separatorOverhead = textBlocks.length > 0 ? tokenizer("\n\n---\n\n") : 0;
    const totalNewTokens = blockTokens + separatorOverhead;

    if (currentTokens + totalNewTokens <= maxTokens) {
      textBlocks.push(block);
      sources.push(result);
      currentTokens += totalNewTokens;
    } else {
      isTruncated = true;
      break;
    }
  }

  const text = textBlocks.length > 0 ? textBlocks.join("\n\n---\n\n") : "No context available.";

  return {
    text,
    sources,
    totalTokens: currentTokens,
    maxTokens,
    includedCount: sources.length,
    totalCandidates,
    isTruncated,
  };
}
