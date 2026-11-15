/**
 * Multipart upload orchestration module.
 *
 * This module owns the entire client-side multipart upload lifecycle:
 *   initiate → get presigned URLs → PUT parts → complete
 *
 * It never buffers the whole file — only the current part is materialized
 * using File.slice(). This is the browser-side equivalent of the server
 * memory invariant from Phase 7.1.
 *
 * Resumability:
 *   Pass an existing sessionId to runMultipartUpload() to resume an
 *   interrupted upload. The module will call GET /multipart/:sessionId
 *   to discover which parts MinIO already has and skip them.
 *
 * Limitations (Phase 7.3):
 *   - Resume requires the original File object to be available. Cross-
 *     browser-session recovery (without the File) is not supported.
 *   - Parts are uploaded sequentially (one at a time). Parallel upload
 *     can be added in a later optimization pass.
 *   - Idempotency keys on initiate are not implemented; each fresh call
 *     creates a new session.
 */

import {
  initiateMultipart,
  getMultipartSession,
  getPartUrl,
  completeMultipart,
  abortMultipart,
} from "./api";
import type { UploadedPart } from "./types";

// ── Types ──────────────────────────────────────────────────────────────────────

export type MultipartUploadStatus =
  | "initiating"
  | "resuming"
  | "uploading"
  | "completing"
  | "completed"
  | "failed"
  | "aborted";

export interface MultipartUploadState {
  sessionId: string;
  documentId: string;
  totalParts: number;
  partSizeBytes: number;
  /** Parts already confirmed uploaded (from initiation or resume). */
  uploadedParts: Map<number, { etag: string }>;
  /** Total parts whose bytes have been sent (for progress display). */
  completedParts: number;
  status: MultipartUploadStatus;
  error?: string;
}

export type ProgressCallback = (state: Readonly<MultipartUploadState>) => void;

// ── Constants ──────────────────────────────────────────────────────────────────

/** Files >= this size use the multipart flow. */
export const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100 MB

const MAX_PART_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

// ── Abort controller registry ──────────────────────────────────────────────────
// Allows external callers to cancel an in-progress upload.
const abortControllers = new Map<string, AbortController>();

export function cancelUpload(sessionId: string): void {
  const ctrl = abortControllers.get(sessionId);
  if (ctrl) {
    ctrl.abort();
    abortControllers.delete(sessionId);
  }
}

// ── Part upload ────────────────────────────────────────────────────────────────

/**
 * Upload a single file slice to MinIO via presigned URL.
 * Returns the ETag from the response header.
 * Retries up to MAX_PART_RETRIES times with exponential back-off.
 */
async function uploadPartWithRetry(
  uploadUrl: string,
  part: Blob,
  partNumber: number,
  signal: AbortSignal,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_PART_RETRIES; attempt++) {
    if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");

    try {
      const response = await fetch(uploadUrl, {
        method: "PUT",
        body: part,
        signal,
      });

      if (!response.ok) {
        throw new Error(`Part ${partNumber} PUT failed: HTTP ${response.status}`);
      }

      // MinIO returns ETag in the response header.
      // CORS must expose ETag — verified in the MinIO CORS configuration.
      const etag = response.headers.get("ETag")?.replace(/"/g, "") ?? "";
      if (!etag) {
        throw new Error(
          `Part ${partNumber} upload succeeded but no ETag was returned. ` +
          `Verify MinIO CORS exposes the ETag header.`
        );
      }

      return etag;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < MAX_PART_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `Part ${partNumber} attempt ${attempt} failed, retrying in ${delay}ms:`,
          lastError.message
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error(`Part ${partNumber} failed after ${MAX_PART_RETRIES} attempts`);
}

// ── Main orchestrator ──────────────────────────────────────────────────────────

export interface RunMultipartOptions {
  workspaceId: string;
  file: File;
  /** If provided, resumes an existing session instead of creating a new one. */
  sessionId?: string;
  onProgress?: ProgressCallback;
}

/**
 * Run a complete multipart upload lifecycle.
 *
 * If sessionId is provided, queries MinIO for already-uploaded parts and
 * resumes from where the upload left off. Already-uploaded parts are skipped.
 *
 * Returns the final MultipartUploadState.
 */
export async function runMultipartUpload(
  opts: RunMultipartOptions
): Promise<MultipartUploadState> {
  const { workspaceId, file, onProgress } = opts;

  const ctrl = new AbortController();
  const { signal } = ctrl;

  let state: MultipartUploadState;

  // ── Phase 1: Initiate or Resume ──────────────────────────────────────────
  if (opts.sessionId) {
    // Resume: fetch existing session state from MinIO
    state = {
      sessionId: opts.sessionId,
      documentId: "", // will be filled from session response
      totalParts: 0,
      partSizeBytes: 0,
      uploadedParts: new Map(),
      completedParts: 0,
      status: "resuming",
    };
    onProgress?.(Object.freeze({ ...state, uploadedParts: new Map(state.uploadedParts) }));

    const session = await getMultipartSession(workspaceId, opts.sessionId);
    state.documentId = session.documentId;
    state.totalParts = session.totalParts;
    state.partSizeBytes = session.partSizeBytes;

    for (const p of session.uploadedParts) {
      state.uploadedParts.set(p.partNumber, { etag: p.etag });
    }
    state.completedParts = state.uploadedParts.size;
  } else {
    // Fresh start: initiate new session
    state = {
      sessionId: "",
      documentId: "",
      totalParts: 0,
      partSizeBytes: 0,
      uploadedParts: new Map(),
      completedParts: 0,
      status: "initiating",
    };
    onProgress?.(Object.freeze({ ...state, uploadedParts: new Map(state.uploadedParts) }));

    const init = await initiateMultipart(workspaceId, {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });
    state.sessionId = init.sessionId;
    state.documentId = init.documentId;
    state.totalParts = init.totalParts;
    state.partSizeBytes = init.partSizeBytes;
  }

  // Register abort controller so callers can cancel
  abortControllers.set(state.sessionId, ctrl);

  state.status = "uploading";
  onProgress?.(Object.freeze({ ...state, uploadedParts: new Map(state.uploadedParts) }));

  // ── Phase 2: Upload missing parts ────────────────────────────────────────
  try {
    for (let partNumber = 1; partNumber <= state.totalParts; partNumber++) {
      if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");

      // Skip already-uploaded parts (resume behaviour)
      if (state.uploadedParts.has(partNumber)) continue;

      // Slice the part from the file — only this slice is held in memory
      const start = (partNumber - 1) * state.partSizeBytes;
      const end = Math.min(start + state.partSizeBytes, file.size);
      const slice = file.slice(start, end);

      // Get a fresh presigned URL for this part
      const { uploadUrl } = await getPartUrl(workspaceId, state.sessionId, partNumber);

      // PUT directly to MinIO
      const etag = await uploadPartWithRetry(uploadUrl, slice, partNumber, signal);

      state.uploadedParts.set(partNumber, { etag });
      state.completedParts = state.uploadedParts.size;
      onProgress?.(Object.freeze({ ...state, uploadedParts: new Map(state.uploadedParts) }));
    }
  } catch (err) {
    abortControllers.delete(state.sessionId);

    if (err instanceof DOMException && err.name === "AbortError") {
      // User-initiated cancel: call server abort
      state.status = "aborted";
      onProgress?.(Object.freeze({ ...state, uploadedParts: new Map(state.uploadedParts) }));
      try {
        await abortMultipart(workspaceId, state.sessionId);
      } catch {
        // Best-effort abort
      }
      return state;
    }

    // Transient failure: mark failed but do NOT call server abort.
    // The session remains resumable via sessionId + original File.
    state.status = "failed";
    state.error = err instanceof Error ? err.message : String(err);
    onProgress?.(Object.freeze({ ...state, uploadedParts: new Map(state.uploadedParts) }));
    return state;
  }

  // ── Phase 3: Complete ────────────────────────────────────────────────────
  state.status = "completing";
  onProgress?.(Object.freeze({ ...state, uploadedParts: new Map(state.uploadedParts) }));

  const parts: UploadedPart[] = Array.from(state.uploadedParts.entries()).map(
    ([partNumber, { etag }]) => ({ partNumber, etag })
  );

  try {
    await completeMultipart(workspaceId, state.sessionId, parts);
  } catch (err) {
    abortControllers.delete(state.sessionId);
    state.status = "failed";
    state.error = `Completion failed: ${err instanceof Error ? err.message : String(err)}`;
    onProgress?.(Object.freeze({ ...state, uploadedParts: new Map(state.uploadedParts) }));
    return state;
  }

  abortControllers.delete(state.sessionId);
  state.status = "completed";
  onProgress?.(Object.freeze({ ...state, uploadedParts: new Map(state.uploadedParts) }));
  return state;
}
