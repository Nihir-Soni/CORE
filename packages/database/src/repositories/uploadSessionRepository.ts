import { withWorkspaceContext } from "../client.ts";
import type { WorkspaceContext } from "../workspaceContext.ts";
import type { UploadSession, UploadSessionStatus, Prisma } from "../generated/prisma/client.ts";

export interface CreateUploadSessionInput {
  documentId: string;
  uploadId: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  partSizeBytes: number;
  totalParts: number;
}

export class UploadSessionRepository {
  private static async run<T>(
    ctx: WorkspaceContext,
    fn: (db: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    if (ctx.db) {
      return fn(ctx.db);
    }
    return withWorkspaceContext(ctx.workspaceId, (db) => fn(db));
  }

  /**
   * Creates an UploadSession, enforcing workspace ownership.
   */
  static async create(
    ctx: WorkspaceContext,
    data: CreateUploadSessionInput
  ): Promise<UploadSession> {
    return this.run(ctx, (db) =>
      db.uploadSession.create({
        data: {
          workspaceId: ctx.workspaceId,
          documentId: data.documentId,
          uploadId: data.uploadId,
          storageKey: data.storageKey,
          filename: data.filename,
          mimeType: data.mimeType,
          sizeBytes: data.sizeBytes,
          partSizeBytes: data.partSizeBytes,
          totalParts: data.totalParts,
          status: "INITIATED",
        },
      })
    );
  }

  /**
   * Finds an UploadSession by id within the workspace context.
   */
  static async findById(
    ctx: WorkspaceContext,
    id: string
  ): Promise<UploadSession | null> {
    return this.run(ctx, (db) =>
      db.uploadSession.findFirst({
        where: {
          id,
          workspaceId: ctx.workspaceId,
        },
      })
    );
  }

  /**
   * Finds an UploadSession by documentId within the workspace context.
   */
  static async findByDocumentId(
    ctx: WorkspaceContext,
    documentId: string
  ): Promise<UploadSession | null> {
    return this.run(ctx, (db) =>
      db.uploadSession.findFirst({
        where: {
          documentId,
          workspaceId: ctx.workspaceId,
        },
      })
    );
  }

  /**
   * Updates an UploadSession status within the workspace context.
   * Returns null if session does not exist or workspace mismatch.
   */
  static async updateStatus(
    ctx: WorkspaceContext,
    documentId: string,
    status: UploadSessionStatus,
    completedAt?: Date
  ): Promise<UploadSession | null> {
    return this.run(ctx, async (db) => {
      const existing = await db.uploadSession.findFirst({
        where: {
          documentId,
          workspaceId: ctx.workspaceId,
        },
      });
      if (!existing) return null;

      return db.uploadSession.update({
        where: { id: existing.id },
        data: {
          status,
          ...(completedAt ? { completedAt } : {}),
        },
      });
    });
  }

  /**
   * Updates an UploadSession by id within workspace context.
   */
  static async update(
    ctx: WorkspaceContext,
    id: string,
    data: { status?: UploadSessionStatus; completedAt?: Date | null; storageKey?: string }
  ): Promise<UploadSession | null> {
    return this.run(ctx, async (db) => {
      const existing = await db.uploadSession.findFirst({
        where: {
          id,
          workspaceId: ctx.workspaceId,
        },
      });
      if (!existing) return null;

      return db.uploadSession.update({
        where: { id: existing.id },
        data,
      });
    });
  }

  /**
   * Deletes an UploadSession by id within workspace context.
   */
  static async delete(
    ctx: WorkspaceContext,
    id: string
  ): Promise<boolean> {
    return this.run(ctx, async (db) => {
      const existing = await db.uploadSession.findFirst({
        where: {
          id,
          workspaceId: ctx.workspaceId,
        },
      });
      if (!existing) return false;

      await db.uploadSession.delete({
        where: { id: existing.id },
      });
      return true;
    });
  }
}
