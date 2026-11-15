import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import InviteAcceptPage from "../[token]/page";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import type { InvitationDetailsResponse } from "@/lib/types";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ token: "valid-token-123" }),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getInvitationDetails: vi.fn(),
    acceptInvitation: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    isAuthenticated: vi.fn(),
    getCurrentUser: vi.fn(),
    getWorkspaceId: vi.fn(),
  };
});

describe("InviteAcceptPage", () => {
  const mockInvitation: InvitationDetailsResponse = {
    id: "inv-1",
    workspaceId: "ws-99",
    workspaceName: "Hyperion Labs",
    email: "colleague@example.com",
    role: "MEMBER",
    status: "PENDING",
    expiresAt: "2026-10-19T10:00:00.000Z",
    invitedBy: {
      name: "Admin User",
      email: "admin@example.com",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(api.getInvitationDetails).mockResolvedValue(mockInvitation);
  });

  it("prompts unauthenticated users to sign in or register with returnTo link", async () => {
    vi.mocked(auth.isAuthenticated).mockReturnValue(false);
    vi.mocked(auth.getCurrentUser).mockReturnValue(null);

    render(<InviteAcceptPage />);

    await waitFor(() => {
      expect(screen.getByText("Hyperion Labs")).toBeTruthy();
      expect(screen.getAllByText("colleague@example.com").length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getByRole("button", { name: /sign in to accept/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /create account/i })).toBeTruthy();
  });

  it("warns about email mismatch when authenticated user email differs from invite", async () => {
    vi.mocked(auth.isAuthenticated).mockReturnValue(true);
    vi.mocked(auth.getCurrentUser).mockReturnValue({
      userId: "user-diff",
      email: "otheruser@example.com",
    });

    render(<InviteAcceptPage />);

    await waitFor(() => {
      expect(screen.getByText(/email address mismatch/i)).toBeTruthy();
      expect(screen.getByText(/otheruser@example.com/i)).toBeTruthy();
      expect(screen.getAllByText(/colleague@example.com/i).length).toBeGreaterThanOrEqual(1);
    });

    // Accept button should not be present
    expect(screen.queryByRole("button", { name: /accept invitation/i })).toBeNull();
    // Switch account button is present
    expect(screen.getByRole("button", { name: /switch account/i })).toBeTruthy();
  });

  it("allows matching authenticated user to accept invitation and updates active workspace", async () => {
    vi.mocked(auth.isAuthenticated).mockReturnValue(true);
    vi.mocked(auth.getCurrentUser).mockReturnValue({
      userId: "user-matching",
      email: "colleague@example.com",
    });
    vi.mocked(api.acceptInvitation).mockResolvedValue({
      ok: true,
      workspaceId: "ws-99",
      workspaceName: "Hyperion Labs",
      role: "MEMBER",
    });

    render(<InviteAcceptPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /accept invitation/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    await waitFor(() => {
      expect(api.acceptInvitation).toHaveBeenCalledWith("valid-token-123");
      expect(localStorage.getItem("core_workspace_id")).toBe("ws-99");
      expect(screen.getByText(/welcome to Hyperion Labs!/i)).toBeTruthy();
    });
  });

  it("displays expired/revoked status when invitation is no longer pending", async () => {
    vi.mocked(auth.isAuthenticated).mockReturnValue(true);
    vi.mocked(auth.getCurrentUser).mockReturnValue({
      userId: "user-matching",
      email: "colleague@example.com",
    });
    vi.mocked(api.getInvitationDetails).mockResolvedValue({
      ...mockInvitation,
      status: "REVOKED",
    });

    render(<InviteAcceptPage />);

    await waitFor(() => {
      expect(screen.getByText("REVOKED")).toBeTruthy();
      expect(screen.getByText(/this invitation is no longer valid/i)).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: /accept invitation/i })).toBeNull();
  });

  it("handles 404 not found for invalid invitation token", async () => {
    vi.mocked(api.getInvitationDetails).mockRejectedValueOnce(
      new api.ApiError("invitation_not_found", 404),
    );

    render(<InviteAcceptPage />);

    await waitFor(() => {
      expect(screen.getByText("Invitation Not Found")).toBeTruthy();
    });
  });
});
