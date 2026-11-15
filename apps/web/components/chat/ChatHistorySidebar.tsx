"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import type { ChatSession } from "@/lib/chat-history";
import {
  groupSessionsByDate,
  renameChatSession,
  togglePinChatSession,
  exportChatSession,
} from "@/lib/chat-history";

interface ChatHistorySidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (session: ChatSession | null) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newTitle: string) => void;
  onTogglePinSession?: (sessionId: string) => void;
  onExportSession?: (session: ChatSession, format: "markdown" | "json") => void;
}

export function ChatHistorySidebar({
  isOpen,
  onToggle,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onTogglePinSession,
  onExportSession,
}: ChatHistorySidebarProps) {
  const [search, setSearch] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [exportMenuSessionId, setExportMenuSessionId] = useState<string | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSessionId]);

  const filteredSessions = useMemo(() => {
    if (!search.trim()) return sessions;
    const query = search.toLowerCase();
    return sessions.filter((s) =>
      s.title.toLowerCase().includes(query) ||
      s.messages.some((m) => m.text.toLowerCase().includes(query))
    );
  }, [sessions, search]);

  const dateGroups = useMemo(
    () => groupSessionsByDate(filteredSessions),
    [filteredSessions]
  );

  function formatTime(isoString: string): string {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  function handleDeleteClick(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (deleteConfirmId === id) {
      onDeleteSession(id);
      setDeleteConfirmId(null);
    } else {
      setDeleteConfirmId(id);
      setTimeout(() => {
        setDeleteConfirmId((current) => (current === id ? null : current));
      }, 4000);
    }
  }

  function handleStartRename(e: React.MouseEvent, session: ChatSession) {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  }

  function handleSaveRename(e: React.MouseEvent | React.FormEvent, session: ChatSession) {
    e.stopPropagation();
    e.preventDefault();
    const trimmed = editingTitle.trim();
    if (trimmed && trimmed !== session.title) {
      if (onRenameSession) {
        onRenameSession(session.id, trimmed);
      } else {
        renameChatSession(session.id, trimmed);
      }
    }
    setEditingSessionId(null);
  }

  function handleCancelRename(e: React.MouseEvent) {
    e.stopPropagation();
    setEditingSessionId(null);
  }

  function handleTogglePin(e: React.MouseEvent, session: ChatSession) {
    e.stopPropagation();
    if (onTogglePinSession) {
      onTogglePinSession(session.id);
    } else {
      togglePinChatSession(session.id);
    }
  }

  function handleExport(e: React.MouseEvent, session: ChatSession, format: "markdown" | "json") {
    e.stopPropagation();
    setExportMenuSessionId(null);
    if (onExportSession) {
      onExportSession(session, format);
    } else {
      exportChatSession(session, format);
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <aside
      aria-label="Chat History Sidebar"
      className="flex flex-col w-80 shrink-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] overflow-hidden transition-all duration-300 shadow-sm"
      style={{ height: "calc(100vh - var(--header-height) - 48px)", maxHeight: "860px" }}
    >
      {/* Sidebar Header */}
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-surface-2)]">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-[var(--accent)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-sm font-semibold text-[var(--text-primary)]">Chat History</span>
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-[var(--border-color)] text-[var(--text-secondary)] font-medium">
            {sessions.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onSelectSession(null)}
            title="Start a new chat"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New
          </button>
          <button
            onClick={onToggle}
            title="Hide chat history"
            aria-label="Hide chat history"
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search Input — Always available when conversations exist */}
      {sessions.length > 0 && (
        <div className="p-2.5 border-b border-[var(--border-color)]">
          <div className="relative flex items-center">
            <svg
              className="w-3.5 h-3.5 absolute left-2.5 text-[var(--text-muted)] pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search conversations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-surface-2)] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                aria-label="Clear search"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {search && (
            <div className="flex justify-between items-center mt-1 px-1 text-[10px] text-[var(--text-muted)]">
              <span>{filteredSessions.length} result{filteredSessions.length === 1 ? "" : "s"} found</span>
            </div>
          )}
        </div>
      )}

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--border-subtle)] p-2 space-y-3">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center px-4">
            <div className="w-10 h-10 rounded-full bg-[var(--bg-surface-2)] flex items-center justify-center text-[var(--text-muted)] mb-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
            </div>
            <p className="text-xs font-semibold text-[var(--text-primary)]">No conversations yet</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              Your chats will be saved here automatically.
            </p>
          </div>
        ) : dateGroups.length === 0 ? (
          <div className="text-center py-8 text-xs text-[var(--text-muted)]">
            No chats match &ldquo;{search}&rdquo;
          </div>
        ) : (
          dateGroups.map((group) => (
            <div key={group.label} className="space-y-1 pt-1.5 first:pt-0">
              {/* Group Header (Pinned or Date) */}
              <div className="sticky top-0 z-10 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-surface)]/95 backdrop-blur-sm flex items-center gap-1.5">
                {group.label === "Pinned" && (
                  <svg className="w-3 h-3 text-[var(--accent)]" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                  </svg>
                )}
                <span>{group.label}</span>
              </div>

              {/* Group items */}
              <div className="space-y-1">
                {group.sessions.map((session) => {
                  const isActive = session.id === activeSessionId;
                  const isConfirmingDelete = deleteConfirmId === session.id;
                  const isEditing = editingSessionId === session.id;
                  const isExportMenuOpen = exportMenuSessionId === session.id;

                  return (
                    <div
                      key={session.id}
                      onClick={() => onSelectSession(session)}
                      className={[
                        "group relative flex items-center justify-between p-2 rounded-md cursor-pointer transition-all border text-left",
                        isActive
                          ? "bg-[var(--accent-light)] border-[var(--accent-border)] text-[var(--text-primary)]"
                          : "border-transparent hover:bg-[var(--bg-surface-2)] text-[var(--text-primary)]",
                      ].join(" ")}
                    >
                      {/* Title & Metadata or Inline Rename Input */}
                      <div className="flex-1 min-w-0 pr-2">
                        {isEditing ? (
                          <form
                            onSubmit={(e) => handleSaveRename(e, session)}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1"
                          >
                            <input
                              ref={editInputRef}
                              type="text"
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") handleCancelRename(e as any);
                              }}
                              className="w-full px-1.5 py-0.5 text-xs rounded border border-[var(--accent)] bg-[var(--bg-surface)] text-[var(--text-primary)] outline-none"
                            />
                            <button
                              type="submit"
                              title="Save title"
                              className="p-1 rounded text-white bg-[var(--accent)] hover:opacity-90 shrink-0"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelRename}
                              title="Cancel"
                              className="p-1 rounded text-[var(--text-muted)] hover:bg-[var(--bg-surface)] shrink-0"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </form>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5">
                              {session.isPinned && (
                                <span title="Pinned conversation" className="inline-flex items-center">
                                  <svg
                                    className="w-3 h-3 shrink-0 text-[var(--accent)]"
                                    fill="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                                  </svg>
                                </span>
                              )}
                              <p className="text-xs font-medium truncate leading-tight">
                                {session.title || "Untitled Conversation"}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--text-muted)]">
                              <span>{formatTime(session.updatedAt || session.createdAt)}</span>
                              <span>•</span>
                              <span>{session.messages.length} msg{session.messages.length === 1 ? "" : "s"}</span>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Action Buttons: Pin, Rename, Export, Delete */}
                      {!isEditing && (
                        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {/* Pin Toggle Button */}
                          <button
                            type="button"
                            onClick={(e) => handleTogglePin(e, session)}
                            title={session.isPinned ? "Unpin conversation" : "Pin conversation"}
                            aria-label={session.isPinned ? "Unpin conversation" : "Pin conversation"}
                            className={[
                              "p-1 rounded transition-all",
                              session.isPinned
                                ? "text-[var(--accent)] opacity-100"
                                : "text-[var(--text-muted)] hover:text-[var(--accent)] opacity-0 group-hover:opacity-100 focus:opacity-100",
                            ].join(" ")}
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill={session.isPinned ? "currentColor" : "none"}
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={session.isPinned ? 0 : 2}
                            >
                              <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                            </svg>
                          </button>

                          {/* Rename Button */}
                          <button
                            type="button"
                            onClick={(e) => handleStartRename(e, session)}
                            title="Rename conversation"
                            aria-label="Rename conversation"
                            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                            </svg>
                          </button>

                          {/* Export Button & Popover */}
                          <div className="relative">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExportMenuSessionId((current) => (current === session.id ? null : session.id));
                              }}
                              title="Export conversation"
                              aria-label="Export conversation"
                              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                              </svg>
                            </button>

                            {isExportMenuOpen && (
                              <div
                                className="absolute right-0 bottom-full mb-1 z-30 w-36 rounded-md shadow-lg border border-[var(--border-color)] bg-[var(--bg-surface)] py-1 text-xs"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={(e) => handleExport(e, session, "markdown")}
                                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-surface-2)] text-[var(--text-primary)] flex items-center gap-1.5"
                                >
                                  <span className="font-semibold text-[10px] text-[var(--accent)]">MD</span>
                                  <span>Export (.md)</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => handleExport(e, session, "json")}
                                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-surface-2)] text-[var(--text-primary)] flex items-center gap-1.5"
                                >
                                  <span className="font-semibold text-[10px] text-[var(--accent)]">{`{}`}</span>
                                  <span>Export (.json)</span>
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={(e) => handleDeleteClick(e, session.id)}
                            title={isConfirmingDelete ? "Click again to confirm permanent deletion" : "Delete chat permanently"}
                            aria-label="Delete chat permanently"
                            className={[
                              "p-1 rounded transition-all shrink-0",
                              isConfirmingDelete
                                ? "bg-[var(--status-failed)] text-white opacity-100"
                                : "text-[var(--text-muted)] hover:text-[var(--status-failed)] hover:bg-[var(--status-failed-bg)] opacity-0 group-hover:opacity-100 focus:opacity-100",
                            ].join(" ")}
                          >
                            {isConfirmingDelete ? (
                              <span className="text-[10px] font-bold px-1">Confirm?</span>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                                />
                              </svg>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer New Chat Action */}
      <div className="p-2.5 border-t border-[var(--border-color)] bg-[var(--bg-surface-2)]">
        <button
          onClick={() => onSelectSession(null)}
          className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded text-xs font-semibold text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors shadow-sm cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Start New Conversation
        </button>
      </div>
    </aside>
  );
}
