import { withWorkspaceContext } from "../client.ts";
import type { WorkspaceContext } from "../workspaceContext.ts";
import type { Document, DocumentStatus, ProcessingJob, Prisma } from "../generated/prisma/client.ts";

export interface CreateDocumentInput {
  uploadedById: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  sha256?: string | null;
  status?: DocumentStatus;
}

export interface UpdateDocumentInput {
  sha256?: string | null;
  status?: DocumentStatus;
  storageKey?: string;
}

export class DocumentRepository {
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
   * Creates a document, enforcing that workspace ownership matches ctx.workspaceId.
   */
  static async create(ctx: WorkspaceContext, data: CreateDocumentInput): Promise<Document> {
    return this.run(ctx, (db) =>
      db.document.create({
        data: {
          workspaceId: ctx.workspaceId,
          uploadedById: data.uploadedById,
          filename: data.filename,
          mimeType: data.mimeType,
          sizeBytes: data.sizeBytes,
          storageKey: data.storageKey,
          sha256: data.sha256 ?? null,
          status: data.status ?? "UPLOADING",
        },
      })
    );
  }

  /**
   * Finds a document by ID within the workspace context.
   * Returns null if document does not exist, belongs to another workspace,
   * or has been marked as DELETING (unless includeDeleting is true).
   */
  static async findById(
    ctx: WorkspaceContext,
    documentId: string,
    includeDeleting = false
  ): Promise<Document | null> {
    return this.run(ctx, (db) =>
      db.document.findFirst({
        where: {
          id: documentId,
          workspaceId: ctx.workspaceId,
          ...(!includeDeleting ? { status: { not: "DELETING" } } : {}),
        },
      })
    );
  }

  /**
   * Finds a document by sha256 within the workspace context, excluding documents being deleted.
   */
  static async findBySha256(
    ctx: WorkspaceContext,
    sha256: string,
    excludeDocumentId?: string,
    validStatuses?: DocumentStatus[]
  ): Promise<Document | null> {
    return this.run(ctx, (db) =>
      db.document.findFirst({
        where: {
          workspaceId: ctx.workspaceId,
          sha256,
          status: { not: "DELETING" },
          ...(validStatuses ? { status: { in: validStatuses } } : {}),
          ...(excludeDocumentId ? { id: { not: excludeDocumentId } } : {}),
        },
        orderBy: { createdAt: "asc" },
      })
    );
  }

  /**
   * Lists all active documents belonging to the workspace context (excluding DELETING).
   */
  static async list(ctx: WorkspaceContext, includeDeleting = false): Promise<Document[]> {
    return this.run(ctx, (db) =>
      db.document.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          ...(!includeDeleting ? { status: { not: "DELETING" } } : {}),
        },
        orderBy: { createdAt: "desc" },
      })
    );
  }

  /**
   * Updates a document's fields. Returns null if document does not exist, workspace mismatch,
   * or if document is marked as DELETING (unless allowDeleting is true).
   */
  static async update(
    ctx: WorkspaceContext,
    documentId: string,
    data: UpdateDocumentInput,
    allowDeleting = false
  ): Promise<Document | null> {
    return this.run(ctx, async (db) => {
      const existing = await db.document.findFirst({
        where: {
          id: documentId,
          workspaceId: ctx.workspaceId,
          ...(!allowDeleting ? { status: { not: "DELETING" } } : {}),
        },
      });
      if (!existing) return null;

      return db.document.update({
        where: { id: documentId },
        data,
      });
    });
  }

  /**
   * Atomically transitions a document into the DELETING state.
   * Returns the updated document, or null if not found in this workspace.
   */
  static async markDeleting(
    ctx: WorkspaceContext,
    documentId: string
  ): Promise<Document | null> {
    return this.run(ctx, async (db) => {
      const existing = await db.document.findFirst({
        where: { id: documentId, workspaceId: ctx.workspaceId },
      });
      if (!existing) return null;
      if (existing.status === "DELETING") return existing;

      return db.document.update({
        where: { id: documentId },
        data: { status: "DELETING" },
      });
    });
  }

  /**
   * Deletes a document if it belongs to the workspace context.
   * Cleans up DocumentContent defense-in-depth and cascades remaining child records.
   * Returns true if deleted, false if not found / workspace mismatch.
   */
  static async delete(ctx: WorkspaceContext, documentId: string): Promise<boolean> {
    return this.run(ctx, async (db) => {
      const existing = await db.document.findFirst({
        where: { id: documentId, workspaceId: ctx.workspaceId },
      });
      if (!existing) return false;

      // Defense-in-depth: explicitly delete DocumentContent before deleting Document
      await db.documentContent.deleteMany({
        where: { documentId },
      });

      await db.document.delete({ where: { id: documentId } });
      return true;
    });
  }

  /**
   * Retrieves a document along with its latest processing job, scoped to workspace context.
   */
  static async getWithLatestJob(
    ctx: WorkspaceContext,
    documentId: string,
    includeDeleting = false
  ): Promise<(Document & { processingJobs: ProcessingJob[] }) | null> {
    return this.run(ctx, (db) =>
      db.document.findFirst({
        where: {
          id: documentId,
          workspaceId: ctx.workspaceId,
          ...(!includeDeleting ? { status: { not: "DELETING" } } : {}),
        },
        include: {
          processingJobs: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      })
    );
  }

  /**
   * Retrieves a document with its chunk count, scoped to workspace context.
   */
  static async getWithChunkCount(
    ctx: WorkspaceContext,
    documentId: string,
    includeDeleting = false
  ): Promise<(Document & { _count: { chunks: number } }) | null> {
    return this.run(ctx, (db) =>
      db.document.findFirst({
        where: {
          id: documentId,
          workspaceId: ctx.workspaceId,
          ...(!includeDeleting ? { status: { not: "DELETING" } } : {}),
        },
        include: {
          _count: {
            select: { chunks: true },
          },
        },
      })
    );
  }
}
