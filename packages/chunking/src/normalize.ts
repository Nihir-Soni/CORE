/**
 * Conservative text normalization for chunking input.
 *
 * Rules:
 *  1. Normalize Windows/Mac line endings to Unix (\n).
 *  2. Collapse any run of 3+ consecutive newlines down to exactly two (\n\n),
 *     so that paragraph boundaries are preserved but excess blank lines are
 *     removed.
 *  3. Trim leading/trailing whitespace from the result.
 *  4. Collapse non-newline whitespace runs (spaces, tabs) within a line to a
 *     single space — this removes invisible artifacts from PDF extraction.
 *
 * NOT done here (intentionally):
 *  - No sentence splitting
 *  - No stopword removal
 *  - No lowercasing
 *  - No summarization
 *  - No rewriting of content
 *
 * The original document text must remain intact after normalization.
 */
export function normalizeText(text: string): string {
  return text
    // 1. Normalize line endings
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // 2. Collapse 3+ consecutive newlines to a paragraph break
    .replace(/\n{3,}/g, "\n\n")
    // 3. Collapse non-newline whitespace within a line to a single space
    .replace(/[^\S\n]+/g, " ")
    // 4. Trim
    .trim();
}

/**
 * Split a normalized text into paragraphs.
 * Paragraphs are delimited by one or more blank lines (\n\n).
 * Each returned paragraph is trimmed; empty paragraphs are discarded.
 */
export function splitParagraphs(normalizedText: string): string[] {
  return normalizedText
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
