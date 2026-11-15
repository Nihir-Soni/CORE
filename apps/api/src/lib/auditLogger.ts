import { prisma } from "@core/database";
import { Prisma } from "@core/database";

export type AuditActionType =
  | "DOCUMENT_UPLOADED"
  | "DOCUMENT_DOWNLOADED"
  | "DOCUMENT_DELETED"
  | "MEMBER_INVITED"
  | "ROLE_CHANGED";

export interface RecordAuditParams {
  workspaceId: string;
  userId: string;
  action: AuditActionType;
  resourceId?: string | null;
  resourceName?: string | null;
  details?: Record<string, any> | null;
}

export async function recordAuditLog(params: RecordAuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: params.workspaceId,
        userId: params.userId,
        action: params.action,
        resourceId: params.resourceId ?? null,
        resourceName: params.resourceName ?? null,
        details: params.details ? (params.details as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  } catch (err) {
    // Non-blocking log so primary operations proceed smoothly
    console.error("[AuditLogger] Failed to record audit log:", err);
  }
}
