import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InviteMemberDialog } from "../InviteMemberDialog";
import { ChangeRoleDialog } from "../ChangeRoleDialog";
import { RemoveMemberDialog } from "../RemoveMemberDialog";
import { RevokeInvitationDialog } from "../RevokeInvitationDialog";
import * as api from "@/lib/api";
import type { WorkspaceMember, WorkspaceInvitation } from "@/lib/types";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    createWorkspaceInvitation: vi.fn(),
    changeMemberRole: vi.fn(),
    removeWorkspaceMember: vi.fn(),
    revokeWorkspaceInvitation: vi.fn(),
  };
});

describe("Members Dialog Components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("InviteMemberDialog", () => {
    it("renders email and role options, excluding OWNER", () => {
      render(
        <InviteMemberDialog
          workspaceId="ws-123"
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      expect(screen.getByLabelText(/email address/i)).toBeTruthy();
      const roleSelect = screen.getByLabelText(/role/i) as HTMLSelectElement;
      expect(roleSelect).toBeTruthy();

      // Check options
      const options = Array.from(roleSelect.options).map((o) => o.value);
      expect(options).toContain("MEMBER");
      expect(options).toContain("ADMIN");
      expect(options).not.toContain("OWNER");
    });

    it("displays validation error if email is invalid", async () => {
      render(
        <InviteMemberDialog
          workspaceId="ws-123"
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "invalid-email" },
      });
      fireEvent.submit(screen.getByRole("button", { name: /send invitation/i }).closest("form")!);

      await waitFor(() => {
        expect(screen.getByText(/please enter a valid email address/i)).toBeTruthy();
      });
      expect(api.createWorkspaceInvitation).not.toHaveBeenCalled();
    });

    it("handles 409 conflict when user is already a member", async () => {
      vi.mocked(api.createWorkspaceInvitation).mockRejectedValueOnce(
        new api.ApiError("already_member", 409),
      );

      render(
        <InviteMemberDialog
          workspaceId="ws-123"
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "already@example.com" },
      });
      fireEvent.submit(screen.getByRole("button", { name: /send invitation/i }).closest("form")!);

      await waitFor(() => {
        expect(
          screen.getByText(/this user is already a member of this workspace/i),
        ).toBeTruthy();
      });
    });

    it("displays development invite link banner when returned in non-prod", async () => {
      vi.mocked(api.createWorkspaceInvitation).mockResolvedValueOnce({
        id: "inv-1",
        workspaceId: "ws-123",
        email: "dev@example.com",
        role: "MEMBER",
        status: "PENDING",
        expiresAt: "2026-10-19T10:00:00.000Z",
        createdAt: "2026-10-12T10:00:00.000Z",
        inviteUrl: "http://localhost:3000/invite/dev-test-token",
      });

      render(
        <InviteMemberDialog
          workspaceId="ws-123"
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "dev@example.com" },
      });
      fireEvent.submit(screen.getByRole("button", { name: /send invitation/i }).closest("form")!);

      await waitFor(() => {
        expect(screen.getByText(/invitation created successfully/i)).toBeTruthy();
        expect(screen.getByDisplayValue("http://localhost:3000/invite/dev-test-token")).toBeTruthy();
        expect(screen.getByText(/email delivery is not configured/i)).toBeTruthy();
      });
    });
  });

  describe("ChangeRoleDialog", () => {
    const mockMember: WorkspaceMember = {
      userId: "user-2",
      name: "Bob Builder",
      email: "bob@example.com",
      role: "MEMBER",
      createdAt: "2026-10-12T10:00:00.000Z",
    };

    it("renders current member info and allows selecting new role", async () => {
      const onSuccess = vi.fn();
      vi.mocked(api.changeMemberRole).mockResolvedValueOnce({
        ok: true,
        userId: "user-2",
        role: "ADMIN",
      });

      render(
        <ChangeRoleDialog
          member={mockMember}
          workspaceId="ws-123"
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />,
      );

      expect(screen.getByText(/Bob Builder/i)).toBeTruthy();
      const roleSelect = screen.getByLabelText(/new role/i);
      fireEvent.change(roleSelect, { target: { value: "ADMIN" } });
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(api.changeMemberRole).toHaveBeenCalledWith("ws-123", "user-2", "ADMIN");
        expect(onSuccess).toHaveBeenCalledWith({
          ok: true,
          userId: "user-2",
          role: "ADMIN",
        });
      });
    });

    it("displays error when demoting last owner fails", async () => {
      const ownerMember: WorkspaceMember = {
        userId: "user-1",
        name: "Sole Owner",
        email: "owner@example.com",
        role: "OWNER",
        createdAt: "2026-10-12T10:00:00.000Z",
      };

      vi.mocked(api.changeMemberRole).mockRejectedValueOnce(
        new api.ApiError("cannot_demote_last_owner", 400),
      );

      render(
        <ChangeRoleDialog
          member={ownerMember}
          workspaceId="ws-123"
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/cannot demote the last owner of this workspace/i),
        ).toBeTruthy();
      });
    });
  });

  describe("RemoveMemberDialog", () => {
    const mockMember: WorkspaceMember = {
      userId: "user-3",
      name: "Carol Danvers",
      email: "carol@example.com",
      role: "MEMBER",
      createdAt: "2026-10-12T10:00:00.000Z",
    };

    it("confirms removal and calls removeWorkspaceMember", async () => {
      const onSuccess = vi.fn();
      vi.mocked(api.removeWorkspaceMember).mockResolvedValueOnce({
        ok: true,
        removedUserId: "user-3",
      });

      render(
        <RemoveMemberDialog
          member={mockMember}
          workspaceId="ws-123"
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />,
      );

      expect(screen.getByText(/Carol Danvers/i)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /remove member/i }));

      await waitFor(() => {
        expect(api.removeWorkspaceMember).toHaveBeenCalledWith("ws-123", "user-3");
        expect(onSuccess).toHaveBeenCalledWith("user-3");
      });
    });

    it("displays error when admin tries to remove another admin", async () => {
      vi.mocked(api.removeWorkspaceMember).mockRejectedValueOnce(
        new api.ApiError("admin_cannot_remove_admin", 403),
      );

      render(
        <RemoveMemberDialog
          member={mockMember}
          workspaceId="ws-123"
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /remove member/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/administrators cannot remove other administrators/i),
        ).toBeTruthy();
      });
    });
  });

  describe("RevokeInvitationDialog", () => {
    const mockInvite: WorkspaceInvitation = {
      id: "inv-99",
      workspaceId: "ws-123",
      email: "guest@example.com",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: "2026-10-19T10:00:00.000Z",
      createdAt: "2026-10-12T10:00:00.000Z",
    };

    it("confirms revocation and calls revokeWorkspaceInvitation", async () => {
      const onSuccess = vi.fn();
      vi.mocked(api.revokeWorkspaceInvitation).mockResolvedValueOnce({
        ok: true,
        revokedInvitationId: "inv-99",
      });

      render(
        <RevokeInvitationDialog
          invitation={mockInvite}
          workspaceId="ws-123"
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />,
      );

      expect(screen.getByText("guest@example.com")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /revoke invitation/i }));

      await waitFor(() => {
        expect(api.revokeWorkspaceInvitation).toHaveBeenCalledWith("ws-123", "inv-99");
        expect(onSuccess).toHaveBeenCalledWith("inv-99");
      });
    });
  });
});
