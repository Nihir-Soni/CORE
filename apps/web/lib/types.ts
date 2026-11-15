export type DocumentStatus =
  | "UPLOADING"
  | "UPLOADED"
  | "PROCESSING"
  | "READY"
  | "FAILED"
  | "DELETING";

export interface Document {
  id: string;
  workspaceId: string;
  uploadedById: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  sha256: string | null;
  status: DocumentStatus;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  workspaceId: string | null;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  orgName: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface UploadUrlResponse {
  documentId: string;
  uploadUrl: string;
}

export interface Workspace {
  id: string;
  name: string;
  orgId: string;
  role?: "OWNER" | "ADMIN" | "MEMBER" | string | null;
  createdAt?: string;
  documentCount?: number;
  memberCount?: number;
}

export interface DeleteDocumentResponse {
  ok: boolean;
  documentId: string;
  status: "DELETED";
}

export interface ApiError {
  error: string;
}

// ── Multipart upload types ────────────────────────────────────────────────────

export interface MultipartInitiateResponse {
  sessionId: string;
  documentId: string;
  uploadId: string;
  storageKey: string;
  partSizeBytes: number;
  totalParts: number;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

export interface MultipartSessionResponse {
  sessionId: string;
  documentId: string;
  status: string;
  partSizeBytes: number;
  totalParts: number;
  uploadedParts: UploadedPart[];
}

export interface PartUrlResponse {
  partNumber: number;
  uploadUrl: string;
}

export interface CompleteUploadResponse {
  documentId: string;
  status: string;
  sha256?: string;
  duplicate?: boolean;
  canonicalDocumentId?: string;
}

export interface MultipartCompleteResponse {
  sessionId: string;
  documentId: string;
  status: string;
  duplicate?: boolean;
  canonicalDocumentId?: string;
}

export interface DocumentContent {
  documentId: string;
  charCount: number;
  pageCount: number;
  text: string;
}

export interface Citation {
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber?: number | null;
  chunkIndex: number;
  similarity: number;
  content?: string;
}

export interface DocumentDownloadInfo {
  documentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
}

// ── Workspace Member & Invitation Types ─────────────────────────────────────

export type MemberRole = "OWNER" | "ADMIN" | "MEMBER";
export type InvitationRole = "ADMIN" | "MEMBER";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface WorkspaceMember {
  userId: string;
  name: string | null;
  email: string;
  role: MemberRole;
  createdAt: string;
}

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  role: InvitationRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  invitedBy?: {
    id: string;
    name: string | null;
    email: string;
  };
}

export interface CreateInvitationPayload {
  email: string;
  role: InvitationRole;
}

export interface CreateInvitationResponse {
  id: string;
  workspaceId: string;
  email: string;
  role: InvitationRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  inviteUrl?: string;
}

export interface InvitationDetailsResponse {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: InvitationRole;
  status: InvitationStatus;
  expiresAt: string;
  invitedBy?: {
    name: string | null;
    email: string;
  };
}

export interface AcceptInvitationResponse {
  ok: boolean;
  workspaceId: string;
  workspaceName: string;
  role: MemberRole;
}

// ── Audit log types ──────────────────────────────────────────────────────────

export type AuditAction =
  | "DOCUMENT_UPLOADED"
  | "DOCUMENT_DOWNLOADED"
  | "DOCUMENT_DELETED"
  | "MEMBER_INVITED"
  | "ROLE_CHANGED";

export interface AuditLog {
  id: string;
  workspaceId: string;
  userId: string;
  action: AuditAction;
  resourceId: string | null;
  resourceName: string | null;
  details: Record<string, any> | null;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
  };
}

export interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

// ── Workspace Analytics types ────────────────────────────────────────────────

export interface DocumentMimeStat {
  mimeType: string;
  label: string;
  count: number;
  totalBytes: number;
  percentage: number;
}

export interface StorageCategoryStat {
  category: string;
  count: number;
  bytes: number;
  percentage: number;
}

export interface LargestDocumentStat {
  id: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
}

export interface RecentTrendPoint {
  date: string;
  uploads: number;
  ready: number;
}

export interface WorkspaceAnalytics {
  documentStats: {
    totalDocuments: number;
    byStatus: {
      READY: number;
      PROCESSING: number;
      UPLOADING: number;
      FAILED: number;
      DELETING: number;
    };
    processingSuccessRate: number;
    totalJobs: number;
    jobsByStatus: {
      QUEUED: number;
      PROCESSING: number;
      COMPLETED: number;
      FAILED: number;
    };
    avgProcessingDurationSec: number | null;
    totalPagesExtracted: number;
    totalCharsExtracted: number;
    byMimeType: DocumentMimeStat[];
    recentTrend: RecentTrendPoint[];
  };
  storageStats: {
    totalBytes: number;
    avgSizeBytes: number;
    largestDocument: {
      id: string;
      filename: string;
      sizeBytes: number;
      mimeType: string;
    } | null;
    byCategory: StorageCategoryStat[];
    largestDocuments: LargestDocumentStat[];
  };
  aiStats: {
    totalChunks: number;
    totalEmbeddings: number;
    totalIndexedTokens: number;
    avgTokensPerChunk: number;
    avgChunksPerDocument: number;
    embeddingModel: string;
    chatModel: string;
  };
  queryStats: {
    totalAuditEvents: number;
    totalDownloads: number;
    totalUploadEvents: number;
    totalDeleteEvents: number;
    totalMemberEvents: number;
  };
}

