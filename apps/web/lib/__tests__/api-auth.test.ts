import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { login, register, ApiError } from "../api";
import * as auth from "../auth";

describe("api auth error handling", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("throws ApiError on 401 invalid credentials without triggering refresh or window reload", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "invalid_credentials" }),
    });

    let errorCaught: ApiError | null = null;
    try {
      await login({ email: "wrong@example.com", password: "wrongpassword" });
    } catch (err) {
      if (err instanceof ApiError) {
        errorCaught = err;
      }
    }

    expect(errorCaught).toBeTruthy();
    expect(errorCaught?.status).toBe(401);
    expect(errorCaught?.message).toBe("invalid_credentials");

    // fetch was only called once for /auth/login and not for /auth/refresh
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as any).mock.calls[0][0]).toContain("/auth/login");
  });

  it("throws ApiError on 409 email conflict without redirecting", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "email_taken" }),
    });

    let errorCaught: ApiError | null = null;
    try {
      await register({
        name: "Test User",
        email: "taken@example.com",
        password: "password123",
        orgName: "Test Org",
      });
    } catch (err) {
      if (err instanceof ApiError) {
        errorCaught = err;
      }
    }

    expect(errorCaught).toBeTruthy();
    expect(errorCaught?.status).toBe(409);
    expect(errorCaught?.message).toBe("email_taken");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as any).mock.calls[0][0]).toContain("/auth/register");
  });
});
