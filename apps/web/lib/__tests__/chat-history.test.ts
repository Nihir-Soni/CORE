import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadChatSessions,
  saveChatSessions,
  upsertChatSession,
  deleteChatSession,
  renameChatSession,
  togglePinChatSession,
  createNewSession,
  groupSessionsByDate,
  generateConversationMarkdown,
  exportChatSession,
  type ChatSession,
} from "../chat-history";

describe("chat-history", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("loadChatSessions returns empty array when nothing is stored", () => {
    const sessions = loadChatSessions("user-1", "ws-1");
    expect(sessions).toEqual([]);
  });

  it("upsertChatSession adds and updates a session permanently in localStorage", () => {
    const session = createNewSession("user-1", "ws-1", "First Question");
    session.messages = [
      { id: "1", role: "user", text: "What is CORE?", citations: [], timestamp: session.createdAt },
      { id: "2", role: "assistant", text: "CORE is an object store.", citations: [], timestamp: session.createdAt },
    ];

    upsertChatSession(session, "user-1", "ws-1");

    const loaded = loadChatSessions("user-1", "ws-1");
    expect(loaded.length).toBe(1);
    expect(loaded[0].title).toBe("First Question");
    expect(loaded[0].messages.length).toBe(2);

    // Update session
    session.title = "Updated Title";
    session.updatedAt = new Date().toISOString();
    upsertChatSession(session, "user-1", "ws-1");

    const updated = loadChatSessions("user-1", "ws-1");
    expect(updated.length).toBe(1);
    expect(updated[0].title).toBe("Updated Title");
  });

  it("deleteChatSession removes a session permanently", () => {
    const sessionA = createNewSession("user-1", "ws-1", "Chat A");
    const sessionB = createNewSession("user-1", "ws-1", "Chat B");

    saveChatSessions([sessionA, sessionB], "user-1", "ws-1");
    expect(loadChatSessions("user-1", "ws-1").length).toBe(2);

    deleteChatSession(sessionA.id, "user-1", "ws-1");

    const remaining = loadChatSessions("user-1", "ws-1");
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe(sessionB.id);
  });

  it("isolates chats by user and workspace", () => {
    const userASession = createNewSession("user-A", "ws-1", "User A Chat");
    const userBSession = createNewSession("user-B", "ws-1", "User B Chat");

    upsertChatSession(userASession, "user-A", "ws-1");
    upsertChatSession(userBSession, "user-B", "ws-1");

    expect(loadChatSessions("user-A", "ws-1").map((s) => s.title)).toEqual(["User A Chat"]);
    expect(loadChatSessions("user-B", "ws-1").map((s) => s.title)).toEqual(["User B Chat"]);
  });

  it("groupSessionsByDate groups sessions with respect to dates", () => {
    const now = new Date();
    const todayISO = now.toISOString();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayISO = yesterday.toISOString();

    const fourDaysAgo = new Date(now);
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
    const fourDaysAgoISO = fourDaysAgo.toISOString();

    const sessions: ChatSession[] = [
      {
        id: "1",
        userId: "u1",
        workspaceId: "w1",
        title: "Today's chat",
        createdAt: todayISO,
        updatedAt: todayISO,
        messages: [],
      },
      {
        id: "2",
        userId: "u1",
        workspaceId: "w1",
        title: "Yesterday's chat",
        createdAt: yesterdayISO,
        updatedAt: yesterdayISO,
        messages: [],
      },
      {
        id: "3",
        userId: "u1",
        workspaceId: "w1",
        title: "Past week chat",
        createdAt: fourDaysAgoISO,
        updatedAt: fourDaysAgoISO,
        messages: [],
      },
    ];

    const grouped = groupSessionsByDate(sessions);
    const labels = grouped.map((g) => g.label);

    expect(labels).toContain("Today");
    expect(labels).toContain("Yesterday");
    expect(labels).toContain("Previous 7 Days");

    const todayGroup = grouped.find((g) => g.label === "Today");
    expect(todayGroup?.sessions[0].title).toBe("Today's chat");

    const yesterdayGroup = grouped.find((g) => g.label === "Yesterday");
    expect(yesterdayGroup?.sessions[0].title).toBe("Yesterday's chat");
  });

  it("renameChatSession updates title and persists", () => {
    const session = createNewSession("user-1", "ws-1", "Original Title");
    saveChatSessions([session], "user-1", "ws-1");

    const renamed = renameChatSession(session.id, "Brand New Title", "user-1", "ws-1");
    expect(renamed?.title).toBe("Brand New Title");

    const loaded = loadChatSessions("user-1", "ws-1");
    expect(loaded[0].title).toBe("Brand New Title");
  });

  it("togglePinChatSession toggles isPinned and places pinned sessions first", () => {
    const session1 = createNewSession("user-1", "ws-1", "Normal Chat");
    const session2 = createNewSession("user-1", "ws-1", "VIP Chat");
    saveChatSessions([session1, session2], "user-1", "ws-1");

    const isPinned = togglePinChatSession(session2.id, "user-1", "ws-1");
    expect(isPinned).toBe(true);

    const loaded = loadChatSessions("user-1", "ws-1");
    expect(loaded[0].id).toBe(session2.id); // Pinned is sorted first
    expect(loaded[0].isPinned).toBe(true);

    // Grouping puts Pinned group first
    const grouped = groupSessionsByDate(loaded);
    expect(grouped[0].label).toBe("Pinned");
    expect(grouped[0].sessions[0].title).toBe("VIP Chat");

    // Toggle off
    const unpinned = togglePinChatSession(session2.id, "user-1", "ws-1");
    expect(unpinned).toBe(false);
  });

  it("generateConversationMarkdown produces clean Markdown with citations", () => {
    const md = generateConversationMarkdown({
      title: "Quarterly Review",
      createdAt: "2026-03-15T10:00:00Z",
      messages: [
        { role: "user", text: "What is the status?" },
        {
          role: "assistant",
          text: "Status is complete [1].",
          citations: [{ filename: "report.pdf", pageNumber: 5 }],
        },
      ],
    });

    expect(md).toContain("# Quarterly Review");
    expect(md).toContain("### 👤 User");
    expect(md).toContain("What is the status?");
    expect(md).toContain("### 🤖 CHiE Assistant");
    expect(md).toContain("Status is complete [1].");
    expect(md).toContain("- [1] report.pdf · page 5");
  });
});
