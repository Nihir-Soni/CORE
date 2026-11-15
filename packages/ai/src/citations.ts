import type { Citation } from "./search.js";

/**
 * Parses an LLM answer for source references and maps them back to the original citations.
 * 
 * Supports the `[source:N]` format.
 * Deduplicates citations while preserving first-seen order.
 * Safely ignores invalid or out-of-bounds source indices.
 * 
 * @param answer The generated text from the LLM.
 * @param providedSources The deterministic list of sources originally provided to the LLM.
 * @returns An ordered, deduplicated array of mapped Citations.
 */
export function mapCitations(answer: string, providedSources: Citation[]): Citation[] {
  const citations: Citation[] = [];
  const seenIndices = new Set<number>();
  
  // Find all instances of [source:N] (case insensitive)
  const regex = /\[source:(\d+)\]/gi;
  let match;
  
  while ((match = regex.exec(answer)) !== null) {
    const sourceIndex = parseInt(match[1], 10);
    
    // Validate source index (1-based index)
    if (sourceIndex >= 1 && sourceIndex <= providedSources.length) {
      if (!seenIndices.has(sourceIndex)) {
        seenIndices.add(sourceIndex);
        citations.push(providedSources[sourceIndex - 1]);
      }
    }
  }
  
  return citations;
}
