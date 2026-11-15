/**
 * Serializes a numeric array into a pgvector string representation.
 * The format pgvector expects is [1.1,2.2,3.3,...].
 * 
 * @param vector The normalized embedding vector
 * @returns The serialized string representation ready for SQL insertion
 * @throws If the vector does not have exactly 768 dimensions or contains non-finite values.
 */
export function serializeVector(vector: number[]): string {
  if (vector.length !== 768) {
    throw new Error(`Invalid dimensionality for pgvector serialization: expected 768, got ${vector.length}`);
  }

  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i])) {
      throw new Error(`Vector contains non-finite value at index ${i}`);
    }
  }

  // Format as a JSON array string without spaces for exact pgvector compliance
  return `[${vector.join(",")}]`;
}
