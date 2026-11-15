/**
 * Centralized API client.
 * All fetch calls go through this module — never scatter raw fetch() in components.
 *
 * Automatic token refresh:
 *   On 401, attempts one refresh then retries the original request.
 *   On refresh failure, clears auth state and redirects to /login.
 *   A guard prevents concurrent refresh calls from creating loops.
 */

import {
  getAccessToken,
  getRefreshToken,
  setAuth,
  clearAuth,
} from "./auth";
import type {
  AuthResponse,
  CompleteUploadResponse,
  Document,
  LoginPayload,
  MultipartCompleteResponse,
  MultipartInitiateResponse,
  MultipartSessionResponse,
  PartUrlResponse,
  RegisterPayload,
  UploadUrlResponse,
  UploadedPart,
  Workspace,
  DocumentContent,
  DocumentDownloadInfo,
  DeleteDocumentResponse,
  WorkspaceMember,
  WorkspaceInvitation,
  CreateInvitationPayload,
  CreateInvitationResponse,
  InvitationDetailsResponse,
  AcceptInvitationResponse,
  MemberRole,
  InvitationRole,
  InvitationStatus,
  UserProfile,
  AuditLog,
  AuditLogsResponse,
  WorkspaceAnalytics,
} from "./types";
export type {
  DeleteDocumentResponse,
  WorkspaceMember,
  WorkspaceInvitation,
  CreateInvitationPayload,
  CreateInvitationResponse,
  InvitationDetailsResponse,
  AcceptInvitationResponse,
  MemberRole,
  InvitationRole,
  InvitationStatus,
  UserProfile,
  AuditLog,
  AuditLogsResponse,
  WorkspaceAnalytics,
};

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Refresh state — prevents concurrent refresh loops
let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

function notifyRefreshQueue(token: string | null) {
  refreshQueue.forEach((cb) => cb(token));
  refreshQueue = [];
}

async function attemptRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as AuthResponse;
  setAuth(data.token, data.refreshToken, data.workspaceId);
  return data.token;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  const isAuthEndpoint =
    path === "/auth/login" ||
    path === "/auth/register" ||
    path === "/auth/refresh" ||
    path === "/auth/logout";

  if (res.status === 401 && retry && !isAuthEndpoint && Boolean(getRefreshToken())) {
    // Avoid concurrent refresh calls
    if (isRefreshing) {
      return new Promise<T>((resolve, reject) => {
        refreshQueue.push((newToken) => {
          if (!newToken) {
            reject(new Error("Session expired."));
            return;
          }
          request<T>(path, options, false).then(resolve).catch(reject);
        });
      });
    }

    isRefreshing = true;
    const newToken = await attemptRefresh();
    isRefreshing = false;
    notifyRefreshQueue(newToken);

    if (!newToken) {
      clearAuth();
      if (typeof window !== "undefined") {
        window.location.href = "/";
      }
      throw new Error("Session expired.");
    }

    return request<T>(path, options, false);
  }

  if (!res.ok) {
    let errorMessage = "An unexpected error occurred.";
    let errorData: unknown = null;
    try {
      const body = await res.json();
      errorData = body;
      errorMessage = body?.error ?? errorMessage;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(errorMessage, res.status, errorData);
  }

  // Handle 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function register(payload: RegisterPayload): Promise<AuthResponse> {
  return request<AuthResponse>(
    "/auth/register",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    false,
  );
}

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  return request<AuthResponse>(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    false,
  );
}

export async function refreshAccessToken(): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: getRefreshToken() }),
  });
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    await request<void>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {
      // Best-effort logout — clear local state regardless
    });
  }
  clearAuth();
}

export async function getMe(): Promise<UserProfile> {
  return request<UserProfile>("/auth/me");
}

// ─── Workspaces ───────────────────────────────────────────────────────────────

export async function getWorkspaces(): Promise<Workspace[]> {
  return request<Workspace[]>("/workspaces");
}

export async function createWorkspace(payload: { name: string }): Promise<Workspace> {
  return request<Workspace>("/workspaces", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getWorkspace(workspaceId: string): Promise<Workspace> {
  return request<Workspace>(`/workspaces/${workspaceId}`);
}

export async function getWorkspaceRole(workspaceId: string): Promise<string | null> {
  try {
    const res = await request<{ role: string | null }>(`/workspaces/${workspaceId}/role`);
    return res.role;
  } catch {
    try {
      const ws = await getWorkspace(workspaceId);
      return ws.role ?? null;
    } catch {
      return null;
    }
  }
}

// ─── Workspace Members & Invitations ─────────────────────────────────────────

export async function getWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  return request<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`);
}

export async function changeMemberRole(
  workspaceId: string,
  userId: string,
  role: InvitationRole,
): Promise<{ ok: boolean; userId: string; role: string }> {
  return request<{ ok: boolean; userId: string; role: string }>(
    `/workspaces/${workspaceId}/members/${userId}/role`,
    {
      method: "PATCH",
      body: JSON.stringify({ role }),
    },
  );
}

export async function removeWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<{ ok: boolean; removedUserId: string }> {
  return request<{ ok: boolean; removedUserId: string }>(
    `/workspaces/${workspaceId}/members/${userId}`,
    {
      method: "DELETE",
    },
  );
}

export async function getWorkspaceInvitations(
  workspaceId: string,
): Promise<WorkspaceInvitation[]> {
  return request<WorkspaceInvitation[]>(`/workspaces/${workspaceId}/invitations`);
}

export async function createWorkspaceInvitation(
  workspaceId: string,
  payload: CreateInvitationPayload,
): Promise<CreateInvitationResponse> {
  return request<CreateInvitationResponse>(
    `/workspaces/${workspaceId}/invitations`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function revokeWorkspaceInvitation(
  workspaceId: string,
  invitationId: string,
): Promise<{ ok: boolean; revokedInvitationId: string }> {
  return request<{ ok: boolean; revokedInvitationId: string }>(
    `/workspaces/${workspaceId}/invitations/${invitationId}`,
    {
      method: "DELETE",
    },
  );
}

// ─── Workspace Activity & Audit Logs ────────────────────────────────────────

export async function getWorkspaceAuditLogs(
  workspaceId: string,
  options?: { action?: string; limit?: number; offset?: number },
): Promise<AuditLogsResponse> {
  const query = new URLSearchParams();
  if (options?.action) query.set("action", options.action);
  if (options?.limit) query.set("limit", String(options.limit));
  if (options?.offset) query.set("offset", String(options.offset));

  const queryStr = query.toString();
  const path = `/workspaces/${workspaceId}/audit-logs${queryStr ? `?${queryStr}` : ""}`;
  return request<AuditLogsResponse>(path);
}

// ─── Workspace Analytics ────────────────────────────────────────────────────

export async function getWorkspaceAnalytics(
  workspaceId: string,
): Promise<WorkspaceAnalytics> {
  return request<WorkspaceAnalytics>(`/workspaces/${workspaceId}/analytics`);
}

// ─── Public / Accept Invitation ─────────────────────────────────────────────

export async function getInvitationDetails(
  token: string,
): Promise<InvitationDetailsResponse> {
  return request<InvitationDetailsResponse>(`/invitations/${encodeURIComponent(token)}`);
}

export async function acceptInvitation(
  token: string,
): Promise<AcceptInvitationResponse> {
  return request<AcceptInvitationResponse>("/invitations/accept", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

// ─── Documents ───────────────────────────────────────────────────────────────

export async function getDocuments(workspaceId: string): Promise<Document[]> {
  return request<Document[]>(`/documents/${workspaceId}`);
}

export async function deleteDocument(
  workspaceId: string,
  documentId: string,
): Promise<DeleteDocumentResponse> {
  return request<DeleteDocumentResponse>(
    `/documents/${workspaceId}/${documentId}`,
    {
      method: "DELETE",
    },
  );
}

export async function requestUploadUrl(
  workspaceId: string,
  payload: { filename: string; mimeType: string; sizeBytes: number },
): Promise<UploadUrlResponse> {
  return request<UploadUrlResponse>(`/documents/${workspaceId}/upload-url`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function completeUpload(
  workspaceId: string,
  documentId: string,
): Promise<CompleteUploadResponse> {
  return request<CompleteUploadResponse>(`/documents/${workspaceId}/${documentId}/complete`, {
    method: "POST",
  });
}

export function getDocumentFileUrl(
  workspaceId: string,
  documentId: string,
  disposition: "inline" | "attachment" = "inline",
): string {
  const token = getAccessToken();
  const params = new URLSearchParams();
  params.set("disposition", disposition);
  if (token) {
    params.set("token", token);
  }
  return `${BASE_URL}/documents/${workspaceId}/${documentId}/file?${params.toString()}`;
}

export async function getDocumentContent(
  workspaceId: string,
  documentId: string,
): Promise<DocumentContent> {
  return request<DocumentContent>(`/documents/${workspaceId}/${documentId}/content`);
}

export async function getDocumentDownloadInfo(
  workspaceId: string,
  documentId: string,
): Promise<DocumentDownloadInfo> {
  return request<DocumentDownloadInfo>(`/documents/${workspaceId}/${documentId}/download-url`);
}

export async function downloadDocument(
  workspaceId: string,
  doc: { id: string; filename: string },
): Promise<void> {
  const url = getDocumentFileUrl(workspaceId, doc.id, "attachment");
  const token = getAccessToken();

  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to download file (${response.status} ${response.statusText})`);
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = doc.filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(downloadUrl);
}

/**
 * PUT file bytes directly to MinIO via presigned URL.
 * This never goes through the Express API.
 */
export async function uploadFileToStorage(
  uploadUrl: string,
  file: File,
  contentTypeOrProgress?: string | null | ((percent: number) => void),
  onProgress?: (percent: number) => void,
): Promise<void> {
  const progressFn = typeof contentTypeOrProgress === "function" ? contentTypeOrProgress : onProgress;
  const contentType = typeof contentTypeOrProgress === "string" && contentTypeOrProgress
    ? contentTypeOrProgress
    : (file.type || "application/octet-stream");

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);

    if (progressFn) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          progressFn(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Storage upload failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Storage upload failed."));
    xhr.send(file);
  });
}

// ── Multipart Upload ──────────────────────────────────────────────────────────────────

export async function initiateMultipart(
  workspaceId: string,
  payload: { filename: string; mimeType: string; sizeBytes: number },
): Promise<MultipartInitiateResponse> {
  return request<MultipartInitiateResponse>(
    `/documents/${workspaceId}/multipart/initiate`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function getMultipartSession(
  workspaceId: string,
  sessionId: string,
): Promise<MultipartSessionResponse> {
  return request<MultipartSessionResponse>(
    `/documents/${workspaceId}/multipart/${sessionId}`,
  );
}

export async function getPartUrl(
  workspaceId: string,
  sessionId: string,
  partNumber: number,
): Promise<PartUrlResponse> {
  return request<PartUrlResponse>(
    `/documents/${workspaceId}/multipart/${sessionId}/part-url`,
    { method: "POST", body: JSON.stringify({ partNumber }) },
  );
}

export async function completeMultipart(
  workspaceId: string,
  sessionId: string,
  parts: UploadedPart[],
): Promise<MultipartCompleteResponse> {
  return request<MultipartCompleteResponse>(
    `/documents/${workspaceId}/multipart/${sessionId}/complete`,
    { method: "POST", body: JSON.stringify({ parts }) },
  );
}

export async function abortMultipart(
  workspaceId: string,
  sessionId: string,
): Promise<{ status: string }> {
  return request<{ status: string }>(
    `/documents/${workspaceId}/multipart/${sessionId}/abort`,
    { method: "POST" },
  );
}
