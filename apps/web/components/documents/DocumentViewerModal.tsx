"use client";

import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import {
  getDocumentFileUrl,
  getDocumentContent,
  downloadDocument,
} from "@/lib/api";
import type { Document, DocumentContent } from "@/lib/types";

interface DocumentViewerModalProps {
  document: Document | null;
  workspaceId: string;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${bytes} B`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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
  return map[mimeType] ?? "FILE";
}

const EXT_COLORS: Record<string, { bg: string; color: string }> = {
  PDF: { bg: "#FFF1F2", color: "#BE123C" },
  DOCX: { bg: "#EFF6FF", color: "#1D4ED8" },
  PPTX: { bg: "#FFF7ED", color: "#C2410C" },
  XLSX: { bg: "#F0FDF4", color: "#15803D" },
  PNG: { bg: "#F5F3FF", color: "#7C3AED" },
  JPEG: { bg: "#F5F3FF", color: "#7C3AED" },
};

export function DocumentViewerModal({
  document: doc,
  workspaceId,
  onClose,
}: DocumentViewerModalProps) {
  const [activeTab, setActiveTab] = useState<"preview" | "content" | "metadata">("preview");
  const [contentState, setContentState] = useState<{
    loading: boolean;
    data: DocumentContent | null;
    error: string | null;
  }>({ loading: false, data: null, error: null });
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [contentSearch, setContentSearch] = useState("");

  const isPdf = doc?.mimeType === "application/pdf";
  const isImage = doc?.mimeType.startsWith("image/");
  const fileUrl = doc ? getDocumentFileUrl(workspaceId, doc.id, "inline") : "";

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Load extracted content if document is ready or processing
  useEffect(() => {
    if (!doc) return;
    setContentState({ loading: true, data: null, error: null });

    getDocumentContent(workspaceId, doc.id)
      .then((data) => {
        setContentState({ loading: false, data, error: null });
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Content not extracted yet";
        setContentState({ loading: false, data: null, error: msg });
      });
  }, [doc, workspaceId]);

  const handleDownload = async () => {
    if (!doc) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      await downloadDocument(workspaceId, doc);
    } catch (err: any) {
      setDownloadError(err?.message || "Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyContent = () => {
    if (!contentState.data?.text) return;
    navigator.clipboard.writeText(contentState.data.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredText = useMemo(() => {
    if (!contentState.data?.text) return "";
    if (!contentSearch.trim()) return contentState.data.text;
    return contentState.data.text;
  }, [contentState.data?.text, contentSearch]);

  if (!doc) return null;

  const ext = mimeToExt(doc.mimeType);
  const extStyle = EXT_COLORS[ext] ?? { bg: "var(--status-default-bg)", color: "var(--status-default)" };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="viewer-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex flex-col w-full max-w-5xl h-[90vh] bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[var(--sidebar-bg)] border-b border-[var(--border-color)] text-white">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="inline-flex items-center rounded px-2 py-0.5 text-xs font-bold shrink-0 tracking-wider"
              style={{ background: extStyle.bg, color: extStyle.color }}
            >
              {ext}
            </span>
            <div className="min-w-0">
              <h2
                id="viewer-modal-title"
                className="text-sm font-semibold text-white truncate max-w-md sm:max-w-xl"
                title={doc.filename}
              >
                {doc.filename}
              </h2>
              <div className="flex items-center gap-2 text-xs text-gray-300 mt-0.5">
                <span>{formatBytes(doc.sizeBytes)}</span>
                <span>•</span>
                <StatusBadge status={doc.status} />
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Direct Open in New Tab */}
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Open raw file in a new browser tab"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              <span className="hidden sm:inline">Open in Tab</span>
            </a>

            {/* Direct Download */}
            <Button
              variant="primary"
              size="sm"
              onClick={handleDownload}
              disabled={isDownloading}
              startIcon={
                isDownloading ? (
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                )
              }
            >
              {isDownloading ? "Downloading…" : "Download"}
            </Button>

            {/* Close Button */}
            <button
              onClick={onClose}
              aria-label="Close document viewer"
              className="p-1.5 text-gray-300 hover:text-white rounded hover:bg-white/10 transition-colors ml-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab Switcher Bar */}
        <div className="flex items-center justify-between px-5 border-b border-[var(--border-color)] bg-[var(--bg-surface-2)]">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab("preview")}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === "preview"
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              File Preview
            </button>
            <button
              onClick={() => setActiveTab("content")}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === "content"
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Extracted Content {contentState.data?.charCount ? `(${contentState.data.charCount.toLocaleString()} chars)` : ""}
            </button>
            <button
              onClick={() => setActiveTab("metadata")}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === "metadata"
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Details & Storage Info
            </button>
          </div>

          {downloadError && (
            <span className="text-xs text-[var(--status-failed)] font-medium">
              {downloadError}
            </span>
          )}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-auto bg-[var(--bg-surface)] p-4 sm:p-5">
          {/* TAB 1: FILE PREVIEW */}
          {activeTab === "preview" && (
            <div className="h-full flex flex-col justify-center">
              {isPdf ? (
                <div className="h-full w-full rounded-lg overflow-hidden border border-[var(--border-color)] bg-neutral-900 shadow-inner">
                  <iframe
                    src={fileUrl}
                    title={doc.filename}
                    className="w-full h-full border-0"
                  />
                </div>
              ) : isImage ? (
                <div className="h-full w-full flex items-center justify-center p-4 bg-neutral-900 rounded-lg overflow-auto border border-[var(--border-color)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={fileUrl}
                    alt={doc.filename}
                    className="max-h-full max-w-full object-contain rounded shadow-lg"
                  />
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 max-w-lg mx-auto">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-md"
                    style={{ background: extStyle.bg, color: extStyle.color }}
                  >
                    <span className="text-xl font-bold tracking-wider">{ext}</span>
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-[var(--text-primary)]">
                      {doc.filename}
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Native in-browser preview is available for PDF and images. For {ext} files, you can download the original file or view the extracted text below.
                    </p>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <Button variant="primary" size="sm" onClick={handleDownload} disabled={isDownloading}>
                      Download Original ({formatBytes(doc.sizeBytes)})
                    </Button>
                    {contentState.data?.text && (
                      <Button variant="secondary" size="sm" onClick={() => setActiveTab("content")}>
                        Read Extracted Text →
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: EXTRACTED CONTENT */}
          {activeTab === "content" && (
            <div className="h-full flex flex-col space-y-3">
              {/* Toolbar */}
              <div className="flex items-center justify-between gap-3 flex-wrap pb-2 border-b border-[var(--border-color)]">
                <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                  {contentState.data?.pageCount ? (
                    <span className="px-2 py-0.5 rounded bg-[var(--bg-surface-2)] text-[var(--text-primary)] font-medium">
                      Pages: {contentState.data.pageCount}
                    </span>
                  ) : null}
                  {contentState.data?.charCount ? (
                    <span className="px-2 py-0.5 rounded bg-[var(--bg-surface-2)] text-[var(--text-primary)] font-medium">
                      Characters: {contentState.data.charCount.toLocaleString()}
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="search"
                    placeholder="Search in text…"
                    value={contentSearch}
                    onChange={(e) => setContentSearch(e.target.value)}
                    className="h-7 w-44 rounded border border-[var(--border-color)] bg-[var(--bg-surface-2)] px-2.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                  {contentState.data?.text && (
                    <button
                      onClick={handleCopyContent}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-[var(--border-color)] bg-[var(--bg-surface-2)] text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
                      title="Copy all extracted text"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v2.25A2.25 2.25 0 0113.5 21.75h-7.5A2.25 2.25 0 013.75 19.5V7.5a2.25 2.25 0 012.25-2.25h2.25m4.5 0h6.75A2.25 2.25 0 0121.75 7.5v9a2.25 2.25 0 01-2.25 2.25h-2.25" />
                      </svg>
                      <span>{copied ? "Copied!" : "Copy Text"}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Text viewer */}
              <div className="flex-1 overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface-2)] p-4 font-mono text-xs leading-relaxed text-[var(--text-primary)] select-text whitespace-pre-wrap">
                {contentState.loading ? (
                  <div className="flex h-40 items-center justify-center">
                    <Spinner label="Loading extracted content…" />
                  </div>
                ) : contentState.error ? (
                  <div className="text-center py-10 text-[var(--text-muted)] space-y-2">
                    <p className="font-semibold text-[var(--status-failed)]">{contentState.error}</p>
                    <p className="text-xs">
                      Document content extraction runs during processing. Once status is READY, the full parsed text will appear here.
                    </p>
                  </div>
                ) : filteredText ? (
                  filteredText
                ) : (
                  <p className="text-[var(--text-muted)] text-center py-10">No content available.</p>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: DETAILS & METADATA */}
          {activeTab === "metadata" && (
            <div className="max-w-2xl mx-auto space-y-4 py-2">
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface-2)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border-color)] font-semibold text-xs text-[var(--text-primary)]">
                  Object Properties
                </div>
                <dl className="divide-y divide-[var(--border-color)] text-xs">
                  <div className="px-4 py-2.5 flex justify-between">
                    <dt className="text-[var(--text-muted)]">Document ID</dt>
                    <dd className="font-mono text-[var(--text-primary)] select-all">{doc.id}</dd>
                  </div>
                  <div className="px-4 py-2.5 flex justify-between">
                    <dt className="text-[var(--text-muted)]">Filename</dt>
                    <dd className="font-medium text-[var(--text-primary)]">{doc.filename}</dd>
                  </div>
                  <div className="px-4 py-2.5 flex justify-between">
                    <dt className="text-[var(--text-muted)]">MIME Type</dt>
                    <dd className="font-mono text-[var(--text-secondary)]">{doc.mimeType}</dd>
                  </div>
                  <div className="px-4 py-2.5 flex justify-between">
                    <dt className="text-[var(--text-muted)]">File Size</dt>
                    <dd className="font-mono text-[var(--text-primary)]">{formatBytes(doc.sizeBytes)} ({doc.sizeBytes.toLocaleString()} bytes)</dd>
                  </div>
                  <div className="px-4 py-2.5 flex justify-between">
                    <dt className="text-[var(--text-muted)]">Storage Key</dt>
                    <dd className="font-mono text-[var(--text-secondary)] truncate max-w-xs select-all" title={doc.storageKey}>{doc.storageKey}</dd>
                  </div>
                  <div className="px-4 py-2.5 flex justify-between">
                    <dt className="text-[var(--text-muted)]">SHA-256 Checksum</dt>
                    <dd className="font-mono text-[var(--text-secondary)] truncate max-w-xs select-all" title={doc.sha256 || "Pending"}>{doc.sha256 || "—"}</dd>
                  </div>
                  <div className="px-4 py-2.5 flex justify-between">
                    <dt className="text-[var(--text-muted)]">Uploaded At</dt>
                    <dd className="text-[var(--text-secondary)]">{formatDate(doc.createdAt)}</dd>
                  </div>
                  <div className="px-4 py-2.5 flex justify-between">
                    <dt className="text-[var(--text-muted)]">Workspace ID</dt>
                    <dd className="font-mono text-[var(--text-secondary)] select-all">{doc.workspaceId}</dd>
                  </div>
                </dl>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" size="sm" onClick={() => window.open(fileUrl, "_blank")}>
                  Open Direct Link
                </Button>
                <Button variant="primary" size="sm" onClick={handleDownload} disabled={isDownloading}>
                  Download File
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
