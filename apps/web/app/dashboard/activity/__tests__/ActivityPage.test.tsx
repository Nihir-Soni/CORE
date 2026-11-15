import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ActivityAuditPage from "../page";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import type { AuditLog } from "@/lib/types";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getWorkspaceRole: vi.fn(),
    getWorkspaceAuditLogs: vi.fn(),
  };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getWorkspaceId: vi.fn(),
  };
});

describe("ActivityAuditPage", () => {
  const mockAuditLogs: AuditLog[] = [
    {
      id: "log-1",
      workspaceId: "ws-123",
      userId: "user-1",
      action: "DOCUMENT_UPLOADED",
      resourceId: "doc-1",
      resourceName: "Annual_Report.pdf",
      details: { sizeBytes: 1048576, mimeType: "application/pdf" },
      createdAt: "2026-11-15T10:00:00.000Z",
      user: {
        id: "user-1",
        name: "Alice Owner",
        email: "alice@example.com",
      },
    },
    {
      id: "log-2",
      workspaceId: "ws-123",
      userId: "user-2",
      action: "DOCUMENT_DOWNLOADED",
      resourceId: "doc-1",
      resourceName: "Annual_Report.pdf",
      details: { downloadType: "file", sizeBytes: 1048576 },
      createdAt: "2026-11-15T11:00:00.000Z",
      user: {
        id: "user-2",
        name: "Bob Admin",
        email: "bob@example.com",
      },
    },
    {
      id: "log-3",
      workspaceId: "ws-123",
      userId: "user-1",
      action: "DOCUMENT_DELETED",
      resourceId: "doc-old",
      resourceName: "Old_Draft.docx",
      details: { sizeBytes: 20480 },
      createdAt: "2026-11-15T12:00:00.000Z",
      user: {
        id: "user-1",
        name: "Alice Owner",
        email: "alice@example.com",
      },
    },
    {
      id: "log-4",
      workspaceId: "ws-123",
      userId: "user-2",
      action: "MEMBER_INVITED",
      resourceId: "inv-1",
      resourceName: "newhire@example.com",
      details: { email: "newhire@example.com", role: "MEMBER" },
      createdAt: "2026-11-15T13:00:00.000Z",
      user: {
        id: "user-2",
        name: "Bob Admin",
        email: "bob@example.com",
      },
    },
    {
      id: "log-5",
      workspaceId: "ws-123",
      userId: "user-1",
      action: "ROLE_CHANGED",
      resourceId: "user-3",
      resourceName: "Charlie Member",
      details: {
        targetUserId: "user-3",
        oldRole: "MEMBER",
        newRole: "ADMIN",
      },
      createdAt: "2026-11-15T14:00:00.000Z",
      user: {
        id: "user-1",
        name: "Alice Owner",
        email: "alice@example.com",
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.getWorkspaceId).mockReturnValue("ws-123");
    vi.mocked(api.getWorkspaceRole).mockResolvedValue("ADMIN");
    vi.mocked(api.getWorkspaceAuditLogs).mockResolvedValue({
      logs: mockAuditLogs,
      total: mockAuditLogs.length,
      limit: 100,
      offset: 0,
    });
  });

  it("displays Access Restricted when user role is MEMBER", async () => {
    vi.mocked(api.getWorkspaceRole).mockResolvedValue("MEMBER");

    render(<ActivityAuditPage />);

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Access Restricted" })).toBeTruthy();
    });

    expect(screen.getByText(/You are a Member of this workspace/i)).toBeTruthy();
  });

  it("renders audit logs table and summary metric cards for ADMIN", async () => {
    render(<ActivityAuditPage />);

    await waitFor(() => {
      expect(screen.getByText("Activity and Audit")).toBeTruthy();
    });

    // Check summary metric cards
    expect(screen.getByText("Total Events")).toBeTruthy();
    expect(screen.getByText("Uploads")).toBeTruthy();
    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(screen.getByText("Deletions")).toBeTruthy();

    // Check that all 5 action types are displayed
    expect(screen.getAllByText("Document Uploaded").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Document Downloaded").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Document Deleted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Member Invited").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Role Changed").length).toBeGreaterThan(0);

    // Check resource names
    expect(screen.getAllByText("Annual_Report.pdf").length).toBeGreaterThan(0);
    expect(screen.getByText("Old_Draft.docx")).toBeTruthy();
    expect(screen.getByText("newhire@example.com")).toBeTruthy();
    expect(screen.getByText("Charlie Member")).toBeTruthy();

    // Check actors
    expect(screen.getAllByText("Alice Owner").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bob Admin").length).toBeGreaterThan(0);
  });

  it("filters logs by search query", async () => {
    render(<ActivityAuditPage />);

    await waitFor(() => {
      expect(screen.getByText("Old_Draft.docx")).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/Search by user, document, or event details/i);
    fireEvent.change(searchInput, { target: { value: "Annual_Report" } });

    // Should only show Annual_Report rows
    expect(screen.getAllByText("Annual_Report.pdf").length).toBeGreaterThan(0);
    expect(screen.queryByText("Old_Draft.docx")).toBeNull();
    expect(screen.queryByText("newhire@example.com")).toBeNull();
  });

  it("filters logs by action dropdown", async () => {
    render(<ActivityAuditPage />);

    await waitFor(() => {
      expect(screen.getByText("Activity and Audit")).toBeTruthy();
    });

    const select = screen.getByLabelText(/Action:/i);
    fireEvent.change(select, { target: { value: "DOCUMENT_UPLOADED" } });

    await waitFor(() => {
      expect(api.getWorkspaceAuditLogs).toHaveBeenCalledWith("ws-123", {
        action: "DOCUMENT_UPLOADED",
        limit: 100,
      });
    });
  });

  it("shows empty state when search finds no results", async () => {
    render(<ActivityAuditPage />);

    await waitFor(() => {
      expect(screen.getByText("Activity and Audit")).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/Search by user, document, or event details/i);
    fireEvent.change(searchInput, { target: { value: "non-existent-search-term" } });

    expect(screen.getByText("No matching activity records")).toBeTruthy();
    expect(screen.getByText("Reset Filters")).toBeTruthy();

    // Click reset filters
    fireEvent.click(screen.getByText("Reset Filters"));
    expect(screen.getByText("Old_Draft.docx")).toBeTruthy();
  });

  it("refreshes data when refresh button is clicked", async () => {
    render(<ActivityAuditPage />);

    await waitFor(() => {
      expect(screen.getByText("Activity and Audit")).toBeTruthy();
    });

    const refreshBtn = screen.getByRole("button", { name: /Refresh/i });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(api.getWorkspaceAuditLogs).toHaveBeenCalledTimes(2);
    });
  });
});
