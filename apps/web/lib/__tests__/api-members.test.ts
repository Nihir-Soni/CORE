import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getWorkspaceMembers,
  getWorkspaceInvitations,
  createWorkspaceInvitation,
  revokeWorkspaceInvitation,
  changeMemberRole,
  removeWorkspaceMember,
  getInvitationDetails,
  acceptInvitation,
  ApiError,
} from "../api";
import * as auth from "../auth";

describe("api: Workspace Members & Invitations", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(auth, "getAccessToken").mockReturnValue("test-token");
    vi.spyOn(auth, "getRefreshToken").mockReturnValue("refresh-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("getWorkspaceMembers", () => {
    it("fetches members list with authorization header", async () => {
      const mockMembers = [
        {
          userId: "user-1",
          name: "Alice Owner",
          email: "alice@example.com",
          role: "OWNER",
          createdAt: "2026-10-12T10:00:00.000Z",
        },
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockMembers,
      });
      globalThis.fetch = mockFetch;

      const res = await getWorkspaceMembers("ws-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/workspaces/ws-1/members",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
      expect(res).toEqual(mockMembers);
    });

    it("throws ApiError if forbidden (e.g. caller is MEMBER)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: "forbidden" }),
      });
      globalThis.fetch = mockFetch;

      await expect(getWorkspaceMembers("ws-1")).rejects.toThrow(ApiError);
    });
  });

  describe("createWorkspaceInvitation", () => {
    it("posts invitation payload and returns response", async () => {
      const mockResponse = {
        id: "inv-1",
        workspaceId: "ws-1",
        email: "bob@example.com",
        role: "MEMBER",
        status: "PENDING",
        expiresAt: "2026-10-19T10:00:00.000Z",
        createdAt: "2026-10-12T10:00:00.000Z",
        inviteUrl: "http://localhost:3000/invite/raw-token",
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => mockResponse,
      });
      globalThis.fetch = mockFetch;

      const res = await createWorkspaceInvitation("ws-1", {
        email: "bob@example.com",
        role: "MEMBER",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/workspaces/ws-1/invitations",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "bob@example.com", role: "MEMBER" }),
        }),
      );
      expect(res).toEqual(mockResponse);
    });

    it("throws ApiError on conflict if user already member", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "already_member" }),
      });
      globalThis.fetch = mockFetch;

      await expect(
        createWorkspaceInvitation("ws-1", { email: "existing@example.com", role: "MEMBER" }),
      ).rejects.toThrow(ApiError);
    });
  });

  describe("changeMemberRole", () => {
    it("patches member role", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, userId: "user-2", role: "ADMIN" }),
      });
      globalThis.fetch = mockFetch;

      const res = await changeMemberRole("ws-1", "user-2", "ADMIN");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/workspaces/ws-1/members/user-2/role",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ role: "ADMIN" }),
        }),
      );
      expect(res).toEqual({ ok: true, userId: "user-2", role: "ADMIN" });
    });
  });

  describe("removeWorkspaceMember", () => {
    it("sends delete request to remove member", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, removedUserId: "user-2" }),
      });
      globalThis.fetch = mockFetch;

      const res = await removeWorkspaceMember("ws-1", "user-2");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/workspaces/ws-1/members/user-2",
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(res).toEqual({ ok: true, removedUserId: "user-2" });
    });
  });

  describe("revokeWorkspaceInvitation", () => {
    it("sends delete request to revoke invitation", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, revokedInvitationId: "inv-1" }),
      });
      globalThis.fetch = mockFetch;

      const res = await revokeWorkspaceInvitation("ws-1", "inv-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/workspaces/ws-1/invitations/inv-1",
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(res).toEqual({ ok: true, revokedInvitationId: "inv-1" });
    });
  });

  describe("getInvitationDetails", () => {
    it("fetches invitation details by token without auth required", async () => {
      const mockDetails = {
        id: "inv-1",
        workspaceId: "ws-1",
        workspaceName: "Engineering",
        email: "bob@example.com",
        role: "MEMBER",
        status: "PENDING",
        expiresAt: "2026-10-19T10:00:00.000Z",
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockDetails,
      });
      globalThis.fetch = mockFetch;

      const res = await getInvitationDetails("sample-raw-token");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/invitations/sample-raw-token",
        expect.any(Object),
      );
      expect(res).toEqual(mockDetails);
    });
  });

  describe("acceptInvitation", () => {
    it("posts acceptance token and returns workspace info", async () => {
      const mockAcceptRes = {
        ok: true,
        workspaceId: "ws-1",
        workspaceName: "Engineering",
        role: "MEMBER",
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAcceptRes,
      });
      globalThis.fetch = mockFetch;

      const res = await acceptInvitation("sample-raw-token");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/invitations/accept",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ token: "sample-raw-token" }),
        }),
      );
      expect(res).toEqual(mockAcceptRes);
    });
  });
});
