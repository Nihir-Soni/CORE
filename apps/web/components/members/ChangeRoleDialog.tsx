"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { changeMemberRole, ApiError } from "@/lib/api";
import type { WorkspaceMember, InvitationRole } from "@/lib/types";

interface ChangeRoleDialogProps {
  member: WorkspaceMember | null;
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updated: { userId: string; role: string }) => void;
}

export function ChangeRoleDialog({
  member,
  workspaceId,
  isOpen,
  onClose,
  onSuccess,
}: ChangeRoleDialogProps) {
  const [selectedRole, setSelectedRole] = useState<InvitationRole>("MEMBER");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (member && isOpen) {
      setSelectedRole(member.role === "ADMIN" ? "ADMIN" : "MEMBER");
      setError(null);
    }
  }, [member, isOpen]);

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

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!member || isSubmitting) return;

      setIsSubmitting(true);
      setError(null);

      try {
        const response = await changeMemberRole(workspaceId, member.userId, selectedRole);
        onSuccess(response);
        onClose();
      } catch (err: unknown) {
        if (err instanceof ApiError) {
          if (err.status === 400 && err.message === "cannot_demote_last_owner") {
            setError("Cannot demote the last OWNER of this workspace.");
          } else if (err.status === 400 && err.message === "cannot_grant_owner") {
            setError("Ownership transfer is out of scope.");
          } else if (err.status === 403) {
            setError("Only workspace owners can change member roles.");
          } else if (err.status === 404) {
            setError("Member was not found in this workspace.");
          } else {
            setError(err.message || "Failed to update member role.");
          }
        } else {
          setError("A network error occurred. Please try again.");
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [member, isSubmitting, workspaceId, selectedRole, onSuccess, onClose],
  );

  if (!isOpen || !member) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-role-title"
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
            <div className="h-7 w-7 rounded-full flex items-center justify-center bg-[var(--accent)] text-white">
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
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
                />
              </svg>
            </div>
            <h2 id="change-role-title" className="text-sm font-semibold text-white">
              Change Member Role
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
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div
              role="alert"
              className="p-3 text-xs rounded bg-[var(--status-failed-bg)] border border-[var(--status-failed)]/20 text-[var(--status-failed)]"
            >
              {error}
            </div>
          )}

          <div className="p-3 rounded bg-[var(--bg-surface-2)] border border-[var(--border-color)]">
            <p className="text-xs text-[var(--text-secondary)]">Member:</p>
            <p className="text-sm font-medium text-[var(--text-primary)] mt-0.5">
              {member.name ? `${member.name} (${member.email})` : member.email}
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Current Role: <span className="font-semibold">{member.role}</span>
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="member-role-select"
              className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
            >
              New Role
            </label>
            <select
              id="member-role-select"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as InvitationRole)}
              disabled={isSubmitting}
              className="h-9 w-full px-3 text-sm rounded-[var(--input-radius)] border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text-primary)] outline-none focus:border-[var(--input-border-focus)] focus:ring-1 focus:ring-[var(--input-border-focus)] transition-colors"
            >
              <option value="MEMBER">Member (Read, upload, chat)</option>
              <option value="ADMIN">Admin (Invite members, delete docs)</option>
            </select>
            <p className="text-xs text-[var(--text-muted)]">
              Note: Ownership transfer is not supported. Only OWNER or ADMIN may manage members.
            </p>
          </div>

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
              type="submit"
              variant="primary"
              loading={isSubmitting}
            >
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
