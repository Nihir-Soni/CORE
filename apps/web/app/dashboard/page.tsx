"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getWorkspace, getDocuments, downloadDocument, getMe } from "@/lib/api";
import { getWorkspaceId, getCurrentUser } from "@/lib/auth";

const WORKSPACE_CHANGED_EVENT = "core_workspace_changed";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/Badge";
import { DocumentViewerModal } from "@/components/documents/DocumentViewerModal";
import type { Workspace, Document } from "@/lib/types";

// ── Storage breakdown helpers ─────────────────────────────────────────────────

const MIME_CATEGORIES: { label: string; test: (m: string) => boolean; color: string }[] = [
  { label: "PDF",    test: (m) => m === "application/pdf",                                      color: "#e53e3e" },
  { label: "Word",   test: (m) => m.includes("wordprocessingml") || m === "application/msword", color: "#3b82f6" },
  { label: "Text",   test: (m) => m.startsWith("text/"),                                        color: "#10b981" },
  { label: "Image",  test: (m) => m.startsWith("image/"),                                       color: "#f59e0b" },
];

function mimeCategory(mimeType: string): string {
  for (const cat of MIME_CATEGORIES) if (cat.test(mimeType)) return cat.label;
  return "Other";
}

const CATEGORY_COLOR: Record<string, string> = Object.fromEntries(
  MIME_CATEGORIES.map((c) => [c.label, c.color])
);
CATEGORY_COLOR["Other"] = "#6b7280";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; workspace: Workspace; documents: Document[] };

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${bytes} B`;
}

function getInitials(name?: string | null, email?: string | null): string {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email && email.trim().length > 0) {
    return email.slice(0, 2).toUpperCase();
  }
  return "U";
}

export default function DashboardPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(() => getCurrentUser()?.name ?? null);
  const [userEmail, setUserEmail] = useState<string | null>(() => getCurrentUser()?.email ?? null);
  const workspaceId = getWorkspaceId() ?? "";

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

  useEffect(() => {
    let cancelled = false;

    const loadData = () => {
      const currentWorkspaceId = getWorkspaceId();
      if (!currentWorkspaceId) {
        setState({ phase: "error", message: "Workspace not found." });
        return;
      }

      Promise.all([getWorkspace(currentWorkspaceId), getDocuments(currentWorkspaceId)])
        .then(([workspace, documents]) => {
          if (!cancelled) setState({ phase: "ready", workspace, documents });
        })
        .catch(() => {
          if (!cancelled) setState({ phase: "error", message: "Unable to load workspace." });
        });
    };

    const current = getCurrentUser();
    if (current) {
      if (current.name) setUserName(current.name);
      if (current.email) setUserEmail(current.email);
    }

    getMe()
      .then((profile) => {
        if (profile.name) setUserName(profile.name);
        if (profile.email) setUserEmail(profile.email);
      })
      .catch(() => {
        // Fallback to token decoded data
      });

    loadData();

    window.addEventListener(WORKSPACE_CHANGED_EVENT, loadData);
    return () => {
      cancelled = true;
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, loadData);
    };
  }, []);

  if (state.phase === "loading") {
    return (
      <div className="flex h-48 items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div
        className="rounded p-4 flex items-start gap-2"
        style={{ background: "var(--status-failed-bg)", border: "1px solid var(--accent-border)" }}
      >
        <svg className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--status-failed)" }} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
        </svg>
        <p role="alert" className="text-sm" style={{ color: "var(--status-failed)" }}>
          {state.message}
        </p>
      </div>
    );
  }

  const { workspace, documents } = state;
  const totalCount = documents.length;
  const totalSize = documents.reduce((acc, d) => acc + d.sizeBytes, 0);
  const readyCount = documents.filter((d) => d.status === "READY").length;
  const uploadedCount = documents.filter((d) =>
    d.status === "UPLOADED" || d.status === "PROCESSING" || d.status === "READY" || d.status === "FAILED"
  ).length;
  const recentDocs = [...documents].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  ).slice(0, 5);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Page title & User Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b" style={{ borderColor: "var(--border-color)" }}>
        <div>
          <h1
            id="dashboard-title"
            className="text-xl font-bold tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            {userName ? `Welcome back, ${userName}` : "Dashboard"}
          </h1>
          <p className="text-sm mt-0.5 flex flex-wrap items-center gap-x-2" style={{ color: "var(--text-muted)" }}>
            <span>
              Workspace:{" "}
              <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
                {workspace.name}
              </span>
            </span>
            {userEmail && (
              <>
                <span className="text-xs opacity-50">•</span>
                <span className="text-xs">
                  Signed in as{" "}
                  <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
                    {userEmail}
                  </span>
                </span>
              </>
            )}
          </p>
        </div>

        {/* User profile badge */}
        <div
          id="user-profile-badge"
          className="flex items-center gap-3 px-3.5 py-2 rounded-lg border self-start sm:self-auto shrink-0 shadow-sm"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border-color)",
          }}
        >
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0"
            style={{ background: "var(--accent)" }}
            aria-hidden="true"
          >
            {getInitials(userName, userEmail)}
          </div>
          <div className="min-w-0 pr-1">
            <p
              id="user-display-name"
              className="text-xs font-semibold truncate leading-tight"
              style={{ color: "var(--text-primary)" }}
            >
              {userName || "User"}
            </p>
            <p
              id="user-display-email"
              className="text-[11px] truncate leading-tight mt-0.5"
              style={{ color: "var(--text-muted)" }}
            >
              {userEmail || ""}
            </p>
          </div>
        </div>
      </div>

      {/* Stats — MinIO console metric cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Total Objects" value={String(totalCount)} />
        <MetricCard label="Total Size" value={formatBytes(totalSize)} />
        <MetricCard label="Ready" value={String(readyCount)} highlight />
        <MetricCard label="Uploaded" value={String(uploadedCount)} />
      </div>

      {/* Storage Usage */}
      <StorageUsageCard documents={documents} totalSize={totalSize} />

      {/* Recent objects panel */}
      <div
        className="rounded overflow-hidden"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-color)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        {/* Panel header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border-color)" }}
        >
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Recent Objects
          </h2>
          <Link
            href="/dashboard/documents"
            className="text-xs font-medium transition-colors hover:underline"
            style={{ color: "var(--accent)" }}
          >
            Browse all →
          </Link>
        </div>

        {recentDocs.length === 0 ? (
          <div className="py-12 text-center">
            <div
              className="mx-auto h-10 w-10 rounded-full flex items-center justify-center mb-3"
              style={{ background: "var(--bg-surface-2)" }}
            >
              <svg className="h-5 w-5" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </div>
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              No objects found
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Upload your first document from the{" "}
              <Link href="/dashboard/documents" className="hover:underline" style={{ color: "var(--accent)" }}>
                Object Browser
              </Link>.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                {[
                  { label: "Object Name", className: "" },
                  { label: "Size", className: "" },
                  { label: "Status", className: "" },
                  { label: "Actions", className: "text-right" },
                ].map((col) => (
                  <th
                    key={col.label}
                    className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider ${col.className || "text-left"}`}
                    style={{ color: "var(--text-muted)" }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentDocs.map((doc, i) => (
                <tr
                  key={doc.id}
                  style={{
                    borderBottom:
                      i < recentDocs.length - 1 ? "1px solid var(--border-subtle)" : "none",
                  }}
                  className="transition-colors"
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--bg-surface-2)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  {/* Name - Clickable */}
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
                      <span
                        className="truncate font-medium max-w-[220px] text-[var(--text-primary)] group-hover:text-[var(--accent)] group-hover:underline transition-colors"
                      >
                        {doc.filename}
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {formatBytes(doc.sizeBytes)}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={doc.status} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedDoc(doc)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
                        title="View document preview and details"
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
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedDoc && workspaceId && (
        <DocumentViewerModal
          document={selectedDoc}
          workspaceId={workspaceId}
          onClose={() => setSelectedDoc(null)}
        />
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="rounded p-4"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-color)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <p className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p
        className="mt-1.5 text-2xl font-bold tabular-nums"
        style={{ color: highlight ? "var(--accent)" : "var(--text-primary)" }}
      >
        {value}
      </p>
    </div>
  );
}

function StorageUsageCard({ documents, totalSize }: { documents: Document[]; totalSize: number }) {
  // Build per-category byte totals
  const breakdown = documents.reduce<Record<string, number>>((acc, doc) => {
    const cat = mimeCategory(doc.mimeType);
    acc[cat] = (acc[cat] ?? 0) + doc.sizeBytes;
    return acc;
  }, {});

  const segments = Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([label, bytes]) => ({
      label,
      bytes,
      pct: totalSize > 0 ? (bytes / totalSize) * 100 : 0,
      color: CATEGORY_COLOR[label] ?? "#6b7280",
    }));

  const largestDoc = [...documents].sort((a, b) => b.sizeBytes - a.sizeBytes)[0] ?? null;

  return (
    <div
      className="rounded overflow-hidden"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-color)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75M3.75 10.125v3.75" />
          </svg>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Storage Usage
          </h2>
        </div>
        <span
          className="text-xs font-semibold tabular-nums"
          style={{ color: "var(--text-secondary)" }}
        >
          {formatBytes(totalSize)} used
        </span>
      </div>

      <div className="px-4 py-4 space-y-4">
        {totalSize === 0 ? (
          <p className="text-sm text-center py-2" style={{ color: "var(--text-muted)" }}>
            No data stored yet.
          </p>
        ) : (
          <>
            {/* Stacked bar */}
            <div className="relative h-3 w-full rounded-full overflow-hidden" style={{ background: "var(--bg-surface-2, #f1f5f9)" }}>
              <div className="absolute inset-y-0 left-0 flex h-full w-full">
                {segments.map((seg) => (
                  <div
                    key={seg.label}
                    title={`${seg.label}: ${formatBytes(seg.bytes)} (${seg.pct.toFixed(1)}%)`}
                    style={{ width: `${seg.pct}%`, background: seg.color, minWidth: seg.pct > 0 ? "2px" : "0" }}
                  />
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {segments.map((seg) => (
                <div key={seg.label} className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ background: seg.color }}
                    aria-hidden="true"
                  />
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {seg.label}
                  </span>
                  <span className="text-xs font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {formatBytes(seg.bytes)}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    ({seg.pct.toFixed(0)}%)
                  </span>
                </div>
              ))}
            </div>

            {/* Footer — object count + largest file */}
            <div
              className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs"
              style={{ borderTop: "1px solid var(--border-subtle, var(--border-color))", color: "var(--text-muted)" }}
            >
              <span>
                {documents.length} object{documents.length !== 1 ? "s" : ""} across{" "}
                {Object.keys(breakdown).length} type{Object.keys(breakdown).length !== 1 ? "s" : ""}
              </span>
              {largestDoc && (
                <span className="truncate max-w-[260px]" title={largestDoc.filename}>
                  Largest: <span style={{ color: "var(--text-secondary)" }}>{largestDoc.filename}</span>{" "}
                  <span className="font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>
                    ({formatBytes(largestDoc.sizeBytes)})
                  </span>
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
