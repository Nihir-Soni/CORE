import type { DocumentStatus } from "@/lib/types";

const STATUS_CONFIG: Record<
  DocumentStatus,
  { label: string; color: string; bg: string }
> = {
  UPLOADING: {
    label: "Uploading",
    color: "var(--status-upload)",
    bg: "var(--status-upload-bg)",
  },
  UPLOADED: {
    label: "Uploaded",
    color: "var(--status-process)",
    bg: "var(--status-process-bg)",
  },
  PROCESSING: {
    label: "Processing",
    color: "var(--status-process)",
    bg: "var(--status-process-bg)",
  },
  READY: {
    label: "Ready",
    color: "var(--status-ready)",
    bg: "var(--status-ready-bg)",
  },
  FAILED: {
    label: "Failed",
    color: "var(--status-failed)",
    bg: "var(--status-failed-bg)",
  },
  DELETING: {
    label: "Deleting",
    color: "var(--status-failed)",
    bg: "var(--status-failed-bg)",
  },
};

interface StatusBadgeProps {
  status: DocumentStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    color: "var(--status-default)",
    bg: "var(--status-default-bg)",
  };

  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium"
      style={{ color: config.color, backgroundColor: config.bg }}
    >
      {/* Dot indicator — MinIO console style */}
      <span
        className="h-1.5 w-1.5 rounded-full shrink-0"
        style={{ backgroundColor: config.color }}
        aria-hidden="true"
      />
      {config.label}
    </span>
  );
}
