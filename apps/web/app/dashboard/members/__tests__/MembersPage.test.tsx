import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import MembersPage from "../page";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import type { WorkspaceMember, WorkspaceInvitation } from "@/lib/types";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getWorkspaceRole: vi.fn(),
    getWorkspaceMembers: vi.fn(),
    getWorkspaceInvitations: vi.fn(),
  };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getWorkspaceId: vi.fn(),
    getCurrentUser: vi.fn(),
  };
});

describe("MembersPage", () => {
  const mockMembers: WorkspaceMember[] = [
    {
      userId: "user-owner",
      name: "Alice Owner",
      email: "alice@example.com",
      role: "OWNER",
      createdAt: "2026-10-12T10:00:00.000Z",
    },
    {
      userId: "user-admin",
      name: "Bob Admin",
      email: "bob@example.com",
      role: "ADMIN",
      createdAt: "2026-10-12T10:05:00.000Z",
    },
    {
      userId: "user-member",
      name: "Charlie Member",
      email: "charlie@example.com",
      role: "MEMBER",
      createdAt: "2026-10-12T10:10:00.000Z",
    },
  ];

  const mockInvitations: WorkspaceInvitation[] = [
    {
      id: "inv-1",
      workspaceId: "ws-123",
      email: "pending@example.com",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: "2026-10-19T10:00:00.000Z",
      createdAt: "2026-10-12T10:00:00.000Z",
      invitedBy: {
        id: "user-owner",
        name: "Alice Owner",
        email: "alice@example.com",
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.getWorkspaceId).mockReturnValue("ws-123");
    vi.mocked(api.getWorkspaceMembers).mockResolvedValue(mockMembers);
    vi.mocked(api.getWorkspaceInvitations).mockResolvedValue(mockInvitations);
  });

  it("displays Access Restricted when the authenticated user is a MEMBER", async () => {
    vi.mocked(auth.getCurrentUser).mockReturnValue({
      userId: "user-member",
      email: "charlie@example.com",
    });
    vi.mocked(api.getWorkspaceRole).mockResolvedValue("MEMBER");

    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /access restricted/i })).toBeTruthy();
      expect(screen.getByText(/you are a member of this workspace/i)).toBeTruthy();
    });

    // Does not call getWorkspaceMembers or getWorkspaceInvitations
    expect(api.getWorkspaceMembers).not.toHaveBeenCalled();
    expect(api.getWorkspaceInvitations).not.toHaveBeenCalled();
  });

  it("displays members and invitations for OWNER with full management actions", async () => {
    vi.mocked(auth.getCurrentUser).mockReturnValue({
      userId: "user-owner",
      email: "alice@example.com",
    });
    vi.mocked(api.getWorkspaceRole).mockResolvedValue("OWNER");

    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText("Alice Owner")).toBeTruthy();
      expect(screen.getByText("Bob Admin")).toBeTruthy();
      expect(screen.getByText("Charlie Member")).toBeTruthy();
      expect(screen.getByText("pending@example.com")).toBeTruthy();
    });

    // Invite Member button is present
    expect(screen.getByRole("button", { name: /invite member/i })).toBeTruthy();

    // OWNER can see "Change Role" buttons on other members (Bob and Charlie)
    const changeRoleButtons = screen.getAllByRole("button", { name: /change role/i });
    expect(changeRoleButtons.length).toBe(2);

    // OWNER can see "Remove" buttons on other members
    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    expect(removeButtons.length).toBe(2);
  });

  it("displays members for ADMIN, restricting role editing and cross-admin removal", async () => {
    vi.mocked(auth.getCurrentUser).mockReturnValue({
      userId: "user-admin",
      email: "bob@example.com",
    });
    vi.mocked(api.getWorkspaceRole).mockResolvedValue("ADMIN");

    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText("Alice Owner")).toBeTruthy();
      expect(screen.getByText("Bob Admin")).toBeTruthy();
      expect(screen.getByText("Charlie Member")).toBeTruthy();
    });

    // ADMIN can see Invite Member
    expect(screen.getByRole("button", { name: /invite member/i })).toBeTruthy();

    // ADMIN cannot see any "Change Role" buttons
    expect(screen.queryByRole("button", { name: /change role/i })).toBeNull();

    // ADMIN can only remove Charlie Member (1 remove button)
    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    expect(removeButtons.length).toBe(1);
  });

  it("filters members list based on search query", async () => {
    vi.mocked(auth.getCurrentUser).mockReturnValue({
      userId: "user-owner",
      email: "alice@example.com",
    });
    vi.mocked(api.getWorkspaceRole).mockResolvedValue("OWNER");

    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText("Alice Owner")).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/filter by name or email/i);
    fireEvent.change(searchInput, { target: { value: "charlie" } });

    expect(screen.getByText("Charlie Member")).toBeTruthy();
    expect(screen.queryByText("Alice Owner")).toBeNull();
    expect(screen.queryByText("Bob Admin")).toBeNull();
  });
});
