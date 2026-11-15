"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getDocuments, downloadDocument, deleteDocument, getWorkspaceRole, getWorkspaceMembers } from "@/lib/api";
import { getWorkspaceId } from "@/lib/auth";

const WORKSPACE_CHANGED_EVENT = "core_workspace_changed";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { UploadDialog } from "@/components/documents/UploadDialog";
import { DocumentProgressRow } from "@/components/documents/DocumentProgressRow";
import { DocumentViewerModal } from "@/components/documents/DocumentViewerModal";
import { DeleteDocumentDialog } from "@/components/documents/DeleteDocumentDialog";
import type { Document, DocumentStatus, WorkspaceMember } from "@/lib/types";

// ── Static filter option definitions ─────────────────────────────────────────

const FILE_TYPE_OPTIONS: { label: string; mime: string }[] = [
  { label: "PDF",  mime: "application/pdf" },
  { label: "DOCX", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { label: "PPTX", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  { label: "XLSX", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { label: "PNG",  mime: "image/png" },
  { label: "JPEG", mime: "image/jpeg" },
];

const STATUS_FILTER_OPTIONS: { label: string; value: DocumentStatus }[] = [
  { label: "Ready",      value: "READY" },
  { label: "Processing", value: "PROCESSING" },
  { label: "Uploaded",   value: "UPLOADED" },
  { label: "Failed",     value: "FAILED" },
  { label: "Uploading",  value: "UPLOADING" },
  { label: "Deleting",   value: "DELETING" },
];

type DateRangeOption = "any" | "today" | "7d" | "30d";

const DATE_OPTIONS: { label: string; value: DateRangeOption }[] = [
  { label: "Any time",    value: "any" },
  { label: "Today",       value: "today" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days",value: "30d" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${bytes} B`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "image/png": "PNG",
    "image/jpeg": "JPEG",
  };
  return map[mimeType] ?? "—";
}

const EXT_COLORS: Record<string, { bg: string; color: string }> = {
  PDF:  { bg: "#FFF1F2", color: "#BE123C" },
  DOCX: { bg: "#EFF6FF", color: "#1D4ED8" },
  PPTX: { bg: "#FFF7ED", color: "#C2410C" },
  XLSX: { bg: "#F0FDF4", color: "#15803D" },
  PNG:  { bg: "#F5F3FF", color: "#7C3AED" },
  JPEG: { bg: "#F5F3FF", color: "#7C3AED" },
};

function TypeBadge({ mimeType }: { mimeType: string }) {
  const ext = mimeToExt(mimeType);
  const style = EXT_COLORS[ext] ?? { bg: "var(--status-default-bg)", color: "var(--status-default)" };
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
      style={{ background: style.bg, color: style.color }}
    >
      {ext}
    </span>
  );
}

function uploaderDisplayName(userId: string, members: WorkspaceMember[]): string {
  const m = members.find((m) => m.userId === userId);
  if (!m) return userId.slice(0, 8) + "…";
  return m.name ?? m.email;
}

// ── Filter sub-components ─────────────────────────────────────────────────────

function FilterCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className="flex items-center gap-2 w-full text-left py-0.5 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
    >
      <span
        className="h-3.5 w-3.5 rounded shrink-0 border flex items-center justify-center"
        style={{
          borderColor: checked ? "var(--accent)" : "var(--border-color)",
          background: checked ? "var(--accent)" : "transparent",
        }}
      >
        {checked && (
          <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="currentColor">
            <path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        )}
      </span>
      <span
        className="text-xs"
        style={{ color: checked ? "var(--accent)" : "var(--text-secondary)", fontWeight: checked ? 600 : 400 }}
      >
        {label}
      </span>
    </button>
  );
}

function FilterRadio({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex items-center gap-2 w-full text-left py-0.5 transition-opacity"
    >
      <span
        className="h-3.5 w-3.5 rounded-full shrink-0 border flex items-center justify-center"
        style={{ borderColor: checked ? "var(--accent)" : "var(--border-color)" }}
      >
        {checked && (
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--accent)" }}
          />
        )}
      </span>
      <span
        className="text-xs"
        style={{ color: checked ? "var(--accent)" : "var(--text-secondary)", fontWeight: checked ? 600 : 400 }}
      >
        {label}
      </span>
    </button>
  );
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; documents: Document[] };

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [showUpload, setShowUpload] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [userRole, setUserRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [documentToDelete, setDocumentToDelete] = useState<Document | null>(null);
  const [successNotification, setSuccessNotification] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [showFilters, setShowFilters] = useState(false);
  const [filterFileTypes, setFilterFileTypes] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<DocumentStatus[]>([]);
  const [filterDateRange, setFilterDateRange] = useState<DateRangeOption>("any");
  const [filterUploaderIds, setFilterUploaderIds] = useState<string[]>([]);

  // ── Bulk-selection state ──────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState<null | {
    done: number; total: number; errors: string[];
  }>(null);

  const [workspaceId, setWorkspaceIdState] = useState<string>(() => getWorkspaceId() ?? "");

  useEffect(() => {
    const handleWorkspaceChanged = (e: any) => {
      const newId = e?.detail?.workspaceId || getWorkspaceId() || "";
      setWorkspaceIdState(newId);
    };
    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
  }, []);

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadDocuments = useCallback(() => {
    if (!workspaceId) { setState({ phase: "error", message: "Workspace not found." }); return; }
    setState({ phase: "loading" });
    getDocuments(workspaceId)
      .then((docs) => { setState({ phase: "ready", documents: docs }); setSelectedIds(new Set()); })
      .catch(() => setState({ phase: "error", message: "Unable to load objects." }));
  }, [workspaceId]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  useEffect(() => {
    if (!workspaceId) { setRoleLoading(false); return; }
    setRoleLoading(true);
    getWorkspaceRole(workspaceId)
      .then((role) => setUserRole(role))
      .catch(() => setUserRole(null))
      .finally(() => setRoleLoading(false));
  }, [workspaceId]);

  // Fetch members for the uploader filter
  useEffect(() => {
    if (!workspaceId) return;
    getWorkspaceMembers(workspaceId).then(setMembers).catch(() => {});
  }, [workspaceId]);

  const canDelete = !roleLoading && (userRole?.toUpperCase() === "ADMIN" || userRole?.toUpperCase() === "OWNER");

  const handleStatusChange = useCallback((docId: string, newStatus: DocumentStatus) => {
    setState((prev) => {
      if (prev.phase !== "ready") return prev;
      return {
        ...prev,
        documents: prev.documents.map((d) =>
          d.id === docId ? { ...d, status: newStatus } : d
        ),
      };
    });
  }, []);

  const handleDownloadDoc = async (doc: Document) => {
    setDownloadingDocId(doc.id);
    try {
      await downloadDocument(workspaceId, doc);
    } catch (err) {
      console.error("Failed to download document:", err);
    } finally {
      setDownloadingDocId(null);
    }
  };

  // ── Derived filter options (only show types/statuses/uploaders present in docs)

  const availableMimes = useMemo(() => {
    if (state.phase !== "ready") return new Set<string>();
    return new Set(state.documents.map((d) => d.mimeType));
  }, [state]);

  const availableStatuses = useMemo(() => {
    if (state.phase !== "ready") return new Set<DocumentStatus>();
    return new Set(state.documents.map((d) => d.status));
  }, [state]);

  const uploaderOptions = useMemo((): string[] => {
    if (state.phase !== "ready") return [];
    const seen = new Set<string>();
    return state.documents
      .map((d) => d.uploadedById)
      .filter((id) => { if (seen.has(id)) return false; seen.add(id); return true; });
  }, [state]);

  // ── Active filter count ───────────────────────────────────────────────────

  const activeFilterCount =
    filterFileTypes.length +
    filterStatuses.length +
    (filterDateRange !== "any" ? 1 : 0) +
    filterUploaderIds.length;

  function clearFilters() {
    setFilterFileTypes([]);
    setFilterStatuses([]);
    setFilterDateRange("any");
    setFilterUploaderIds([]);
  }

  function toggleFileType(mime: string) {
    setFilterFileTypes((prev) =>
      prev.includes(mime) ? prev.filter((m) => m !== mime) : [...prev, mime]
    );
  }

  function toggleStatus(status: DocumentStatus) {
    setFilterStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  }

  function toggleUploader(userId: string) {
    setFilterUploaderIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  // ── Filtered documents ────────────────────────────────────────────────────

  const filteredDocs = useMemo(() => {
    if (state.phase !== "ready") return [];
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    return state.documents.filter((d) => {
      if (searchQuery && !d.filename.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterFileTypes.length > 0 && !filterFileTypes.includes(d.mimeType)) return false;
      if (filterStatuses.length > 0 && !filterStatuses.includes(d.status)) return false;
      if (filterUploaderIds.length > 0 && !filterUploaderIds.includes(d.uploadedById)) return false;
      if (filterDateRange !== "any") {
        const created = new Date(d.createdAt).getTime();
        if (filterDateRange === "today" && created < startOfToday.getTime()) return false;
        if (filterDateRange === "7d"  && now - created > 7  * 86_400_000) return false;
        if (filterDateRange === "30d" && now - created > 30 * 86_400_000) return false;
      }
      return true;
    });
  }, [state, searchQuery, filterFileTypes, filterStatuses, filterDateRange, filterUploaderIds]);

  const isFiltered = searchQuery.length > 0 || activeFilterCount > 0;
  const totalDocs = state.phase === "ready" ? state.documents.length : 0;

  // ── Bulk selection helpers ────────────────────────────────────────────────

  const allVisibleSelected =
    filteredDocs.length > 0 && filteredDocs.every((d) => selectedIds.has(d.id));
  const someVisibleSelected =
    filteredDocs.some((d) => selectedIds.has(d.id)) && !allVisibleSelected;

  function toggleSelectAll() {
    if (allVisibleSelected) {
      // Deselect all visible
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredDocs.forEach((d) => next.delete(d.id));
        return next;
      });
    } else {
      // Select all visible
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredDocs.forEach((d) => next.add(d.id));
        return next;
      });
    }
  }

  function toggleSelectDoc(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() { setSelectedIds(new Set()); }

  // ── Bulk download ─────────────────────────────────────────────────────────
  // Sequential to avoid browser popup blockers; fires one at a time.
  async function handleBulkDownload() {
    if (state.phase !== "ready" || bulkDownloading) return;
    const docs = state.documents.filter((d) => selectedIds.has(d.id));
    setBulkDownloading(true);
    for (const doc of docs) {
      try { await downloadDocument(workspaceId, doc); }
      catch { /* individual failures are silent; file just won't download */ }
      // Brief pause so the browser can queue each save dialog in turn
      await new Promise((r) => setTimeout(r, 400));
    }
    setBulkDownloading(false);
  }

  // ── Bulk delete ───────────────────────────────────────────────────────────
  async function handleBulkDelete() {
    if (state.phase !== "ready") return;
    const ids = [...selectedIds];
    setShowBulkDeleteConfirm(false);
    setBulkDeleteProgress({ done: 0, total: ids.length, errors: [] });

    const errors: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        await deleteDocument(workspaceId, id);
        setState((prev) =>
          prev.phase === "ready"
            ? { ...prev, documents: prev.documents.filter((d) => d.id !== id) }
            : prev
        );
      } catch {
        const doc = state.documents.find((d) => d.id === id);
        errors.push(doc?.filename ?? id);
      }
      setBulkDeleteProgress({ done: i + 1, total: ids.length, errors });
    }

    setSelectedIds(new Set());
    const succeeded = ids.length - errors.length;
    if (errors.length === 0) {
      setSuccessNotification(`${succeeded} object${succeeded !== 1 ? "s" : ""} deleted.`);
    } else {
      setSuccessNotification(
        `${succeeded} deleted, ${errors.length} failed: ${errors.join(", ")}`
      );
    }
    setBulkDeleteProgress(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="space-y-3 max-w-6xl">

        {/* ── Toolbar ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            Object Browser
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
                style={{ color: "var(--text-muted)" }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 0z" />
              </svg>
              <input
                type="search"
                placeholder="Search objects…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-48 rounded border pl-8 pr-3 text-xs outline-none transition-colors"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-color)",
                  color: "var(--text-primary)",
                }}
                aria-label="Search objects"
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-color)")}
              />
            </div>

            {/* Filters toggle */}
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className="flex h-8 items-center gap-1.5 rounded border px-2.5 text-xs font-medium transition-colors"
              style={{
                background: showFilters || activeFilterCount > 0 ? "var(--accent-light, #fff1f2)" : "var(--bg-surface)",
                borderColor: showFilters || activeFilterCount > 0 ? "var(--accent)" : "var(--border-color)",
                color: showFilters || activeFilterCount > 0 ? "var(--accent)" : "var(--text-secondary)",
              }}
              aria-label="Toggle filters"
              aria-expanded={showFilters}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
              </svg>
              Filters
              {activeFilterCount > 0 && (
                <span
                  className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                  style={{ background: "var(--accent)" }}
                >
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Refresh */}
            <button
              onClick={loadDocuments}
              title="Refresh"
              className="flex h-8 w-8 items-center justify-center rounded border transition-colors"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-color)",
                color: "var(--text-secondary)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-surface-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-surface)")}
              aria-label="Refresh"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </button>

            <Button
              id="upload-document-button"
              variant="primary"
              size="sm"
              onClick={() => setShowUpload(true)}
              startIcon={
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              }
            >
              Upload Object
            </Button>
          </div>
        </div>

        {/* ── Advanced Filter Panel ── */}
        {showFilters && (
          <div
            className="rounded"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-color)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            {/* Panel header */}
            <div
              className="flex items-center justify-between px-4 py-2.5"
              style={{ borderBottom: "1px solid var(--border-color)" }}
            >
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Advanced Filters
              </span>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-75"
                  style={{ color: "var(--accent)" }}
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Clear all ({activeFilterCount})
                </button>
              )}
            </div>

            {/* Filter columns */}
            <div className="grid grid-cols-2 gap-6 p-4 md:grid-cols-4">

              {/* File Type */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  File Type
                </p>
                <div className="space-y-1">
                  {FILE_TYPE_OPTIONS.filter((opt) => availableMimes.has(opt.mime)).map((opt) => (
                    <FilterCheckbox
                      key={opt.mime}
                      label={opt.label}
                      checked={filterFileTypes.includes(opt.mime)}
                      onChange={() => toggleFileType(opt.mime)}
                    />
                  ))}
                  {FILE_TYPE_OPTIONS.every((opt) => !availableMimes.has(opt.mime)) && (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>No files yet</p>
                  )}
                </div>
              </div>

              {/* Status */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  Status
                </p>
                <div className="space-y-1">
                  {STATUS_FILTER_OPTIONS.filter((opt) => availableStatuses.has(opt.value)).map((opt) => (
                    <FilterCheckbox
                      key={opt.value}
                      label={opt.label}
                      checked={filterStatuses.includes(opt.value)}
                      onChange={() => toggleStatus(opt.value)}
                    />
                  ))}
                  {STATUS_FILTER_OPTIONS.every((opt) => !availableStatuses.has(opt.value)) && (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>No files yet</p>
                  )}
                </div>
              </div>

              {/* Upload Date */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  Upload Date
                </p>
                <div className="space-y-1">
                  {DATE_OPTIONS.map((opt) => (
                    <FilterRadio
                      key={opt.value}
                      label={opt.label}
                      checked={filterDateRange === opt.value}
                      onChange={() => setFilterDateRange(opt.value)}
                    />
                  ))}
                </div>
              </div>

              {/* Uploader */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  Uploader
                </p>
                <div className="space-y-1">
                  {uploaderOptions.map((userId) => (
                    <FilterCheckbox
                      key={userId}
                      label={uploaderDisplayName(userId, members)}
                      checked={filterUploaderIds.includes(userId)}
                      onChange={() => toggleUploader(userId)}
                    />
                  ))}
                  {uploaderOptions.length === 0 && (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>No files yet</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Active filter chips (shown when filters are on but panel is collapsed) ── */}
        {!showFilters && activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Active:</span>
            {filterFileTypes.map((mime) => {
              const opt = FILE_TYPE_OPTIONS.find((o) => o.mime === mime);
              return (
                <FilterChip
                  key={mime}
                  label={opt?.label ?? mime}
                  onRemove={() => toggleFileType(mime)}
                />
              );
            })}
            {filterStatuses.map((status) => {
              const opt = STATUS_FILTER_OPTIONS.find((o) => o.value === status);
              return (
                <FilterChip
                  key={status}
                  label={opt?.label ?? status}
                  onRemove={() => toggleStatus(status)}
                />
              );
            })}
            {filterDateRange !== "any" && (
              <FilterChip
                label={DATE_OPTIONS.find((o) => o.value === filterDateRange)?.label ?? filterDateRange}
                onRemove={() => setFilterDateRange("any")}
              />
            )}
            {filterUploaderIds.map((id) => (
              <FilterChip
                key={id}
                label={uploaderDisplayName(id, members)}
                onRemove={() => toggleUploader(id)}
              />
            ))}
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-medium hover:opacity-75 transition-opacity"
              style={{ color: "var(--accent)" }}
            >
              Clear all
            </button>
          </div>
        )}

        {/* ── Bulk action bar ── */}
        {selectedIds.size > 0 && (
          <div
            className="flex items-center justify-between gap-3 rounded px-4 py-2.5 flex-wrap"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--accent)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                onClick={clearSelection}
                className="text-xs hover:underline cursor-pointer"
                style={{ color: "var(--text-muted)" }}
              >
                Clear
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Bulk Download */}
              <button
                type="button"
                onClick={handleBulkDownload}
                disabled={bulkDownloading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border transition-colors disabled:opacity-50 cursor-pointer"
                style={{
                  background: "var(--bg-surface)",
                  borderColor: "var(--border-color)",
                  color: "var(--text-secondary)",
                }}
              >
                {bulkDownloading ? (
                  <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                )}
                {bulkDownloading ? "Downloading…" : `Download ${selectedIds.size}`}
              </button>

              {/* Bulk Delete — only for ADMIN/OWNER */}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => setShowBulkDeleteConfirm(true)}
                  disabled={bulkDeleteProgress !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border transition-colors disabled:opacity-50 cursor-pointer"
                  style={{
                    background: "var(--status-failed-bg)",
                    borderColor: "var(--status-failed)",
                    color: "var(--status-failed)",
                  }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                  Delete {selectedIds.size}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Bulk delete progress ── */}
        {bulkDeleteProgress !== null && (
          <div className="rounded px-4 py-3 text-xs" style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border-color)" }}>
            <div className="flex items-center justify-between mb-1.5">
              <span style={{ color: "var(--text-secondary)" }}>
                Deleting… {bulkDeleteProgress.done} / {bulkDeleteProgress.total}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: "var(--border-color)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${(bulkDeleteProgress.done / bulkDeleteProgress.total) * 100}%`,
                  background: "var(--accent)",
                }}
              />
            </div>
          </div>
        )}

        {/* ── Success notification ── */}
        {successNotification && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-between p-3 rounded text-xs border border-[var(--status-ready)]"
            style={{ background: "var(--status-ready-bg)", color: "var(--status-ready)" }}
          >
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
              </svg>
              <span>{successNotification}</span>
            </div>
            <button type="button" onClick={() => setSuccessNotification(null)} className="text-xs font-semibold hover:opacity-75 transition-opacity" aria-label="Dismiss notification">
              Dismiss
            </button>
          </div>
        )}

        {/* ── Main panel ── */}
        <div
          className="rounded overflow-hidden"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-color)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          {/* Path bar */}
          <div
            className="flex items-center gap-2 px-4 py-2.5 text-xs"
            style={{ background: "var(--bg-surface-2)", borderBottom: "1px solid var(--border-color)" }}
          >
            <svg className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
            <span style={{ color: "var(--text-muted)" }}>core-bucket</span>
            <span style={{ color: "var(--text-muted)" }}>/</span>
            <span style={{ color: "var(--accent)", fontWeight: 500 }}>
              {workspaceId ? workspaceId.slice(0, 8) + "…" : "workspace"}
            </span>
          </div>

          {/* Loading */}
          {state.phase === "loading" && (
            <div className="flex h-48 items-center justify-center">
              <Spinner label="Loading objects…" />
            </div>
          )}

          {/* Error */}
          {state.phase === "error" && (
            <div className="p-6">
              <div className="flex items-start gap-2 rounded p-3" style={{ background: "var(--status-failed-bg)" }}>
                <svg className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--status-failed)" }} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                </svg>
                <div>
                  <p role="alert" className="text-sm" style={{ color: "var(--status-failed)" }}>{state.message}</p>
                  <button onClick={loadDocuments} className="text-xs mt-1 hover:underline" style={{ color: "var(--accent)" }}>Retry</button>
                </div>
              </div>
            </div>
          )}

          {/* Empty state */}
          {state.phase === "ready" && filteredDocs.length === 0 && (
            <div className="py-16 text-center">
              <div className="mx-auto h-12 w-12 rounded-full flex items-center justify-center mb-4" style={{ background: "var(--bg-surface-2)" }}>
                <svg className="h-6 w-6" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {isFiltered ? "No objects match your filters" : "This bucket is empty"}
              </p>
              {isFiltered ? (
                <button
                  type="button"
                  onClick={() => { clearFilters(); setSearchQuery(""); }}
                  className="mt-2 text-xs font-medium hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  Clear filters
                </button>
              ) : (
                <>
                  <p className="text-xs mt-1 mb-4" style={{ color: "var(--text-muted)" }}>Upload an object to get started.</p>
                  <Button id="empty-state-upload" variant="primary" size="sm" onClick={() => setShowUpload(true)}>
                    Upload Object
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Table */}
          {state.phase === "ready" && filteredDocs.length > 0 && (
            <>
              <table className="w-full text-sm" aria-label="Object browser">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                    <th scope="col" className="w-10 px-4 py-2.5" style={{ color: "var(--text-muted)", background: "var(--bg-surface-2)" }}>
                      <button
                        type="button"
                        onClick={toggleSelectAll}
                        aria-label={allVisibleSelected ? "Deselect all" : "Select all"}
                        className="flex items-center justify-center cursor-pointer"
                      >
                        <span
                          className="h-4 w-4 rounded border flex items-center justify-center transition-colors"
                          style={{
                            borderColor: (allVisibleSelected || someVisibleSelected) ? "var(--accent)" : "var(--border-color)",
                            background: allVisibleSelected ? "var(--accent)" : "transparent",
                          }}
                        >
                          {allVisibleSelected && (
                            <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="currentColor">
                              <path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                            </svg>
                          )}
                          {someVisibleSelected && !allVisibleSelected && (
                            <span className="h-0.5 w-2 rounded" style={{ background: "var(--accent)" }} />
                          )}
                        </span>
                      </button>
                    </th>
                    {[
                      { label: "Object Name",   className: "" },
                      { label: "Type",          className: "hidden sm:table-cell" },
                      { label: "Size",          className: "hidden md:table-cell" },
                      { label: "Status",        className: "" },
                      { label: "Last Modified", className: "hidden lg:table-cell" },
                      { label: "Actions",       className: "text-right" },
                    ].map((col) => (
                      <th
                        key={col.label}
                        scope="col"
                        className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider ${col.className || "text-left"}`}
                        style={{ color: "var(--text-muted)", background: "var(--bg-surface-2)" }}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.map((doc, i) => (
                    <tr
                      key={doc.id}
                      className="transition-colors"
                      style={{
                        borderBottom: i < filteredDocs.length - 1 ? "1px solid var(--border-subtle)" : "none",
                        background: selectedIds.has(doc.id) ? "var(--accent-light, #fff1f2)" : undefined,
                      }}
                      onMouseEnter={(e) => {
                        if (!selectedIds.has(doc.id)) e.currentTarget.style.background = "var(--bg-surface-2)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = selectedIds.has(doc.id) ? "var(--accent-light, #fff1f2)" : "transparent";
                      }}
                    >
                      {/* Checkbox */}
                      <td className="w-10 px-4 py-2.5">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleSelectDoc(doc.id); }}
                          aria-label={selectedIds.has(doc.id) ? `Deselect ${doc.filename}` : `Select ${doc.filename}`}
                          className="flex items-center justify-center cursor-pointer"
                        >
                          <span
                            className="h-4 w-4 rounded border flex items-center justify-center transition-colors"
                            style={{
                              borderColor: selectedIds.has(doc.id) ? "var(--accent)" : "var(--border-color)",
                              background: selectedIds.has(doc.id) ? "var(--accent)" : "transparent",
                            }}
                          >
                            {selectedIds.has(doc.id) && (
                              <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="currentColor">
                                <path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                              </svg>
                            )}
                          </span>
                        </button>
                      </td>

                      {/* Name */}
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => setSelectedDoc(doc)}
                          className="flex items-center gap-2 min-w-0 text-left group hover:opacity-90 transition-opacity"
                          title={`Click to view ${doc.filename}`}
                        >
                          <svg className="h-4 w-4 shrink-0 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                          </svg>
                          <span className="truncate font-medium max-w-[200px] text-[var(--text-primary)] group-hover:text-[var(--accent)] group-hover:underline transition-colors">
                            {doc.filename}
                          </span>
                        </button>
                      </td>

                      {/* Type */}
                      <td className="hidden px-4 py-2.5 sm:table-cell">
                        <TypeBadge mimeType={doc.mimeType} />
                      </td>

                      {/* Size */}
                      <td className="hidden px-4 py-2.5 tabular-nums font-mono text-xs md:table-cell" style={{ color: "var(--text-secondary)" }}>
                        {formatBytes(doc.sizeBytes)}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-2.5">
                        <DocumentProgressRow doc={doc} workspaceId={workspaceId} onStatusChange={handleStatusChange} />
                      </td>

                      {/* Date */}
                      <td className="hidden px-4 py-2.5 text-xs lg:table-cell" style={{ color: "var(--text-muted)" }}>
                        {formatDate(doc.createdAt)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedDoc(doc)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
                            title="View document preview and extracted text"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span>View</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDownloadDoc(doc)}
                            disabled={downloadingDocId === doc.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[var(--accent-light)] disabled:opacity-50 transition-colors"
                            title="Download document file"
                          >
                            {downloadingDocId === doc.id ? (
                              <span className="inline-block w-3 h-3 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                              </svg>
                            )}
                            <span>Download</span>
                          </button>

                          {canDelete && (
                            <button
                              type="button"
                              id={`delete-doc-${doc.id}`}
                              onClick={() => setDocumentToDelete(doc)}
                              aria-label={doc.status === "DELETING" ? `Retry deleting ${doc.filename}` : `Delete ${doc.filename}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--status-failed)] hover:border-[var(--status-failed)] hover:bg-[var(--status-failed-bg)] transition-colors"
                              title={doc.status === "DELETING" ? `Retry deleting ${doc.filename}` : `Delete ${doc.filename}`}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                              </svg>
                              <span>{doc.status === "DELETING" ? "Retry Delete" : "Delete"}</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Footer */}
              <div
                className="flex items-center justify-between px-4 py-2.5 text-xs"
                style={{ borderTop: "1px solid var(--border-color)", background: "var(--bg-surface-2)", color: "var(--text-muted)" }}
              >
                <span>
                  {selectedIds.size > 0
                    ? `${selectedIds.size} of ${filteredDocs.length} selected`
                    : `${filteredDocs.length} object${filteredDocs.length !== 1 ? "s" : ""}${isFiltered ? ` of ${totalDocs} total` : ""}`}
                </span>
                {isFiltered && activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-xs font-medium hover:underline transition-opacity"
                    style={{ color: "var(--accent)" }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showUpload && workspaceId && (
        <UploadDialog workspaceId={workspaceId} onSuccess={loadDocuments} onClose={() => setShowUpload(false)} />
      )}

      {selectedDoc && workspaceId && (
        <DocumentViewerModal document={selectedDoc} workspaceId={workspaceId} onClose={() => setSelectedDoc(null)} />
      )}

      {documentToDelete && workspaceId && (
        <DeleteDocumentDialog
          document={documentToDelete}
          workspaceId={workspaceId}
          onSuccess={(deletedId) => {
            const filename = documentToDelete.filename;
            setState((prev) =>
              prev.phase === "ready"
                ? { ...prev, documents: prev.documents.filter((d) => d.id !== deletedId) }
                : prev
            );
            setSuccessNotification(`Document "${filename}" was successfully deleted.`);
            loadDocuments();
          }}
          onClose={() => setDocumentToDelete(null)}
        />
      )}

      {/* ── Bulk delete confirmation modal ── */}
      {showBulkDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setShowBulkDeleteConfirm(false)}
        >
          <div
            className="rounded-lg p-6 max-w-sm w-full space-y-4"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", boxShadow: "var(--shadow-card)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--status-failed-bg)" }}>
                <svg className="h-5 w-5" style={{ color: "var(--status-failed)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Delete {selectedIds.size} object{selectedIds.size !== 1 ? "s" : ""}?
                </h3>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  This will permanently delete the selected objects from storage. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBulkDeleteConfirm(false)}
                className="px-3 py-1.5 text-xs font-medium rounded border transition-colors cursor-pointer"
                style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)", background: "var(--bg-surface)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkDelete}
                className="px-3 py-1.5 text-xs font-medium rounded border transition-colors cursor-pointer"
                style={{ background: "var(--status-failed-bg)", borderColor: "var(--status-failed)", color: "var(--status-failed)" }}
              >
                Delete {selectedIds.size} object{selectedIds.size !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── FilterChip ─────────────────────────────────────────────────────────────────

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        background: "var(--accent-light, #fff1f2)",
        color: "var(--accent)",
        border: "1px solid var(--accent)",
      }}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="flex items-center hover:opacity-75 transition-opacity"
        aria-label={`Remove ${label} filter`}
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}
