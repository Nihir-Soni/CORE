"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { removeWorkspaceMember, ApiError } from "@/lib/api";
import type { WorkspaceMember } from "@/lib/types";

interface RemoveMemberDialogProps {
  member: WorkspaceMember | null;
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (removedUserId: string) => void;
}

export function RemoveMemberDialog({
  member,
  workspaceId,
  isOpen,
  onClose,
  onSuccess,
}: RemoveMemberDialogProps) {
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

  const handleRemove = useCallback(async () => {
    if (!member || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await removeWorkspaceMember(workspaceId, member.userId);
      onSuccess(member.userId);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 400 && err.message === "cannot_remove_last_owner") {
          setError("Cannot remove the last OWNER of this workspace.");
        } else if (err.status === 403 && err.message === "admin_cannot_remove_admin") {
          setError("Administrators cannot remove other administrators. Only the OWNER can do this.");
        } else if (err.status === 403) {
          setError("You do not have permission to remove this member.");
        } else if (err.status === 404) {
          setError("Member not found in this workspace.");
        } else {
          setError(err.message || "Failed to remove member.");
        }
      } else {
        setError("A network error occurred. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [member, isSubmitting, workspaceId, onSuccess, onClose]);

  if (!isOpen || !member) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-member-title"
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
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
            <h2 id="remove-member-title" className="text-sm font-semibold text-white">
              Remove Member
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
            Are you sure you want to remove{" "}
            <span className="font-semibold text-[var(--text-primary)]">
              {member.name ? `${member.name} (${member.email})` : member.email}
            </span>{" "}
            from this workspace?
          </p>

          <p className="text-xs text-[var(--text-muted)] bg-[var(--bg-surface-2)] p-3 rounded border border-[var(--border-color)]">
            This member will lose access to all documents, search, and chat sessions in this workspace. Their user account and any memberships in other workspaces will not be affected.
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
              onClick={handleRemove}
            >
              Remove Member
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
