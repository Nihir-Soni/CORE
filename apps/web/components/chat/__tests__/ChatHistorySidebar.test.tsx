import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatHistorySidebar } from "../ChatHistorySidebar";
import type { ChatSession } from "@/lib/chat-history";

describe("ChatHistorySidebar", () => {
  const dummySessions: ChatSession[] = [
    {
      id: "session-1",
      userId: "u1",
      workspaceId: "w1",
      title: "How to upload documents?",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        { id: "m1", role: "user", text: "How to upload documents?", citations: [], timestamp: "" },
        { id: "m2", role: "assistant", text: "Go to Object Browser.", citations: [], timestamp: "" },
      ],
    },
  ];

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <ChatHistorySidebar
        isOpen={false}
        onToggle={vi.fn()}
        sessions={dummySessions}
        activeSessionId={null}
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders sessions, date headers, and triggers onSelectSession when clicked", () => {
    const onSelectSession = vi.fn();
    render(
      <ChatHistorySidebar
        isOpen={true}
        onToggle={vi.fn()}
        sessions={dummySessions}
        activeSessionId={null}
        onSelectSession={onSelectSession}
        onDeleteSession={vi.fn()}
      />
    );

    expect(screen.getByText("Chat History")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("How to upload documents?")).toBeTruthy();

    fireEvent.click(screen.getByText("How to upload documents?"));
    expect(onSelectSession).toHaveBeenCalledWith(dummySessions[0]);
  });

  it("triggers onDeleteSession on delete confirmation", () => {
    const onDeleteSession = vi.fn();
    render(
      <ChatHistorySidebar
        isOpen={true}
        onToggle={vi.fn()}
        sessions={dummySessions}
        activeSessionId="session-1"
        onSelectSession={vi.fn()}
        onDeleteSession={onDeleteSession}
      />
    );

    const deleteBtn = screen.getByLabelText("Delete chat permanently");
    // First click asks confirmation
    fireEvent.click(deleteBtn);
    expect(screen.getByText("Confirm?")).toBeTruthy();

    // Second click confirms and deletes
    fireEvent.click(deleteBtn);
    expect(onDeleteSession).toHaveBeenCalledWith("session-1");
  });

  it("triggers onToggle when close button is clicked", () => {
    const onToggle = vi.fn();
    render(
      <ChatHistorySidebar
        isOpen={true}
        onToggle={onToggle}
        sessions={dummySessions}
        activeSessionId={null}
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    );

    const closeBtn = screen.getByLabelText("Hide chat history");
    fireEvent.click(closeBtn);
    expect(onToggle).toHaveBeenCalled();
  });

  it("filters sessions when user searches by title or message content", () => {
    const multiSessions: ChatSession[] = [
      {
        id: "session-1",
        userId: "u1",
        workspaceId: "w1",
        title: "Alpha Research",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [{ id: "m1", role: "user", text: "What is alpha?", citations: [], timestamp: "" }],
      },
      {
        id: "session-2",
        userId: "u1",
        workspaceId: "w1",
        title: "Beta Development",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [{ id: "m2", role: "user", text: "How is gamma?", citations: [], timestamp: "" }],
      },
    ];

    render(
      <ChatHistorySidebar
        isOpen={true}
        onToggle={vi.fn()}
        sessions={multiSessions}
        activeSessionId={null}
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText("Search conversations…");
    fireEvent.change(searchInput, { target: { value: "Alpha" } });

    expect(screen.getByText("Alpha Research")).toBeTruthy();
    expect(screen.queryByText("Beta Development")).toBeNull();

    // Clear search
    const clearBtn = screen.getByLabelText("Clear search");
    fireEvent.click(clearBtn);
    expect(screen.getByText("Beta Development")).toBeTruthy();
  });

  it("triggers onRenameSession when rename is confirmed", () => {
    const onRenameSession = vi.fn();

    render(
      <ChatHistorySidebar
        isOpen={true}
        onToggle={vi.fn()}
        sessions={dummySessions}
        activeSessionId="session-1"
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onRenameSession={onRenameSession}
      />
    );

    const renameBtn = screen.getByLabelText("Rename conversation");
    fireEvent.click(renameBtn);

    const editInput = screen.getByDisplayValue("How to upload documents?");
    fireEvent.change(editInput, { target: { value: "Updated Doc Guide" } });
    fireEvent.submit(editInput.closest("form")!);

    expect(onRenameSession).toHaveBeenCalledWith("session-1", "Updated Doc Guide");
  });

  it("triggers onTogglePinSession when pin button is clicked", () => {
    const onTogglePinSession = vi.fn();

    render(
      <ChatHistorySidebar
        isOpen={true}
        onToggle={vi.fn()}
        sessions={dummySessions}
        activeSessionId="session-1"
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onTogglePinSession={onTogglePinSession}
      />
    );

    const pinBtn = screen.getByLabelText("Pin conversation");
    fireEvent.click(pinBtn);

    expect(onTogglePinSession).toHaveBeenCalledWith("session-1");
  });

  it("triggers onExportSession when an export format is selected", () => {
    const onExportSession = vi.fn();

    render(
      <ChatHistorySidebar
        isOpen={true}
        onToggle={vi.fn()}
        sessions={dummySessions}
        activeSessionId="session-1"
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onExportSession={onExportSession}
      />
    );

    const exportBtn = screen.getByLabelText("Export conversation");
    fireEvent.click(exportBtn);

    const mdBtn = screen.getByText("Export (.md)");
    fireEvent.click(mdBtn);

    expect(onExportSession).toHaveBeenCalledWith(dummySessions[0], "markdown");
  });
});
