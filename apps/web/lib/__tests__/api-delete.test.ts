import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deleteDocument, getWorkspaceRole, ApiError } from "../api";
import * as auth from "../auth";

describe("api: deleteDocument and getWorkspaceRole", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(auth, "getAccessToken").mockReturnValue("test-token");
    vi.spyOn(auth, "getRefreshToken").mockReturnValue("refresh-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("deleteDocument", () => {
    it("makes DELETE request to /documents/:workspaceId/:documentId with Bearer token", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, documentId: "doc-1", status: "DELETED" }),
      });
      globalThis.fetch = mockFetch;

      const result = await deleteDocument("ws-1", "doc-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/documents/ws-1/doc-1",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          }),
        })
      );
      expect(result).toEqual({ ok: true, documentId: "doc-1", status: "DELETED" });
    });

    it("throws ApiError on 401 unauthorized", async () => {
      // First call returns 401, refresh fails
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/auth/refresh")) {
          return { ok: false, status: 401, json: async () => ({ error: "invalid_refresh_token" }) };
        }
        return { ok: false, status: 401, json: async () => ({ error: "missing_token" }) };
      });
      globalThis.fetch = mockFetch;

      await expect(deleteDocument("ws-1", "doc-1")).rejects.toThrow("Session expired.");
    });

    it("throws ApiError on 403 forbidden", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: "forbidden" }),
      });
      globalThis.fetch = mockFetch;

      await expect(deleteDocument("ws-1", "doc-1")).rejects.toMatchObject({
        name: "ApiError",
        status: 403,
        message: "forbidden",
      });
    });

    it("throws ApiError on 404 not found", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "not_found" }),
      });
      globalThis.fetch = mockFetch;

      await expect(deleteDocument("ws-1", "doc-1")).rejects.toMatchObject({
        name: "ApiError",
        status: 404,
        message: "not_found",
      });
    });

    it("throws ApiError with payload on 502 storage_cleanup_failed", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({
          error: "storage_cleanup_failed",
          documentId: "doc-1",
          status: "DELETING",
        }),
      });
      globalThis.fetch = mockFetch;

      try {
        await deleteDocument("ws-1", "doc-1");
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(502);
        expect(apiErr.message).toBe("storage_cleanup_failed");
        expect(apiErr.data).toEqual({
          error: "storage_cleanup_failed",
          documentId: "doc-1",
          status: "DELETING",
        });
      }
    });
  });

  describe("getWorkspaceRole", () => {
    it("calls /workspaces/:workspaceId/role and returns role", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ role: "ADMIN" }),
      });
      globalThis.fetch = mockFetch;

      const role = await getWorkspaceRole("ws-1");
      expect(role).toBe("ADMIN");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/workspaces/ws-1/role",
        expect.any(Object)
      );
    });

    it("falls back to getWorkspace if /role returns non-OK", async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/role")) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "ws-1", name: "Default", orgId: "org-1", role: "OWNER" }),
        };
      });
      globalThis.fetch = mockFetch;

      const role = await getWorkspaceRole("ws-1");
      expect(role).toBe("OWNER");
    });

    it("returns null if both calls fail", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "internal_error" }),
      });
      globalThis.fetch = mockFetch;

      const role = await getWorkspaceRole("ws-1");
      expect(role).toBeNull();
    });
  });
});
