"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createWorkspaceInvitation, ApiError } from "@/lib/api";
import type { CreateInvitationResponse, InvitationRole } from "@/lib/types";

interface InviteMemberDialogProps {
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (invitation: CreateInvitationResponse) => void;
}

export function InviteMemberDialog({
  workspaceId,
  isOpen,
  onClose,
  onSuccess,
}: InviteMemberDialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("MEMBER");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<CreateInvitationResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset state on open/close
  useEffect(() => {
    if (isOpen) {
      setEmail("");
      setRole("MEMBER");
      setError(null);
      setCreatedInvite(null);
      setCopied(false);
    }
  }, [isOpen]);

  // Keyboard navigation: Escape key closes dialog unless submitting
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
      if (isSubmitting) return;

      const trimmedEmail = email.trim().toLowerCase();
      if (!trimmedEmail) {
        setError("Please enter an email address.");
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        setError("Please enter a valid email address.");
        return;
      }

      setIsSubmitting(true);
      setError(null);

      try {
        const response = await createWorkspaceInvitation(workspaceId, {
          email: trimmedEmail,
          role,
        });

        onSuccess(response);

        // If development link is returned, show it for easy copy-paste
        if (response.inviteUrl) {
          setCreatedInvite(response);
        } else {
          onClose();
        }
      } catch (err: unknown) {
        if (err instanceof ApiError) {
          if (err.status === 409 || err.message === "already_member") {
            setError("This user is already a member of this workspace.");
          } else if (err.status === 403) {
            setError("You do not have permission to invite members to this workspace.");
          } else if (err.status === 400 && err.message === "cannot_invite_owner") {
            setError("Inviting as OWNER is not allowed.");
          } else {
            setError(err.message || "Failed to create invitation.");
          }
        } else {
          setError("A network error occurred. Please try again.");
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, email, role, workspaceId, onSuccess, onClose],
  );

  const handleCopyLink = useCallback(async () => {
    if (!createdInvite?.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(createdInvite.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }, [createdInvite]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-dialog-title"
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
                  d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.765z"
                />
              </svg>
            </div>
            <h2 id="invite-dialog-title" className="text-sm font-semibold text-white">
              Invite Member
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
        {createdInvite ? (
          <div className="p-5 space-y-4">
            <div className="rounded-lg p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
              <p className="font-semibold">Invitation created successfully!</p>
              <p className="mt-1 text-emerald-300">
                An invitation has been created for <span className="font-mono">{createdInvite.email}</span>.
              </p>
            </div>

            {createdInvite.inviteUrl && (
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  Development Invite URL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={createdInvite.inviteUrl}
                    className="h-9 w-full px-3 text-xs rounded-[var(--input-radius)] border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text-primary)] font-mono select-all"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={handleCopyLink}
                    className="shrink-0 text-xs"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Note: Email delivery is not configured. Use this direct URL in development to accept the invitation.
                </p>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <Button type="button" variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {error && (
              <div
                role="alert"
                className="p-3 text-xs rounded bg-[var(--status-failed-bg)] border border-[var(--status-failed)]/20 text-[var(--status-failed)]"
              >
                {error}
              </div>
            )}

            <Input
              id="invite-email"
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              required
              disabled={isSubmitting}
            />

            <div className="flex flex-col gap-1">
              <label
                htmlFor="invite-role"
                className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
              >
                Role
              </label>
              <select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as InvitationRole)}
                disabled={isSubmitting}
                className="h-9 w-full px-3 text-sm rounded-[var(--input-radius)] border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text-primary)] outline-none focus:border-[var(--input-border-focus)] focus:ring-1 focus:ring-[var(--input-border-focus)] transition-colors"
              >
                <option value="MEMBER">Member (Read, upload, chat)</option>
                <option value="ADMIN">Admin (Invite members, delete docs)</option>
              </select>
              <p className="text-xs text-[var(--text-muted)]">
                Invited members receive full access according to this workspace role.
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
                Send Invitation
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
