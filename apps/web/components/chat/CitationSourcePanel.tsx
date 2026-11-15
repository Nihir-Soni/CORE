"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { getDocumentContent, getDocumentFileUrl, downloadDocument } from "@/lib/api";
import type { Citation, Document, DocumentContent } from "@/lib/types";

export interface CitationSourcePanelProps {
  citation: Citation | null;
  citationIndex: number;
  workspaceId: string;
  onClose: () => void;
  onOpenDocument?: (doc: Document) => void;
  availableDocuments?: Document[];
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${bytes} B`;
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

export function CitationSourcePanel({
  citation,
  citationIndex,
  workspaceId,
  onClose,
  onOpenDocument,
  availableDocuments = [],
}: CitationSourcePanelProps) {
  const [contentState, setContentState] = useState<{
    loading: boolean;
    data: DocumentContent | null;
    error: string | null;
  }>({ loading: false, data: null, error: null });

  const [searchInText, setSearchInText] = useState("");
  const [copiedPassage, setCopiedPassage] = useState(false);
  const [copiedFullText, setCopiedFullText] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const textContainerRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Load full extracted content for the document
  useEffect(() => {
    if (!citation || !workspaceId) return;

    let cancelled = false;
    setContentState({ loading: true, data: null, error: null });

    getDocumentContent(workspaceId, citation.documentId)
      .then((data) => {
        if (!cancelled) {
          setContentState({ loading: false, data, error: null });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Unable to load document content";
          setContentState({ loading: false, data: null, error: msg });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [citation?.documentId, workspaceId]);

  // Resolve matching Document from available documents list
  const matchedDoc = useMemo(() => {
    if (!citation) return null;
    return availableDocuments.find((d) => d.id === citation.documentId) ?? null;
  }, [citation, availableDocuments]);

  // Download handler
  const handleDownload = async () => {
    if (!citation) return;
    setIsDownloading(true);
    try {
      await downloadDocument(workspaceId, {
        id: citation.documentId,
        filename: citation.filename,
      });
    } catch (err) {
      console.error("Failed to download document:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyPassage = () => {
    const passage = citation?.content || "";
    if (!passage) return;
    navigator.clipboard.writeText(passage);
    setCopiedPassage(true);
    setTimeout(() => setCopiedPassage(false), 2000);
  };

  const handleCopyFullText = () => {
    const fullText = contentState.data?.text || citation?.content || "";
    if (!fullText) return;
    navigator.clipboard.writeText(fullText);
    setCopiedFullText(true);
    setTimeout(() => setCopiedFullText(false), 2000);
  };

  const scrollToHighlightedPassage = () => {
    const el = document.getElementById("matching-citation-passage");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  // Auto-scroll to matching passage when extracted text loads
  useEffect(() => {
    if (contentState.data?.text && citation?.content) {
      const timer = setTimeout(() => {
        const el = document.getElementById("matching-citation-passage");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [contentState.data?.text, citation?.content]);

  // Render original extracted text with matching passage highlighted
  const renderedExtractedText = useMemo(() => {
    const rawText = contentState.data?.text || "";
    if (!rawText) return null;

    // Search filter active: highlight searched word
    if (searchInText.trim()) {
      const query = searchInText.trim();
      const regex = new RegExp(`(${escapeRegex(query)})`, "gi");
      const parts = rawText.split(regex);
      return parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="rounded px-0.5 font-bold"
            style={{
              background: "var(--accent-light, #fff1f2)",
              color: "var(--accent)",
            }}
          >
            {part}
          </mark>
        ) : (
          part
        )
      );
    }

    // Highlight matching passage inside original extracted text
    const passage = citation?.content?.trim() || "";
    if (passage) {
      const idx = rawText.indexOf(passage);
      if (idx !== -1) {
        const before = rawText.slice(0, idx);
        const match = rawText.slice(idx, idx + passage.length);
        const after = rawText.slice(idx + passage.length);
        return (
          <>
            {before}
            <mark
              id="matching-citation-passage"
              className="rounded px-1.5 py-0.5 font-semibold transition-all inline"
              style={{
                background: "var(--accent-light, #fff1f2)",
                color: "var(--accent)",
                borderLeft: "3px solid var(--accent)",
                boxShadow: "0 0 0 1px var(--accent)",
              }}
            >
              {match}
            </mark>
            {after}
          </>
        );
      }

      // If full passage not exact due to whitespace, try first 70 characters
      const leadSnippet = passage.slice(0, Math.min(70, passage.length)).trim();
      const leadIdx = leadSnippet.length > 15 ? rawText.indexOf(leadSnippet) : -1;
      if (leadIdx !== -1) {
        const approxEnd = Math.min(rawText.length, leadIdx + passage.length);
        const before = rawText.slice(0, leadIdx);
        const match = rawText.slice(leadIdx, approxEnd);
        const after = rawText.slice(approxEnd);
        return (
          <>
            {before}
            <mark
              id="matching-citation-passage"
              className="rounded px-1.5 py-0.5 font-semibold transition-all inline"
              style={{
                background: "var(--accent-light, #fff1f2)",
                color: "var(--accent)",
                borderLeft: "3px solid var(--accent)",
                boxShadow: "0 0 0 1px var(--accent)",
              }}
            >
              {match}
            </mark>
            {after}
          </>
        );
      }
    }

    return rawText;
  }, [contentState.data?.text, searchInText, citation?.content]);

  if (!citation) return null;

  const fileUrl = getDocumentFileUrl(workspaceId, citation.documentId, "inline");
  const ext = matchedDoc ? mimeToExt(matchedDoc.mimeType) : "DOC";
  const extStyle = EXT_COLORS[ext] ?? { bg: "var(--status-default-bg)", color: "var(--status-default)" };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Source citation [${citationIndex + 1}]: ${citation.filename}`}
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex flex-col w-full sm:w-[500px] md:w-[560px] h-full shadow-2xl border-l transition-transform animate-slide-in-right overflow-hidden"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--border-color)",
        }}
      >
        {/* ── Top Header ── */}
        <div
          className="flex items-start justify-between p-4 border-b shrink-0"
          style={{
            background: "var(--bg-surface-2)",
            borderColor: "var(--border-color)",
          }}
        >
          <div className="flex items-start gap-3 min-w-0 pr-2">
            <span
              className="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-bold shrink-0 mt-0.5 tracking-wider"
              style={{ background: extStyle.bg, color: extStyle.color }}
            >
              [{citationIndex + 1}]
            </span>
            <div className="min-w-0">
              <h2
                className="text-sm font-bold truncate leading-tight"
                style={{ color: "var(--text-primary)" }}
                title={citation.filename}
              >
                {citation.filename}
              </h2>

              <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs">
                {/* Relevant page number */}
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium text-[11px]"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-color)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <svg className="w-3 h-3 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  {citation.pageNumber ? `Page ${citation.pageNumber}` : `Page: 1`}
                </span>

                {/* Similarity relevance */}
                {citation.similarity > 0 && (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold"
                    style={{
                      background: "var(--status-ready-bg)",
                      color: "var(--status-ready)",
                    }}
                  >
                    {(citation.similarity * 100).toFixed(0)}% Match
                  </span>
                )}

                {matchedDoc?.sizeBytes && (
                  <span style={{ color: "var(--text-muted)" }}>
                    {formatBytes(matchedDoc.sizeBytes)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source panel"
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Document Actions Bar ── */}
        <div
          className="flex items-center justify-between gap-2 px-4 py-2.5 border-b flex-wrap shrink-0"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border-color)",
          }}
        >
          <div className="flex items-center gap-2">
            {/* Primary: Button to open the document in viewer */}
            {matchedDoc && onOpenDocument ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onOpenDocument(matchedDoc);
                  onClose();
                }}
                startIcon={
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                }
              >
                Open Document
              </Button>
            ) : (
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
                Open Document
              </a>
            )}

            {/* Direct Open in new tab */}
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border transition-colors"
              style={{
                borderColor: "var(--border-color)",
                background: "var(--bg-surface-2)",
                color: "var(--text-secondary)",
              }}
              title="Open raw document in a new browser tab"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              <span>New Tab</span>
            </a>
          </div>

          {/* Download button */}
          <button
            type="button"
            onClick={handleDownload}
            disabled={isDownloading}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border transition-colors disabled:opacity-50 cursor-pointer"
            style={{
              borderColor: "var(--border-color)",
              background: "var(--bg-surface-2)",
              color: "var(--text-secondary)",
            }}
            title="Download original file"
          >
            {isDownloading ? (
              <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            )}
            <span>Download</span>
          </button>
        </div>

        {/* ── Scrollable Body ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* 1. Highlighted Matching Passage Card */}
          <div
            className="rounded-lg border overflow-hidden"
            style={{
              borderColor: "var(--accent)",
              background: "var(--bg-surface)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-3.5 py-2 border-b"
              style={{
                background: "var(--accent-light, #fff1f2)",
                borderColor: "var(--accent)",
              }}
            >
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-[var(--accent)]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
                </svg>
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
                  Highlighted Matching Passage
                </span>
              </div>

              {citation.content && (
                <button
                  type="button"
                  onClick={handleCopyPassage}
                  className="flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:opacity-75 transition-opacity cursor-pointer"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v2.25A2.25 2.25 0 0113.5 21.75h-7.5A2.25 2.25 0 013.75 19.5V7.5a2.25 2.25 0 012.25-2.25h2.25m4.5 0h6.75A2.25 2.25 0 0121.75 7.5v9a2.25 2.25 0 01-2.25 2.25h-2.25" />
                  </svg>
                  <span>{copiedPassage ? "Copied!" : "Copy Passage"}</span>
                </button>
              )}
            </div>

            {/* Passage Body */}
            <div className="p-3.5 text-xs leading-relaxed font-mono whitespace-pre-wrap select-text" style={{ color: "var(--text-primary)" }}>
              {citation.content ? (
                <div
                  className="p-2.5 rounded border-l-3"
                  style={{
                    background: "var(--accent-light, #fff1f2)",
                    borderLeftColor: "var(--accent)",
                  }}
                >
                  {citation.content}
                </div>
              ) : (
                <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>
                  Retrieval chunk metadata available. Load the full extracted text below to explore.
                </p>
              )}
            </div>

            {/* Jump to passage in full text button */}
            {contentState.data?.text && citation.content && (
              <div
                className="px-3.5 py-1.5 border-t text-right"
                style={{
                  background: "var(--bg-surface-2)",
                  borderColor: "var(--border-color)",
                }}
              >
                <button
                  type="button"
                  onClick={scrollToHighlightedPassage}
                  className="text-[11px] font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>Locate in Full Extracted Text</span>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* 2. Original Extracted Text Section */}
          <div
            className="rounded-lg border flex flex-col overflow-hidden"
            style={{
              borderColor: "var(--border-color)",
              background: "var(--bg-surface)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-3.5 py-2 border-b flex-wrap gap-2"
              style={{
                background: "var(--bg-surface-2)",
                borderColor: "var(--border-color)",
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-primary)" }}>
                  Original Extracted Text
                </span>
                {contentState.data?.charCount ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--bg-surface)", color: "var(--text-muted)", border: "1px solid var(--border-color)" }}>
                    {contentState.data.charCount.toLocaleString()} chars
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                {/* Search in document */}
                <input
                  type="search"
                  placeholder="Find in text…"
                  value={searchInText}
                  onChange={(e) => setSearchInText(e.target.value)}
                  className="h-6 w-32 rounded border px-2 text-[11px] outline-none transition-colors"
                  style={{
                    background: "var(--bg-surface)",
                    borderColor: "var(--border-color)",
                    color: "var(--text-primary)",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-color)")}
                />

                {/* Copy Full Text button */}
                <button
                  type="button"
                  onClick={handleCopyFullText}
                  className="flex items-center gap-1 text-[11px] font-medium hover:opacity-75 transition-opacity cursor-pointer"
                  style={{ color: "var(--text-secondary)" }}
                  title="Copy full extracted text"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v2.25A2.25 2.25 0 0113.5 21.75h-7.5A2.25 2.25 0 013.75 19.5V7.5a2.25 2.25 0 012.25-2.25h2.25m4.5 0h6.75A2.25 2.25 0 0121.75 7.5v9a2.25 2.25 0 01-2.25 2.25h-2.25" />
                  </svg>
                  <span>{copiedFullText ? "Copied!" : "Copy"}</span>
                </button>
              </div>
            </div>

            {/* Viewer Area */}
            <div
              ref={textContainerRef}
              className="p-3.5 max-h-[380px] overflow-y-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text"
              style={{
                background: "var(--bg-surface-2)",
                color: "var(--text-primary)",
              }}
            >
              {contentState.loading ? (
                <div className="flex h-36 items-center justify-center">
                  <Spinner label="Loading original extracted text…" />
                </div>
              ) : contentState.error ? (
                <div className="py-6 text-center space-y-1.5">
                  <p className="text-xs font-semibold" style={{ color: "var(--status-failed)" }}>
                    {contentState.error}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Full extracted text is available for processed READY documents.
                  </p>
                </div>
              ) : renderedExtractedText ? (
                renderedExtractedText
              ) : (
                <p className="text-[11px] text-center py-6" style={{ color: "var(--text-muted)" }}>
                  No extracted content available for this document.
                </p>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
