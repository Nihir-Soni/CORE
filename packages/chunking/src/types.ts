/**
 * Shared types for the chunking engine.
 *
 * ChunkOptions controls chunking behaviour. All fields are optional;
 * callers may pass a partial object and defaults are applied in chunker.ts.
 *
 * Chunk is a pure value object produced by chunkDocument(). It contains
 * no database IDs — those are assigned by persistChunks().
 */

export interface ChunkOptions {
  /**
   * Soft upper bound on tokens per chunk.
   * A paragraph that would push the current chunk over this limit causes
   * the chunk to be emitted first (unless no content has been accumulated yet,
   * in which case the paragraph is force-split as a fallback).
   * Default: 700
   */
  targetTokens?: number;

  /**
   * Maximum tokens per chunk. A single paragraph larger than this value is
   * split character-by-character at this boundary (deterministic fallback).
   * Default: 900
   */
  maxTokens?: number;

  /**
   * Fraction of targetTokens to carry forward as overlap into the next chunk.
   * E.g. 0.125 means ~12.5% overlap.
   * Default: 0.125
   */
  overlapFraction?: number;
}

export interface Chunk {
  /** Zero-based position of this chunk within the document. */
  chunkIndex: number;

  /** Text content of this chunk. */
  content: string;

  /**
   * Approximate token count for this chunk.
   * Computed via Math.ceil(content.length / 4).
   * This is an approximation — not suitable for billing or strict limits.
   */
  tokenCount: number;

  /**
   * Page number this chunk originates from, if known.
   * Currently always null because DocumentContent does not carry per-page
   * boundaries. Will be populated in a future phase when page-level extraction
   * is available.
   */
  pageNumber: number | null;
}
