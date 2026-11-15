"use client";

import { useEffect, useState, useCallback, useTransition, useRef } from "react";
import { ChatBox, type Message } from "@/components/chat/ChatBox";
import { ChatHistorySidebar } from "@/components/chat/ChatHistorySidebar";
import { Spinner } from "@/components/ui/Spinner";
import { getDocuments, getWorkspace } from "@/lib/api";
import { getWorkspaceId, getCurrentUser } from "@/lib/auth";

const WORKSPACE_CHANGED_EVENT = "core_workspace_changed";
import type { Document, Workspace } from "@/lib/types";
import {
  type ChatSession,
  loadChatSessions,
  upsertChatSession,
  deleteChatSession,
  renameChatSession,
  togglePinChatSession,
  exportChatSession,
  createNewSession,
  CHAT_HISTORY_EVENT,
} from "@/lib/chat-history";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; workspace: Workspace; documents: Document[] };

const SIDEBAR_STORAGE_KEY = "core_chat_sidebar_open";

export default function ChatPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const [, startTransition] = useTransition();

  const activeSessionRef = useRef<ChatSession | null>(activeSession);
  activeSessionRef.current = activeSession;

  const user = getCurrentUser();
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(() => getWorkspaceId());

  useEffect(() => {
    const handleWorkspaceChanged = (e: any) => {
      const newId = e?.detail?.workspaceId || getWorkspaceId() || null;
      setWorkspaceIdState(newId);
    };
    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
  }, []);

  // Load workspace and documents
  useEffect(() => {
    if (!workspaceId) {
      setState({ phase: "error", message: "Workspace not found." });
      return;
    }

    let cancelled = false;
    Promise.all([getWorkspace(workspaceId), getDocuments(workspaceId)])
      .then(([workspace, documents]) => {
        if (!cancelled) setState({ phase: "ready", workspace, documents });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "error", message: "Unable to load chat workspace." });
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Load chat sessions & restore sidebar open preference
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedSidebarPref = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (savedSidebarPref !== null) {
        setIsHistoryOpen(savedSidebarPref === "true");
      }
    }

    const loaded = loadChatSessions(user?.userId, workspaceId || undefined);
    setSessions(loaded);

    const handleStorageUpdate = () => {
      const refreshed = loadChatSessions(user?.userId, workspaceId || undefined);
      setSessions(refreshed);
    };

    window.addEventListener(CHAT_HISTORY_EVENT, handleStorageUpdate);
    return () => {
      window.removeEventListener(CHAT_HISTORY_EVENT, handleStorageUpdate);
    };
  }, [user?.userId, workspaceId]);

  const toggleHistory = useCallback(() => {
    setIsHistoryOpen((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      }
      return next;
    });
  }, []);

  const handleSelectSession = useCallback((session: ChatSession | null) => {
    startTransition(() => {
      setActiveSession(session);
    });
  }, []);

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      deleteChatSession(sessionId, user?.userId, workspaceId || undefined);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSession?.id === sessionId) {
        setActiveSession(null);
      }
    },
    [activeSession?.id, user?.userId, workspaceId]
  );

  const handleRenameSession = useCallback(
    (sessionId: string, newTitle: string) => {
      renameChatSession(sessionId, newTitle, user?.userId, workspaceId || undefined);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
      );
      if (activeSessionRef.current?.id === sessionId) {
        setActiveSession((prev) => (prev ? { ...prev, title: newTitle } : null));
      }
    },
    [user?.userId, workspaceId]
  );

  const handleTogglePinSession = useCallback(
    (sessionId: string) => {
      togglePinChatSession(sessionId, user?.userId, workspaceId || undefined);
      const refreshed = loadChatSessions(user?.userId, workspaceId || undefined);
      setSessions(refreshed);
      if (activeSessionRef.current?.id === sessionId) {
        setActiveSession((prev) => (prev ? { ...prev, isPinned: !prev.isPinned } : null));
      }
    },
    [user?.userId, workspaceId]
  );

  const handleNewChat = useCallback(() => {
    setActiveSession(null);
  }, []);

  const handleMessagesChange = useCallback(
    (newMessages: Message[], selectedDocIds?: string[]) => {
      if (newMessages.length === 0) return;

      const now = new Date().toISOString();
      const current = activeSessionRef.current;
      const firstUserMessage = newMessages.find((m) => m.role === "user")?.text || "New Conversation";
      const title =
        firstUserMessage.length > 50
          ? `${firstUserMessage.slice(0, 47)}…`
          : firstUserMessage;

      const docScope = selectedDocIds !== undefined ? selectedDocIds : current?.selectedDocumentIds;

      const sessionToSave: ChatSession = current
        ? {
            ...current,
            messages: newMessages.map((m) => ({
              ...m,
              timestamp: now,
            })),
            selectedDocumentIds: docScope,
            updatedAt: now,
            title: current.title === "New Chat" ? title : current.title,
          }
        : {
            ...createNewSession(user?.userId, workspaceId || undefined, title),
            messages: newMessages.map((m) => ({
              ...m,
              timestamp: now,
            })),
            selectedDocumentIds: docScope,
            updatedAt: now,
          };

      activeSessionRef.current = sessionToSave;
      upsertChatSession(sessionToSave, user?.userId, workspaceId || undefined);
      setActiveSession(sessionToSave);
      setSessions((prev) => {
        const withoutCurrent = prev.filter((s) => s.id !== sessionToSave.id);
        return [sessionToSave, ...withoutCurrent];
      });
    },
    [user?.userId, workspaceId]
  );

  const handleScopeChange = useCallback(
    (selectedDocIds: string[]) => {
      const current = activeSessionRef.current;
      if (!current) return;
      const updatedSession: ChatSession = {
        ...current,
        selectedDocumentIds: selectedDocIds,
        updatedAt: new Date().toISOString(),
      };
      activeSessionRef.current = updatedSession;
      upsertChatSession(updatedSession, user?.userId, workspaceId || undefined);
      setActiveSession(updatedSession);
      setSessions((prev) =>
        prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
      );
    },
    [user?.userId, workspaceId]
  );

  if (state.phase === "loading") {
    return (
      <div className="flex h-48 items-center justify-center">
        <Spinner label="Loading chat…" />
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <p
        role="alert"
        className="rounded p-4 text-sm"
        style={{ background: "var(--status-failed-bg)", color: "var(--status-failed)" }}
      >
        {state.message}
      </p>
    );
  }

  return (
    <div className="space-y-4 max-w-7xl">
      {/* Header Bar */}
      <div className="flex items-center justify-between pb-1">
        <div>
          <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            Chat
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
            Ask questions about searchable documents in{" "}
            <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
              {state.workspace.name}
            </span>
            .
          </p>
        </div>

        {/* Global Sidebar Toggle Button (visible if sidebar is closed) */}
        {!isHistoryOpen && (
          <button
            onClick={toggleHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all shadow-sm cursor-pointer"
            title="Open chat history sidebar"
          >
            <svg className="w-4 h-4 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Show Chat History</span>
            {sessions.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-[var(--bg-surface-2)] font-bold text-[var(--text-secondary)]">
                {sessions.length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Main Container: Chat Panel + Toggle Chat History Sidebar Right Beside It */}
      <div className="flex flex-col lg:flex-row items-start gap-4">
        {/* Chat Panel */}
        <div className="flex-1 w-full min-w-0">
          <ChatBox
            documents={state.documents}
            initialMessages={activeSession?.messages || []}
            activeSessionId={activeSession?.id || null}
            activeSessionTitle={activeSession?.title}
            initialSelectedDocumentIds={activeSession?.selectedDocumentIds || []}
            onMessagesChange={handleMessagesChange}
            onScopeChange={handleScopeChange}
            onNewChat={handleNewChat}
            isHistoryOpen={isHistoryOpen}
            onToggleHistory={toggleHistory}
          />
        </div>

        {/* Chat History Sidebar right beside the chat panel */}
        <ChatHistorySidebar
          isOpen={isHistoryOpen}
          onToggle={toggleHistory}
          sessions={sessions}
          activeSessionId={activeSession?.id || null}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          onTogglePinSession={handleTogglePinSession}
          onExportSession={exportChatSession}
        />
      </div>
    </div>
  );
}
