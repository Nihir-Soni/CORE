/**
 * @core/chunking — public API
 *
 * Pure chunking:
 *   chunkDocument(text, options?) → Chunk[]
 *
 * Persistence:
 *   persistChunks(prisma, documentId, workspaceId, chunks) → PersistResult
 *
 * Utilities (exported for testing and diagnostics):
 *   normalizeText, splitParagraphs, approximateTokens
 */

export { chunkDocument } from "./chunker.js";
export { persistChunks } from "./persist.js";
export { normalizeText, splitParagraphs } from "./normalize.js";
export { approximateTokens } from "./tokenize.js";
export type { Chunk, ChunkOptions } from "./types.js";
export type { PersistResult } from "./persist.js";
