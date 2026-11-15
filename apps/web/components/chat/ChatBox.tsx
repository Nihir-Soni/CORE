"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useChatStream } from "@/hooks/use-chat-stream";
import { Button } from "@/components/ui/Button";
import { FormattedMessage } from "./FormattedMessage";
import { CitationSourcePanel } from "./CitationSourcePanel";
import { DocumentViewerModal } from "@/components/documents/DocumentViewerModal";
import { getWorkspaceId } from "@/lib/auth";
import { exportChatSession } from "@/lib/chat-history";
import type { Document, Citation } from "@/lib/types";

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations: ReturnType<typeof useChatStream>["state"]["citations"];
};

export interface ChatBoxProps {
  documents?: Document[];
  initialMessages?: Message[];
  activeSessionId?: string | null;
  activeSessionTitle?: string;
  initialSelectedDocumentIds?: string[];
  onMessagesChange?: (messages: Message[], selectedDocumentIds?: string[]) => void;
  onScopeChange?: (selectedDocumentIds: string[]) => void;
  onNewChat?: () => void;
  isHistoryOpen?: boolean;
  onToggleHistory?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${bytes} B`;
}

export function ChatBox({
  documents = [],
  initialMessages = [],
  activeSessionId,
  activeSessionTitle,
  initialSelectedDocumentIds = [],
  onMessagesChange,
  onScopeChange,
  onNewChat,
  isHistoryOpen,
  onToggleHistory,
}: ChatBoxProps) {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<{ citation: Citation; index: number } | null>(null);
  const [viewerDoc, setViewerDoc] = useState<Document | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Document selection scope
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(initialSelectedDocumentIds);
  const [isScopeMenuOpen, setIsScopeMenuOpen] = useState(false);
  const [docSearchQuery, setDocSearchQuery] = useState("");

  const updateSelectedDocIds = (updater: string[] | ((prev: string[]) => string[])) => {
    setSelectedDocIds((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      onScopeChange?.(next);
      return next;
    });
  };

  const workspaceId = getWorkspaceId() ?? "";
  const { state, sendMessage, cancel } = useChatStream();

  const readyDocuments = useMemo(() => documents.filter((d) => d.status === "READY"), [documents]);
  const readyCount = readyDocuments.length;
  const processingCount = documents.filter((document) =>
    ["UPLOADING", "UPLOADED", "PROCESSING"].includes(document.status),
  ).length;
  const isWorking = state.status === "connecting" || state.status === "streaming";

  const onMessagesChangeRef = useRef(onMessagesChange);
  onMessagesChangeRef.current = onMessagesChange;

  const lastLoadedSessionIdRef = useRef<string | null | undefined>(activeSessionId);
  const isSelfUpdatingSessionRef = useRef(false);
  const streamCompletedHandledRef = useRef(true);

  // Filtered documents inside the scope selector
  const filteredDocList = useMemo(() => {
    if (!docSearchQuery.trim()) return documents;
    const q = docSearchQuery.toLowerCase();
    return documents.filter((d) => d.filename.toLowerCase().includes(q));
  }, [documents, docSearchQuery]);

  // Sync with session changes (when user explicitly picks another session or clicks New Chat)
  useEffect(() => {
    if (isSelfUpdatingSessionRef.current) {
      isSelfUpdatingSessionRef.current = false;
      lastLoadedSessionIdRef.current = activeSessionId;
      return;
    }

    if (lastLoadedSessionIdRef.current !== activeSessionId) {
      lastLoadedSessionIdRef.current = activeSessionId;
      setMessages(initialMessages || []);
      setSelectedDocIds(initialSelectedDocumentIds || []);
      setActiveAssistantId(null);
    }
  }, [activeSessionId, initialMessages, initialSelectedDocumentIds]);

  useEffect(() => {
    if (state.status === "streaming" || state.status === "connecting") {
      streamCompletedHandledRef.current = false;
    }

    if (
      (state.status === "complete" || state.status === "error") &&
      !streamCompletedHandledRef.current
    ) {
      streamCompletedHandledRef.current = true;

      const finalText =
        state.answer ||
        (state.status === "error"
          ? state.error || "Failed to receive answer."
          : "");

      setMessages((previous) => {
        const last = previous[previous.length - 1];
        if (!last || last.role !== "assistant") return previous;

        const targetId = activeAssistantId ?? last.id;
        const updated = previous.map((message) =>
          message.id === targetId
            ? {
                ...message,
                text: finalText || message.text,
                citations: state.citations.length > 0 ? state.citations : message.citations,
              }
            : message,
        );

        isSelfUpdatingSessionRef.current = true;
        queueMicrotask(() => {
          onMessagesChangeRef.current?.(updated, selectedDocIds);
        });

        return updated;
      });

      setActiveAssistantId(null);
    }
  }, [state.status, state.answer, state.citations, state.error, activeAssistantId, selectedDocIds]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !query.trim() ||
      state.status === "connecting" ||
      state.status === "streaming"
    ) {
      return;
    }
    const submittedQuery = query.trim();
    const assistantId = `${Date.now()}-assistant`;
    const updatedMessages: Message[] = [
      ...messages,
      { id: `${Date.now()}-user`, role: "user", text: submittedQuery, citations: [] },
      { id: assistantId, role: "assistant", text: "", citations: [] },
    ];
    setMessages(updatedMessages);
    setActiveAssistantId(assistantId);
    setQuery("");
    sendMessage(submittedQuery, {
      documentIds: selectedDocIds.length > 0 ? selectedDocIds : undefined,
    });
  };

  const renderedMessages = messages.map((message, idx) => {
    const isTarget = activeAssistantId
      ? message.id === activeAssistantId
      : idx === messages.length - 1 && message.role === "assistant" && isWorking;

    if (isTarget) {
      return {
        ...message,
        text: state.answer || message.text,
        citations: state.citations.length > 0 ? state.citations : message.citations,
      };
    }
    return message;
  });

  return (
    <div className="w-full space-y-4 p-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] shadow-sm">
      {/* ── Header ── */}
      <div className="flex items-center justify-between pb-2 border-b border-[var(--border-color)]">
        <div>
          <h2 className="text-base font-bold text-[var(--text-primary)]">Ask your documents</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Grounded RAG retrieval with citations across your uploaded files
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* ── Document Scope Selector ── */}
          <div className="relative">
            <button
              type="button"
              id="scope-selector-btn"
              onClick={() => setIsScopeMenuOpen((v) => !v)}
              aria-expanded={isScopeMenuOpen}
              aria-label="Filter documents for chat"
              className={[
                "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border transition-colors cursor-pointer",
                selectedDocIds.length > 0
                  ? "bg-[var(--accent-light)] border-[var(--accent)] text-[var(--accent)] font-semibold"
                  : "bg-[var(--bg-surface-2)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              ].join(" ")}
              title="Select specific documents to query"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <span>
                {selectedDocIds.length === 0
                  ? `All Documents (${readyCount})`
                  : selectedDocIds.length === 1
                  ? (documents.find((d) => d.id === selectedDocIds[0])?.filename || "1 document")
                  : `${selectedDocIds.length} documents selected`}
              </span>
              <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>

            {isScopeMenuOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 z-40 w-72 sm:w-80 rounded-lg shadow-xl border border-[var(--border-color)] bg-[var(--bg-surface)] overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Popover Header */}
                <div className="p-2.5 border-b border-[var(--border-color)] bg-[var(--bg-surface-2)] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[var(--text-primary)]">Document Scope</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => updateSelectedDocIds([])}
                        className="text-[11px] font-medium text-[var(--accent)] hover:underline cursor-pointer"
                      >
                        All Documents
                      </button>
                      <span style={{ color: "var(--border-color)" }}>•</span>
                      <button
                        type="button"
                        onClick={() => updateSelectedDocIds(readyDocuments.map((d) => d.id))}
                        className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        Select All
                      </button>
                    </div>
                  </div>

                  {/* Filter input */}
                  {documents.length > 2 && (
                    <input
                      type="search"
                      placeholder="Filter documents by name…"
                      value={docSearchQuery}
                      onChange={(e) => setDocSearchQuery(e.target.value)}
                      className="w-full px-2.5 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors"
                    />
                  )}
                </div>

                {/* Documents Checkbox List */}
                <div className="max-h-56 overflow-y-auto divide-y divide-[var(--border-subtle)] p-1">
                  {filteredDocList.length === 0 ? (
                    <p className="py-4 text-center text-xs text-[var(--text-muted)]">
                      No matching documents found.
                    </p>
                  ) : (
                    filteredDocList.map((doc) => {
                      const isSelected = selectedDocIds.includes(doc.id);
                      const isReady = doc.status === "READY";
                      return (
                        <label
                          key={doc.id}
                          className={[
                            "flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs transition-colors cursor-pointer select-none",
                            isReady ? "hover:bg-[var(--bg-surface-2)]" : "opacity-50 cursor-not-allowed",
                          ].join(" ")}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!isReady}
                            onChange={() => {
                              if (!isReady) return;
                              updateSelectedDocIds((prev) =>
                                prev.includes(doc.id)
                                  ? prev.filter((id) => id !== doc.id)
                                  : [...prev, doc.id]
                              );
                            }}
                            className="h-3.5 w-3.5 rounded border-[var(--border-color)] text-[var(--accent)] focus:ring-0 cursor-pointer"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="truncate font-medium text-[var(--text-primary)]" title={doc.filename}>
                              {doc.filename}
                            </p>
                            <p className="text-[10px] text-[var(--text-muted)]">
                              {doc.status !== "READY" ? doc.status : formatBytes(doc.sizeBytes)}
                            </p>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>

                {/* Popover Footer */}
                <div className="p-2 border-t border-[var(--border-color)] bg-[var(--bg-surface-2)] flex items-center justify-between text-xs">
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {selectedDocIds.length === 0
                      ? "Searching across all files"
                      : `${selectedDocIds.length} file${selectedDocIds.length === 1 ? "" : "s"} in scope`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsScopeMenuOpen(false)}
                    className="px-2.5 py-1 text-xs font-semibold rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Export conversation */}
          {messages.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowExportMenu((v) => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-[var(--border-color)] bg-[var(--bg-surface-2)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors cursor-pointer"
                title="Export conversation"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                <span>Export</span>
              </button>

              {showExportMenu && (
                <div
                  className="absolute right-0 top-full mt-1 z-30 w-36 rounded-md shadow-lg border border-[var(--border-color)] bg-[var(--bg-surface)] py-1 text-xs"
                  onClick={() => setShowExportMenu(false)}
                >
                  <button
                    type="button"
                    onClick={() => {
                      exportChatSession({ title: activeSessionTitle || "Conversation", messages }, "markdown");
                      setShowExportMenu(false);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-surface-2)] text-[var(--text-primary)] flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className="font-semibold text-[10px] text-[var(--accent)]">MD</span>
                    <span>Export (.md)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      exportChatSession({ title: activeSessionTitle || "Conversation", messages }, "json");
                      setShowExportMenu(false);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-surface-2)] text-[var(--text-primary)] flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className="font-semibold text-[10px] text-[var(--accent)]">{`{}`}</span>
                    <span>Export (.json)</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* New Chat */}
          {onNewChat && messages.length > 0 && (
            <button
              type="button"
              onClick={onNewChat}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-[var(--border-color)] bg-[var(--bg-surface-2)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors cursor-pointer"
              title="Start a new chat session"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span>New Chat</span>
            </button>
          )}

          {/* History Toggle */}
          {onToggleHistory && (
            <button
              type="button"
              onClick={onToggleHistory}
              aria-label={isHistoryOpen ? "Hide chat history" : "Show chat history"}
              className={[
                "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border transition-colors cursor-pointer",
                isHistoryOpen
                  ? "bg-[var(--accent-light)] border-[var(--accent-border)] text-[var(--accent)]"
                  : "bg-[var(--bg-surface-2)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              ].join(" ")}
              title={isHistoryOpen ? "Hide chat history sidebar" : "Show chat history sidebar"}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>History</span>
            </button>
          )}
        </div>
      </div>

      {readyCount === 0 && (
        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-surface-2)] p-3 text-sm text-[var(--text-secondary)]">
          {processingCount > 0
            ? `${processingCount} document${processingCount === 1 ? " is" : "s are"} processing. Chat will use documents once they are READY.`
            : "No searchable documents are available yet. Upload a document and wait until processing completes."}
        </div>
      )}

      {/* ── Messages Display ── */}
      {renderedMessages.length > 0 && (
        <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1" aria-live="polite">
          {renderedMessages.map((message) => (
            <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded px-3 py-2 text-sm whitespace-pre-wrap ${message.role === "user" ? "bg-[var(--accent)] text-white shadow-sm" : "border border-[var(--border-color)] bg-[var(--bg-surface-2)] text-[var(--text-primary)]"}`}>
                {message.role === "user" ? (
                  message.text
                ) : message.text ? (
                  <FormattedMessage
                    text={message.text}
                    citations={message.citations}
                    onCitationClick={(citation, index) => setActiveCitation({ citation, index })}
                  />
                ) : (message.id === activeAssistantId || (!message.text && isWorking)) ? (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-ping" />
                    <span>Thinking…</span>
                  </div>
                ) : (message.id === activeAssistantId || (!message.text && state.status === "error")) ? (
                  <p role="alert" className="text-xs text-[var(--status-failed)] font-medium">
                    {state.error || "Unable to receive answer. Please try again."}
                  </p>
                ) : null}
                {message.role === "assistant" && message.citations.length > 0 && (
                  <div className="mt-3 border-t border-[var(--border-color)] pt-2 text-xs text-[var(--text-muted)]">
                    <p className="mb-1 font-semibold uppercase tracking-wider text-[10px]">Sources</p>
                    <div className="flex flex-wrap gap-1.5">
                      {message.citations.map((citation, index) => (
                        <button
                          key={citation.chunkId ?? index}
                          type="button"
                          onClick={() => setActiveCitation({ citation, index })}
                          className="rounded border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors cursor-pointer text-left inline-flex items-center gap-1"
                          title={`Click to inspect source: ${citation.filename}${citation.pageNumber ? ` · page ${citation.pageNumber}` : ""}`}
                        >
                          [{index + 1}] {citation.filename}{citation.pageNumber ? ` · page ${citation.pageNumber}` : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Active Scope Indicator Bar (shown when specific documents are selected) ── */}
      {selectedDocIds.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap text-xs px-1">
          <span className="text-[11px] font-medium text-[var(--text-muted)]">Searching in:</span>
          {selectedDocIds.map((id) => {
            const doc = documents.find((d) => d.id === id);
            if (!doc) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border"
                style={{
                  background: "var(--accent-light, #fff1f2)",
                  color: "var(--accent)",
                  borderColor: "var(--accent)",
                }}
              >
                <span className="truncate max-w-[160px]">{doc.filename}</span>
                <button
                  type="button"
                  onClick={() => updateSelectedDocIds((prev) => prev.filter((dId) => dId !== id))}
                  className="hover:opacity-75 cursor-pointer ml-0.5"
                  aria-label={`Remove ${doc.filename} from scope`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            );
          })}
          <button
            type="button"
            onClick={() => updateSelectedDocIds([])}
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)] hover:underline cursor-pointer ml-1"
          >
            Reset to All
          </button>
        </div>
      )}

      {/* ── Query Input Form ── */}
      <form onSubmit={handleSubmit} className="flex gap-2 pt-1">
        <input
          type="text"
          placeholder={
            selectedDocIds.length === 1
              ? `Ask a question about ${documents.find((d) => d.id === selectedDocIds[0])?.filename || "this document"}…`
              : selectedDocIds.length > 1
              ? `Ask a question about the ${selectedDocIds.length} selected documents…`
              : "Ask a question about your documents…"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={isWorking}
          className="flex-1 rounded border border-[var(--border-color)] px-3 py-2 text-sm bg-[var(--bg-surface-2)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors"
        />
        {isWorking ? (
          <Button variant="secondary" size="sm" type="button" onClick={cancel}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" size="sm" type="submit" disabled={!query.trim()}>
            Send
          </Button>
        )}
      </form>

      {/* ── Slide-Over Citation Source Panel ── */}
      {activeCitation && (
        <CitationSourcePanel
          citation={activeCitation.citation}
          citationIndex={activeCitation.index}
          workspaceId={workspaceId}
          availableDocuments={documents}
          onOpenDocument={(doc) => setViewerDoc(doc)}
          onClose={() => setActiveCitation(null)}
        />
      )}

      {/* ── Document Viewer Modal ── */}
      {viewerDoc && workspaceId && (
        <DocumentViewerModal
          document={viewerDoc}
          workspaceId={workspaceId}
          onClose={() => setViewerDoc(null)}
        />
      )}
    </div>
  );
}
