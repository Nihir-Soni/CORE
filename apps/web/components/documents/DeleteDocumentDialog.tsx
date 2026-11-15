"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { deleteDocument, ApiError } from "@/lib/api";
import type { Document } from "@/lib/types";

interface DeleteDocumentDialogProps {
  document: Document;
  workspaceId: string;
  onSuccess: (documentId: string) => void;
  onClose: () => void;
}

export function DeleteDocumentDialog({
  document: doc,
  workspaceId,
  onSuccess,
  onClose,
}: DeleteDocumentDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<{
    message: string;
    isStorageCleanupFailure?: boolean;
  } | null>(null);

  // Keyboard navigation: Escape key closes the dialog unless deletion is in progress
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isDeleting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDeleting, onClose]);

  const handleDelete = useCallback(async () => {
    if (isDeleting) return;

    setIsDeleting(true);
    setError(null);

    try {
      await deleteDocument(workspaceId, doc.id);
      onSuccess(doc.id);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError({
            message: "Your session has expired or is invalid. Please log in again.",
          });
        } else if (err.status === 403) {
          setError({
            message: "You are not authorized to delete documents in this workspace.",
          });
        } else if (err.status === 404) {
          setError({
            message: "This document is no longer available in this workspace.",
          });
        } else if (
          err.status === 502 ||
          err.message === "storage_cleanup_failed" ||
          (err.data as { error?: string })?.error === "storage_cleanup_failed"
        ) {
          setError({
            message:
              "Deletion is incomplete: storage cleanup failed. The document has been marked as deleting and is unavailable, but physical storage cleanup could not be completed. You can retry deleting this document.",
            isStorageCleanupFailure: true,
          });
        } else {
          setError({
            message: "An unexpected error occurred while deleting the document.",
          });
        }
      } else {
        setError({
          message:
            "A network or communication error occurred. Please check your connection and try again.",
        });
      }
    } finally {
      setIsDeleting(false);
    }
  }, [isDeleting, workspaceId, doc.id, onSuccess, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      aria-describedby="delete-dialog-description"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) {
          onClose();
        }
      }}
    >
      <div className="flex flex-col w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)] bg-[var(--sidebar-bg)] text-white">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-full flex items-center justify-center bg-[var(--status-failed-bg)] text-[var(--status-failed)]">
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
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
            <h2 id="delete-dialog-title" className="text-sm font-semibold text-white">
              Delete Document
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            aria-label="Close"
            className="text-[var(--sidebar-text)] hover:text-white disabled:opacity-40 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <p className="text-xs text-[var(--text-secondary)]">
              Are you sure you want to delete this document?
            </p>
            <div
              className="flex items-center gap-2 p-2.5 rounded bg-[var(--bg-surface-2)] border border-[var(--border-color)]"
              title={doc.filename}
            >
              <svg
                className="h-4 w-4 shrink-0 text-[var(--accent)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
              <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                {doc.filename}
              </span>
            </div>
          </div>

          <div id="delete-dialog-description" className="space-y-2 text-xs text-[var(--text-muted)] leading-relaxed">
            <p>
              Deleting this document permanently removes it from CHiE and makes it unavailable
              for retrieval and chat citations.
            </p>
            <p className="font-medium text-[var(--status-failed)]">
              This action is destructive and cannot be undone.
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div
              role="alert"
              className="p-3 rounded text-xs space-y-1.5 border border-[var(--status-failed)]"
              style={{ background: "var(--status-failed-bg)", color: "var(--status-failed)" }}
            >
              <div className="flex items-start gap-2">
                <svg
                  className="h-4 w-4 shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                    clipRule="evenodd"
                  />
                </svg>
                <div className="flex-1 font-medium">{error.message}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[var(--border-color)] bg-[var(--bg-surface-2)]">
          <Button
            id="cancel-delete-button"
            type="button"
            variant="secondary"
            size="sm"
            autoFocus
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </Button>

          <Button
            id="confirm-delete-button"
            type="button"
            variant="danger"
            size="sm"
            onClick={handleDelete}
            loading={isDeleting}
            disabled={isDeleting}
          >
            {error?.isStorageCleanupFailure ? "Retry Deletion" : "Delete document"}
          </Button>
        </div>
      </div>
    </div>
  );
}
