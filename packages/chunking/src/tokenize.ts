/**
 * Approximate token counting.
 *
 * Strategy: Math.ceil(characters / 4)
 *
 * This is an intentional approximation, not a real tokenizer.
 * The ratio of ~4 characters per token is a well-known heuristic for
 * English-language text processed by sub-word tokenizers (GPT, Gemini, etc.).
 * It will be inaccurate for non-Latin scripts, dense code, or punctuation-
 * heavy content — but is sufficient for the Phase 4.2 chunk-size heuristic.
 *
 * This function is deliberately isolated here so it can be replaced with a
 * real tokenizer (e.g. tiktoken, sentencepiece) in a later phase without
 * touching the chunking algorithm.
 *
 * IMPORTANT: Never present this value as an exact count.
 */
export function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
