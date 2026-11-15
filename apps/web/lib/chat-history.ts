import type { Citation } from "@/hooks/use-chat-stream";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations: Citation[];
  timestamp: string;
};

export type ChatSession = {
  id: string;
  userId: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  isPinned?: boolean;
  selectedDocumentIds?: string[];
};

export type DateGroupedSessions = {
  label: string;
  sessions: ChatSession[];
};

export const CHAT_HISTORY_EVENT = "core_chat_history_updated";

function getStorageKey(userId?: string, workspaceId?: string): string {
  const uid = userId || "anonymous";
  const wid = workspaceId || "default";
  return `core_chat_sessions_${uid}_${wid}`;
}

export function loadChatSessions(userId?: string, workspaceId?: string): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getStorageKey(userId, workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.sort((a, b) => {
      // Pinned items first
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
    });
  } catch (error) {
    console.error("Failed to load chat sessions:", error);
    return [];
  }
}

export function saveChatSessions(
  sessions: ChatSession[],
  userId?: string,
  workspaceId?: string
): void {
  if (typeof window === "undefined") return;
  try {
    const sorted = [...sessions].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
    });
    localStorage.setItem(getStorageKey(userId, workspaceId), JSON.stringify(sorted));
    setTimeout(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(CHAT_HISTORY_EVENT));
      }
    }, 0);
  } catch (error) {
    console.error("Failed to save chat sessions:", error);
  }
}

export function upsertChatSession(
  session: ChatSession,
  userId?: string,
  workspaceId?: string
): void {
  const sessions = loadChatSessions(userId, workspaceId);
  const index = sessions.findIndex((s) => s.id === session.id);
  if (index >= 0) {
    // Preserve pin state if not explicitly changed
    if (session.isPinned === undefined && sessions[index].isPinned !== undefined) {
      session.isPinned = sessions[index].isPinned;
    }
    sessions[index] = session;
  } else {
    sessions.unshift(session);
  }
  saveChatSessions(sessions, userId, workspaceId);
}

export function renameChatSession(
  sessionId: string,
  newTitle: string,
  userId?: string,
  workspaceId?: string
): ChatSession | null {
  const trimmed = newTitle.trim();
  if (!trimmed) return null;
  const sessions = loadChatSessions(userId, workspaceId);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  session.title = trimmed;
  session.updatedAt = new Date().toISOString();
  saveChatSessions(sessions, userId, workspaceId);
  return session;
}

export function togglePinChatSession(
  sessionId: string,
  userId?: string,
  workspaceId?: string
): boolean {
  const sessions = loadChatSessions(userId, workspaceId);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return false;
  session.isPinned = !session.isPinned;
  saveChatSessions(sessions, userId, workspaceId);
  return !!session.isPinned;
}

export function deleteChatSession(
  sessionId: string,
  userId?: string,
  workspaceId?: string
): void {
  const sessions = loadChatSessions(userId, workspaceId);
  const filtered = sessions.filter((s) => s.id !== sessionId);
  saveChatSessions(filtered, userId, workspaceId);
}

export function createNewSession(
  userId?: string,
  workspaceId?: string,
  title?: string
): ChatSession {
  const now = new Date().toISOString();
  return {
    id: `chat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    userId: userId || "",
    workspaceId: workspaceId || "",
    title: title || "New Chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
    isPinned: false,
  };
}

export function groupSessionsByDate(sessions: ChatSession[]): DateGroupedSessions[] {
  if (sessions.length === 0) return [];

  const pinnedSessions = sessions.filter((s) => s.isPinned);
  const unpinnedSessions = sessions.filter((s) => !s.isPinned);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const groups: Record<string, ChatSession[]> = {};
  const order: string[] = [];

  if (pinnedSessions.length > 0) {
    groups["Pinned"] = pinnedSessions;
    order.push("Pinned");
  }

  for (const session of unpinnedSessions) {
    const sessionDate = new Date(session.updatedAt || session.createdAt);
    const sessionDay = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());

    let label = "";
    if (sessionDay.getTime() === today.getTime()) {
      label = "Today";
    } else if (sessionDay.getTime() === yesterday.getTime()) {
      label = "Yesterday";
    } else if (sessionDay > sevenDaysAgo) {
      label = "Previous 7 Days";
    } else if (sessionDay > thirtyDaysAgo) {
      label = "Previous 30 Days";
    } else {
      label = sessionDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }

    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(session);
  }

  return order.map((label) => ({
    label,
    sessions: groups[label],
  }));
}

export function generateConversationMarkdown(session: {
  title?: string;
  createdAt?: string;
  messages: Array<{
    role: "user" | "assistant";
    text: string;
    citations?: Array<{ filename: string; pageNumber?: number | null }>;
    timestamp?: string;
  }>;
}): string {
  const title = session.title || "Chat Conversation";
  const dateStr = session.createdAt ? new Date(session.createdAt).toLocaleString() : new Date().toLocaleString();

  const lines: string[] = [
    `# ${title}`,
    "",
    `> Exported on ${dateStr} from CORE Document Intelligence`,
    "",
    "---",
    "",
  ];

  for (const msg of session.messages) {
    const roleName = msg.role === "user" ? "### 👤 User" : "### 🤖 CHiE Assistant";
    lines.push(roleName);
    lines.push("");
    lines.push(msg.text);
    lines.push("");

    if (msg.role === "assistant" && msg.citations && msg.citations.length > 0) {
      lines.push("**Sources:**");
      msg.citations.forEach((c, i) => {
        const page = c.pageNumber ? ` · page ${c.pageNumber}` : "";
        lines.push(`- [${i + 1}] ${c.filename}${page}`);
      });
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

export function exportChatSession(
  session: {
    id?: string;
    title?: string;
    createdAt?: string;
    updatedAt?: string;
    messages: Array<{
      id?: string;
      role: "user" | "assistant";
      text: string;
      citations?: Array<{ filename: string; pageNumber?: number | null }>;
      timestamp?: string;
    }>;
  },
  format: "markdown" | "json" = "markdown"
): void {
  if (typeof window === "undefined") return;

  const title = session.title || "conversation";
  const cleanName = title.toLowerCase().replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "chat";
  const timestamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    const jsonText = JSON.stringify(session, null, 2);
    downloadBlob(jsonText, `${cleanName}-${timestamp}.json`, "application/json");
  } else {
    const mdText = generateConversationMarkdown(session);
    downloadBlob(mdText, `${cleanName}-${timestamp}.md`, "text/markdown;charset=utf-8");
  }
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
