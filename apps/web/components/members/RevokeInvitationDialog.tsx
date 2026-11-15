"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { revokeWorkspaceInvitation, ApiError } from "@/lib/api";
import type { WorkspaceInvitation } from "@/lib/types";

interface RevokeInvitationDialogProps {
  invitation: WorkspaceInvitation | null;
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (revokedInvitationId: string) => void;
}

export function RevokeInvitationDialog({
  invitation,
  workspaceId,
  isOpen,
  onClose,
  onSuccess,
}: RevokeInvitationDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  const handleRevoke = useCallback(async () => {
    if (!invitation || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await revokeWorkspaceInvitation(workspaceId, invitation.id);
      onSuccess(invitation.id);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError("You do not have permission to revoke invitations.");
        } else if (err.status === 404) {
          setError("Invitation was not found.");
        } else {
          setError(err.message || "Failed to revoke invitation.");
        }
      } else {
        setError("A network error occurred. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [invitation, isSubmitting, workspaceId, onSuccess, onClose]);

  if (!isOpen || !invitation) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="revoke-invitation-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h2 id="revoke-invitation-title" className="text-sm font-semibold text-white">
              Revoke Invitation
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
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
          {error && (
            <div
              role="alert"
              className="p-3 text-xs rounded bg-[var(--status-failed-bg)] border border-[var(--status-failed)]/20 text-[var(--status-failed)]"
            >
              {error}
            </div>
          )}

          <p className="text-sm text-[var(--text-secondary)]">
            Are you sure you want to revoke the invitation for{" "}
            <span className="font-semibold text-[var(--text-primary)] font-mono">
              {invitation.email}
            </span>
            ?
          </p>

          <p className="text-xs text-[var(--text-muted)] bg-[var(--bg-surface-2)] p-3 rounded border border-[var(--border-color)]">
            Once revoked, the invitation link will immediately become invalid and can no longer be used to join this workspace.
          </p>

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={isSubmitting}
              onClick={handleRevoke}
            >
              Revoke Invitation
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
