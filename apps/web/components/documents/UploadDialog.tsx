"use client";

import { useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import {
  requestUploadUrl,
  uploadFileToStorage,
  completeUpload,
} from "@/lib/api";
import {
  runMultipartUpload,
  cancelUpload,
  MULTIPART_THRESHOLD_BYTES,
  type MultipartUploadState,
} from "@/lib/multipart-upload";
import { resolveMimeType, ALLOWED_MIME_TYPES } from "@/lib/mime";

const ALLOWED_TYPES = ALLOWED_MIME_TYPES;

// Single-PUT max (files below this use the old flow)
const SINGLE_PUT_MAX_BYTES = MULTIPART_THRESHOLD_BYTES; // 100 MB
// Multipart max (2GB)
const MULTIPART_MAX_BYTES = 2 * 1024 * 1024 * 1024;

// ── Upload state machine ───────────────────────────────────────────────────────

type UploadState =
  // Single-PUT phases (unchanged)
  | { phase: "idle" }
  | { phase: "requesting" }
  | { phase: "uploading"; progress: number }
  | { phase: "confirming" }
  | { phase: "success"; isDuplicate?: boolean }
  | { phase: "error"; message: string }
  // Multipart phases
  | {
      phase: "mp-initiating";
    }
  | {
      phase: "mp-uploading";
      completedParts: number;
      totalParts: number;
      sessionId: string;
      documentId: string;
    }
  | {
      phase: "mp-completing";
      completedParts: number;
      totalParts: number;
    }
  | {
      phase: "mp-interrupted";
      completedParts: number;
      totalParts: number;
      sessionId: string;
      documentId: string;
      message: string;
    }
  | { phase: "mp-aborted" };

interface UploadDialogProps {
  workspaceId: string;
  onSuccess: () => void;
  onClose: () => void;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${bytes} B`;
}

function mpProgress(completed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function UploadDialog({
  workspaceId,
  onSuccess,
  onClose,
}: UploadDialogProps) {
  const [uploadState, setUploadState] = useState<UploadState>({ phase: "idle" });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function validateAndSet(file: File | null) {
    setValidationError(null);
    setUploadState({ phase: "idle" });

    if (!file) {
      setSelectedFile(null);
      return;
    }
    const resolvedMime = resolveMimeType(file.name, file.type);
    if (!resolvedMime) {
      setValidationError(
        "Unsupported file type. Supported: PDF, DOCX, PPTX, XLSX, PNG, JPEG",
      );
      setSelectedFile(null);
      return;
    }
    if (file.size > MULTIPART_MAX_BYTES) {
      setValidationError("File exceeds the 2 GiB maximum.");
      setSelectedFile(null);
      return;
    }
    if (file.size === 0) {
      setValidationError("File is empty.");
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    validateAndSet(e.target.files?.[0] ?? null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    validateAndSet(e.dataTransfer.files?.[0] ?? null);
  }

  // ── Single-PUT flow (unchanged from Phase 2) ───────────────────────────────
  async function handleSinglePutUpload(file: File) {
    setUploadState({ phase: "requesting" });

    const mimeType = resolveMimeType(file.name, file.type) || file.type || "application/octet-stream";

    const { documentId, uploadUrl } = await requestUploadUrl(workspaceId, {
      filename: file.name,
      mimeType,
      sizeBytes: file.size,
    });

    setUploadState({ phase: "uploading", progress: 0 });

    await uploadFileToStorage(uploadUrl, file, mimeType, (p) => {
      setUploadState({ phase: "uploading", progress: p });
    });

    setUploadState({ phase: "confirming" });
    const completeRes = await completeUpload(workspaceId, documentId);
    setUploadState({ phase: "success", isDuplicate: completeRes?.duplicate });

    setTimeout(() => {
      onSuccess();
      onClose();
    }, 1200);
  }

  // ── Multipart flow ─────────────────────────────────────────────────────────
  const handleMultipartUpload = useCallback(
    async (file: File, resumeSessionId?: string) => {
      if (!resumeSessionId) {
        setUploadState({ phase: "mp-initiating" });
      }

      const finalState = await runMultipartUpload({
        workspaceId,
        file,
        sessionId: resumeSessionId,
        onProgress: (s: Readonly<MultipartUploadState>) => {
          switch (s.status) {
            case "initiating":
              setUploadState({ phase: "mp-initiating" });
              break;
            case "resuming":
              setUploadState({ phase: "mp-initiating" });
              break;
            case "uploading":
              setUploadState({
                phase: "mp-uploading",
                completedParts: s.completedParts,
                totalParts: s.totalParts,
                sessionId: s.sessionId,
                documentId: s.documentId,
              });
              break;
            case "completing":
              setUploadState({
                phase: "mp-completing",
                completedParts: s.completedParts,
                totalParts: s.totalParts,
              });
              break;
            case "completed":
              setUploadState({ phase: "success" });
              break;
            case "aborted":
              setUploadState({ phase: "mp-aborted" });
              break;
            case "failed":
              // Interrupted — preserve sessionId for resume
              setUploadState({
                phase: "mp-interrupted",
                completedParts: s.completedParts,
                totalParts: s.totalParts,
                sessionId: s.sessionId,
                documentId: s.documentId,
                message: s.error ?? "Upload interrupted.",
              });
              break;
          }
        },
      });

      if (finalState.status === "completed") {
        setUploadState({ phase: "success" });
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1200);
      }
    },
    [workspaceId, onSuccess, onClose],
  );

  // ── Main upload handler ────────────────────────────────────────────────────
  async function handleUpload() {
    if (!selectedFile) return;

    try {
      if (selectedFile.size < SINGLE_PUT_MAX_BYTES) {
        // < 100MB → single-PUT
        await handleSinglePutUpload(selectedFile);
      } else {
        // >= 100MB → multipart
        await handleMultipartUpload(selectedFile);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      setUploadState({ phase: "error", message });
    }
  }

  // ── Resume handler ─────────────────────────────────────────────────────────
  async function handleResume() {
    if (!selectedFile) return;
    if (uploadState.phase !== "mp-interrupted") return;

    const { sessionId } = uploadState;
    try {
      await handleMultipartUpload(selectedFile, sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Resume failed.";
      setUploadState({ phase: "error", message });
    }
  }

  // ── Cancel handler ─────────────────────────────────────────────────────────
  function handleCancel() {
    if (
      uploadState.phase === "mp-uploading" ||
      uploadState.phase === "mp-initiating"
    ) {
      if (uploadState.phase === "mp-uploading") {
        cancelUpload(uploadState.sessionId);
      }
    } else if (!isWorking) {
      onClose();
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const isWorking =
    uploadState.phase === "requesting" ||
    uploadState.phase === "uploading" ||
    uploadState.phase === "confirming" ||
    uploadState.phase === "mp-initiating" ||
    uploadState.phase === "mp-uploading" ||
    uploadState.phase === "mp-completing";

  const isCancellable =
    uploadState.phase === "mp-uploading";

  const singlePutProgress =
    uploadState.phase === "requesting"
      ? 5
      : uploadState.phase === "uploading"
        ? uploadState.progress
        : uploadState.phase === "confirming"
          ? 97
          : 0;

  const mpProgressPct =
    uploadState.phase === "mp-uploading" ||
    uploadState.phase === "mp-completing"
      ? mpProgress(
          uploadState.completedParts,
          uploadState.totalParts,
        )
      : uploadState.phase === "mp-initiating"
        ? 0
        : 0;

  const showSingleProgress =
    uploadState.phase === "requesting" ||
    uploadState.phase === "uploading" ||
    uploadState.phase === "confirming";

  const showMpProgress =
    uploadState.phase === "mp-initiating" ||
    uploadState.phase === "mp-uploading" ||
    uploadState.phase === "mp-completing";

  const isMultipart = selectedFile
    ? selectedFile.size >= SINGLE_PUT_MAX_BYTES
    : false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isWorking) onClose();
      }}
    >
      <div className="w-full max-w-md bg-[var(--bg-surface)] rounded shadow-xl overflow-hidden">
        {/* Modal header */}
        <div className="flex items-center justify-between bg-[var(--sidebar-bg)] px-5 py-3.5">
          <h2
            id="upload-title"
            className="text-sm font-semibold text-white flex items-center gap-2"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            Upload Object
          </h2>
          <button
            onClick={onClose}
            disabled={isWorking}
            aria-label="Close"
            className="text-[var(--sidebar-text)] hover:text-white disabled:opacity-40 transition-colors"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Drop zone */}
          <div
            className={[
              "border-2 border-dashed rounded p-8 text-center cursor-pointer transition-colors",
              dragging
                ? "border-[var(--accent)] bg-[var(--accent-light)]"
                : selectedFile
                  ? "border-[var(--accent)] bg-[var(--accent-light)]"
                  : "border-[var(--border-color)] hover:border-[var(--accent)] hover:bg-[var(--accent-light)]",
            ].join(" ")}
            onClick={() => !isWorking && fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            aria-label="Click or drag file to upload"
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !isWorking) {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              accept=".pdf,.docx,.pptx,.xlsx,.png,.jpeg,.jpg"
              onChange={handleFileChange}
              disabled={isWorking}
              aria-label="File input"
            />

            {selectedFile ? (
              <div className="space-y-1">
                <div className="mx-auto h-10 w-10 flex items-center justify-center rounded bg-[var(--accent-light)] text-[var(--accent)]">
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586"
                    />
                  </svg>
                </div>
                <p className="text-sm font-medium text-[var(--text-primary)] break-all">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {formatFileSize(selectedFile.size)}
                  {isMultipart && (
                    <span className="ml-2 text-[var(--accent)]">
                      · multipart upload
                    </span>
                  )}
                </p>
                {!isWorking && (
                  <p className="text-xs text-[var(--accent)]">
                    Click to change file
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="mx-auto h-10 w-10 flex items-center justify-center rounded bg-[var(--bg-surface-2)] text-[var(--text-muted)]">
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
                    />
                  </svg>
                </div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  Drag and drop or{" "}
                  <span className="text-[var(--accent)]">browse</span>
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  PDF, DOCX, PPTX, XLSX, PNG, JPEG · max 2 GiB
                </p>
              </div>
            )}
          </div>

          {/* Validation error */}
          {validationError && (
            <div className="flex items-start gap-2 rounded bg-[var(--status-failed-bg)] px-3 py-2">
              <svg
                className="h-4 w-4 shrink-0 text-[var(--status-failed)] mt-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                  clipRule="evenodd"
                />
              </svg>
              <p role="alert" className="text-xs text-[var(--status-failed)]">
                {validationError}
              </p>
            </div>
          )}

          {/* Single-PUT progress */}
          {showSingleProgress && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>
                  {uploadState.phase === "requesting" &&
                    "Requesting pre-signed URL…"}
                  {uploadState.phase === "uploading" &&
                    "Uploading to object store…"}
                  {uploadState.phase === "confirming" && "Confirming upload…"}
                </span>
                <span className="tabular-nums font-mono">
                  {singlePutProgress}%
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--border-color)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all duration-200"
                  style={{ width: `${singlePutProgress}%` }}
                  role="progressbar"
                  aria-valuenow={singlePutProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>
          )}

          {/* Multipart progress */}
          {showMpProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>
                  {uploadState.phase === "mp-initiating" && "Initiating upload…"}
                  {uploadState.phase === "mp-uploading" && "Uploading parts…"}
                  {uploadState.phase === "mp-completing" && "Completing upload…"}
                </span>
                <span className="tabular-nums font-mono">{mpProgressPct}%</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--border-color)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                  style={{ width: `${mpProgressPct}%` }}
                  role="progressbar"
                  aria-valuenow={mpProgressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Multipart upload progress"
                />
              </div>
              {(uploadState.phase === "mp-uploading" ||
                uploadState.phase === "mp-completing") && (
                <p className="text-xs text-[var(--text-muted)] tabular-nums text-right">
                  {uploadState.completedParts} / {uploadState.totalParts} parts
                </p>
              )}
            </div>
          )}

          {/* Interrupted state */}
          {uploadState.phase === "mp-interrupted" && (
            <div className="rounded border border-[var(--border-color)] bg-[var(--bg-surface-2)] px-3 py-3 space-y-2">
              <div className="flex items-start gap-2">
                <svg
                  className="h-4 w-4 shrink-0 text-amber-400 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                    clipRule="evenodd"
                  />
                </svg>
                <p className="text-xs text-[var(--text-secondary)]">
                  Upload interrupted.{" "}
                  <span className="text-[var(--text-muted)]">
                    {uploadState.completedParts} / {uploadState.totalParts}{" "}
                    parts uploaded.
                  </span>
                </p>
              </div>
              {selectedFile ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Click <strong>Resume</strong> to continue from where you left
                  off.
                </p>
              ) : (
                <p className="text-xs text-amber-400">
                  Re-select the same file to resume.
                </p>
              )}
            </div>
          )}

          {/* Aborted state */}
          {uploadState.phase === "mp-aborted" && (
            <div className="flex items-start gap-2 rounded bg-[var(--status-failed-bg)] px-3 py-2">
              <p role="status" className="text-xs text-[var(--status-failed)]">
                Upload cancelled.
              </p>
            </div>
          )}

          {/* Success */}
          {uploadState.phase === "success" && (
            <div className="flex items-center gap-2 rounded bg-[var(--status-ready-bg)] px-3 py-2">
              <svg
                className="h-4 w-4 shrink-0 text-[var(--status-ready)]"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                  clipRule="evenodd"
                />
              </svg>
              <p
                role="status"
                className="text-xs font-medium text-[var(--status-ready)]"
              >
                {uploadState.isDuplicate
                  ? "File already exists in this workspace (deduplicated)."
                  : "Object uploaded successfully."}
              </p>
            </div>
          )}

          {/* Error */}
          {uploadState.phase === "error" && (
            <div className="flex items-start gap-2 rounded bg-[var(--status-failed-bg)] px-3 py-2">
              <svg
                className="h-4 w-4 shrink-0 text-[var(--status-failed)] mt-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                  clipRule="evenodd"
                />
              </svg>
              <p role="alert" className="text-xs text-[var(--status-failed)]">
                {uploadState.message}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-color)] px-5 py-3 bg-[var(--bg-surface-2)]">
          {/* Cancel button — visible during multipart (cancels upload) */}
          {isCancellable ? (
            <Button
              variant="secondary"
              size="sm"
              id="upload-cancel"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={isWorking}
            >
              {uploadState.phase === "mp-interrupted" ||
              uploadState.phase === "mp-aborted"
                ? "Close"
                : "Cancel"}
            </Button>
          )}

          {/* Resume button (shown on interrupted) */}
          {uploadState.phase === "mp-interrupted" && selectedFile && (
            <Button
              variant="secondary"
              size="sm"
              id="upload-resume"
              onClick={handleResume}
            >
              Resume
            </Button>
          )}

          {/* Upload / main action */}
          {uploadState.phase !== "mp-interrupted" && (
            <Button
              variant="primary"
              size="sm"
              id="upload-submit"
              onClick={handleUpload}
              disabled={
                !selectedFile ||
                isWorking ||
                uploadState.phase === "success" ||
                uploadState.phase === "mp-aborted"
              }
              loading={isWorking}
            >
              Upload
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
