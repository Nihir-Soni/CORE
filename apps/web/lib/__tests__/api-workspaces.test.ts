import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getWorkspaces, createWorkspace, ApiError } from "../api";
import * as auth from "../auth";

describe("api: getWorkspaces and createWorkspace", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(auth, "getAccessToken").mockReturnValue("test-token");
    vi.spyOn(auth, "getRefreshToken").mockReturnValue("refresh-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("getWorkspaces", () => {
    it("makes GET request to /workspaces with Bearer token", async () => {
      const mockWorkspaces = [
        { id: "ws-1", name: "Default", orgId: "org-1", role: "OWNER", documentCount: 5, memberCount: 2 },
        { id: "ws-2", name: "Project Atlas", orgId: "org-1", role: "MEMBER", documentCount: 1, memberCount: 4 },
      ];
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockWorkspaces,
      });
      globalThis.fetch = mockFetch;

      const result = await getWorkspaces();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/workspaces",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          }),
        })
      );
      expect(result).toEqual(mockWorkspaces);
    });

    it("throws ApiError on failure", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "internal_error" }),
      });
      globalThis.fetch = mockFetch;

      await expect(getWorkspaces()).rejects.toThrow();
    });
  });

  describe("createWorkspace", () => {
    it("makes POST request to /workspaces with payload and Bearer token", async () => {
      const createdWs = {
        id: "ws-new",
        name: "New Workspace",
        orgId: "org-1",
        role: "OWNER",
        documentCount: 0,
        memberCount: 1,
      };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => createdWs,
      });
      globalThis.fetch = mockFetch;

      const result = await createWorkspace({ name: "New Workspace" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/workspaces",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "New Workspace" }),
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          }),
        })
      );
      expect(result).toEqual(createdWs);
    });
  });
});
