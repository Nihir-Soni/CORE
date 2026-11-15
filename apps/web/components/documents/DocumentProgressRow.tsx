"use client";

import { useDocumentProgress } from "@/hooks/use-document-progress";
import { StatusBadge } from "@/components/ui/Badge";
import type { Document, DocumentStatus } from "@/lib/types";

interface DocumentProgressRowProps {
  doc: Document;
  workspaceId: string;
  onStatusChange?: (docId: string, newStatus: DocumentStatus) => void;
}

export function DocumentProgressRow({
  doc,
  workspaceId,
  onStatusChange,
}: DocumentProgressRowProps) {
  const isInProgress =
    doc.status === "UPLOADING" ||
    doc.status === "UPLOADED" ||
    doc.status === "PROCESSING";

  const { progressState } = useDocumentProgress({
    workspaceId,
    documentId: doc.id,
    enabled: isInProgress,
    onComplete: () => {
      onStatusChange?.(doc.id, "READY");
    },
    onError: () => {
      onStatusChange?.(doc.id, "FAILED");
    },
  });

  const currentStatus = (progressState?.status ?? doc.status) as DocumentStatus;
  const currentProgress =
    progressState?.progress ?? (doc.status === "READY" ? 100 : 0);
  const currentMessage = progressState?.message;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <StatusBadge status={currentStatus} />
        {isInProgress && (
          <span className="text-xs tabular-nums font-mono font-medium text-[var(--text-secondary)]">
            {currentProgress}%
          </span>
        )}
      </div>

      {isInProgress && (
        <div className="w-36 space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border-color)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${currentProgress}%` }}
              role="progressbar"
              aria-valuenow={currentProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          {currentMessage && (
            <p
              className="text-[11px] truncate text-[var(--text-muted)]"
              title={currentMessage}
            >
              {currentMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
