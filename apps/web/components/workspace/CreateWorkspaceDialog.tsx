"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { createWorkspace, ApiError } from "@/lib/api";
import { setWorkspaceId } from "@/lib/auth";
import type { Workspace } from "@/lib/types";

interface CreateWorkspaceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (newWorkspace: Workspace) => void;
}

export function CreateWorkspaceDialog({
  isOpen,
  onClose,
  onCreated,
}: CreateWorkspaceDialogProps) {
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
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

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Workspace name is required.");
      return;
    }
    if (trimmed.length > 64) {
      setError("Workspace name cannot exceed 64 characters.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const created = await createWorkspace({ name: trimmed });
      setWorkspaceId(created.id);
      onCreated?.(created);
      onClose();
      // Reload smoothly so entire dashboard loads fresh for newly created workspace
      window.location.reload();
    } catch (err: unknown) {
      setIsSubmitting(false);
      if (err instanceof ApiError) {
        setError(
          (err.data as { error?: string })?.error ||
            err.message ||
            "Failed to create workspace."
        );
      } else {
        setError("Failed to create workspace. Please check your network and try again.");
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-workspace-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
        onClick={() => {
          if (!isSubmitting) onClose();
        }}
      />

      {/* Dialog box */}
      <div
        className="relative w-full max-w-md rounded-xl p-6 shadow-2xl transition-all border"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--border-color)",
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg text-white"
            style={{ background: "var(--accent)" }}
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
          </div>
          <div>
            <h2
              id="create-workspace-title"
              className="text-base font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              Create New Workspace
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Workspaces isolate documents, team members, and chat context.
            </p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded p-3 text-xs font-medium"
            style={{
              background: "var(--status-failed-bg)",
              color: "var(--status-failed)",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="workspace-name-input"
              className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
              style={{ color: "var(--text-secondary)" }}
            >
              Workspace Name
            </label>
            <input
              ref={inputRef}
              id="workspace-name-input"
              type="text"
              placeholder="e.g. Project Atlas, Legal, Operations"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              disabled={isSubmitting}
              maxLength={64}
              required
              className="w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors"
              style={{
                background: "var(--bg-surface-2)",
                borderColor: "var(--border-color)",
                color: "var(--text-primary)",
              }}
            />
            <p className="mt-1 text-[11px] text-right" style={{ color: "var(--text-muted)" }}>
              {name.length}/64
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isSubmitting || !name.trim()}
            >
              {isSubmitting ? "Creating…" : "Create Workspace"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
