/**
 * Paragraph-aware text chunking algorithm.
 *
 * Strategy
 * --------
 * 1. Normalize the input text (collapse whitespace, normalize line endings).
 * 2. Split into paragraphs on double-newlines.
 * 3. Accumulate paragraphs until the running token count reaches targetTokens.
 * 4. Emit the accumulated text as a chunk.
 * 5. Carry back an overlap tail (overlapFraction * targetTokens tokens worth of
 *    content) into the next chunk's starting buffer. The tail is computed by
 *    walking paragraphs from the end of the just-emitted chunk until we reach
 *    the overlap token budget, so overlap boundaries align with paragraph ends
 *    wherever possible.
 * 6. Repeat until all paragraphs are consumed.
 * 7. Emit a final chunk with any remaining content (even if below target size).
 *
 * Fallback for oversized paragraphs
 * ----------------------------------
 * If a single paragraph exceeds maxTokens on its own, it is split into
 * character-aligned slices of maxTokens * 4 characters each (since
 * approximateTokens ≈ chars/4). Each slice is treated as a synthetic paragraph
 * and fed back through the same accumulation logic. This is deterministic.
 *
 * Overlap
 * -------
 * The overlap tail is computed in characters (overlapFraction * targetTokens * 4)
 * rounded to the nearest paragraph boundary where possible. This means:
 *  - For normal text: neighboring chunks share whole paragraphs at the boundary.
 *  - For force-split large paragraphs: the overlap is a character-aligned suffix.
 *
 * Determinism
 * -----------
 * The algorithm is purely functional: same text + same options → same chunks.
 * No random IDs, timestamps, or external state.
 */

import { normalizeText, splitParagraphs } from "./normalize.js";
import { approximateTokens } from "./tokenize.js";
import type { Chunk, ChunkOptions } from "./types.js";

const DEFAULT_TARGET_TOKENS = 700;
const DEFAULT_MAX_TOKENS = 900;
const DEFAULT_OVERLAP_FRACTION = 0.125;

/** Resolved, fully-specified options after applying defaults. */
interface ResolvedOptions {
  targetTokens: number;
  maxTokens: number;
  overlapFraction: number;
}

function resolveOptions(opts: ChunkOptions = {}): ResolvedOptions {
  return {
    targetTokens: opts.targetTokens ?? DEFAULT_TARGET_TOKENS,
    maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    overlapFraction: opts.overlapFraction ?? DEFAULT_OVERLAP_FRACTION,
  };
}

/**
 * Split a single paragraph that is larger than maxTokens into smaller pieces.
 * Slices are aligned to maxTokens * 4 characters so they respect the
 * approximate token budget. Returns one or more non-empty strings.
 */
function splitLargeParagraph(para: string, maxTokens: number): string[] {
  const maxChars = maxTokens * 4;
  const pieces: string[] = [];
  let offset = 0;
  while (offset < para.length) {
    const slice = para.slice(offset, offset + maxChars).trim();
    if (slice.length > 0) {
      pieces.push(slice);
    }
    offset += maxChars;
  }
  return pieces;
}

/**
 * Given the paragraphs that form a chunk, compute the overlap tail:
 * walk paragraphs from the end, accumulate character count, stop when
 * the accumulated characters reach the overlap character budget.
 * Returns the tail paragraphs as a pre-loaded buffer for the next chunk.
 */
function computeOverlapTail(
  paragraphs: string[],
  overlapCharBudget: number
): string[] {
  if (overlapCharBudget <= 0 || paragraphs.length === 0) {
    return [];
  }
  const tail: string[] = [];
  let accumulated = 0;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const para = paragraphs[i];
    // +1 for the newline separator between paragraphs
    accumulated += para.length + 1;
    tail.unshift(para);
    if (accumulated >= overlapCharBudget) {
      break;
    }
  }
  return tail;
}

/**
 * Produce ordered Chunk objects from the given text.
 *
 * @param text    Raw extracted text (may be un-normalized).
 * @param options Chunking parameters. Defaults are applied for omitted fields.
 * @returns       Ordered array of Chunk objects with sequential chunkIndex
 *                starting at 0. Returns [] for empty/whitespace-only input.
 */
export function chunkDocument(text: string, options: ChunkOptions = {}): Chunk[] {
  const opts = resolveOptions(options);
  const normalized = normalizeText(text);

  if (normalized.length === 0) {
    return [];
  }

  // Split into paragraphs, then expand any paragraph that exceeds maxTokens.
  const rawParagraphs = splitParagraphs(normalized);
  const paragraphs: string[] = [];
  for (const para of rawParagraphs) {
    if (approximateTokens(para) > opts.maxTokens) {
      paragraphs.push(...splitLargeParagraph(para, opts.maxTokens));
    } else {
      paragraphs.push(para);
    }
  }

  if (paragraphs.length === 0) {
    return [];
  }

  const overlapCharBudget = Math.ceil(
    opts.targetTokens * opts.overlapFraction * 4
  );

  const chunks: Chunk[] = [];
  // currentBuffer holds the paragraphs accumulated so far for the next chunk.
  let currentBuffer: string[] = [];
  let currentTokens = 0;
  // Track paragraphs in the last emitted chunk to compute overlap.
  let lastChunkParagraphs: string[] = [];

  function emitChunk(bufferParagraphs: string[]): void {
    const content = bufferParagraphs.join("\n\n");
    if (content.length === 0) return;

    chunks.push({
      chunkIndex: chunks.length,
      content,
      tokenCount: approximateTokens(content),
      pageNumber: null,
    });
    lastChunkParagraphs = bufferParagraphs;
  }

  for (const para of paragraphs) {
    const paraTokens = approximateTokens(para);

    if (currentTokens + paraTokens > opts.targetTokens && currentBuffer.length > 0) {
      // Emit the current buffer as a chunk.
      emitChunk(currentBuffer);

      // Compute the overlap tail from the emitted chunk's paragraphs.
      const overlapTail = computeOverlapTail(lastChunkParagraphs, overlapCharBudget);

      // Start the new buffer with the overlap tail.
      currentBuffer = [...overlapTail];
      currentTokens = currentBuffer.reduce(
        (sum, p) => sum + approximateTokens(p),
        0
      );
    }

    currentBuffer.push(para);
    currentTokens += paraTokens;
  }

  // Emit whatever remains.
  if (currentBuffer.length > 0) {
    emitChunk(currentBuffer);
  }

  return chunks;
}
