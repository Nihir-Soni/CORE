/**
 * Performs L2 normalization on a vector in place or returns a new one.
 * 
 * L2 norm = sqrt(sum(x[i]^2))
 * normalized[i] = x[i] / norm
 * 
 * Throws if the vector contains non-finite numbers or if the norm is zero/invalid.
 */
export function normalizeL2(vector: number[]): number[] {
  let sumSquares = 0;

  for (let i = 0; i < vector.length; i++) {
    const val = vector[i];
    if (!Number.isFinite(val)) {
      throw new Error(`Vector contains non-finite value at index ${i}`);
    }
    sumSquares += val * val;
  }

  const norm = Math.sqrt(sumSquares);

  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error(`Invalid L2 norm: ${norm} (cannot normalize a zero vector)`);
  }

  const normalized = new Array<number>(vector.length);
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = vector[i] / norm;
  }

  return normalized;
}
