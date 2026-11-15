/**
 * Centralized token management.
 * All token reads/writes go through this module.
 * No other module should touch localStorage directly for auth state.
 */

const ACCESS_TOKEN_KEY = "core_access_token";
const REFRESH_TOKEN_KEY = "core_refresh_token";
const WORKSPACE_ID_KEY = "core_workspace_id";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export const WORKSPACE_CHANGED_EVENT = "core_workspace_changed";

export function getWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(WORKSPACE_ID_KEY);
}

export function setWorkspaceId(workspaceId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(WORKSPACE_ID_KEY, workspaceId);
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_CHANGED_EVENT, { detail: { workspaceId } })
  );
}

export function setAuth(
  accessToken: string,
  refreshToken: string,
  workspaceId: string | null,
): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  if (workspaceId) {
    localStorage.setItem(WORKSPACE_ID_KEY, workspaceId);
  }
}

export function clearAuth(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(WORKSPACE_ID_KEY);
}

export function isAuthenticated(): boolean {
  return Boolean(getAccessToken());
}

export function getCurrentUser(): { userId: string; email: string; name?: string | null } | null {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload?.userId) return null;
    return {
      userId: payload.userId,
      email: payload.email || "",
      name: payload.name || null,
    };
  } catch {
    return null;
  }
}
