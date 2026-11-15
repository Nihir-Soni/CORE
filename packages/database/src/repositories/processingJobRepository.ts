import { withWorkspaceContext } from "../client.ts";
import type { WorkspaceContext } from "../workspaceContext.ts";
import type { ProcessingJob, ProcessingJobStatus, Prisma } from "../generated/prisma/client.ts";

export interface CreateProcessingJobInput {
  documentId: string;
  status?: ProcessingJobStatus;
  progress?: number;
  progressMessage?: string;
}

export interface UpdateProcessingJobInput {
  status?: ProcessingJobStatus;
  attempts?: number;
  progress?: number;
  progressMessage?: string | null;
  lastError?: string | null;
  startedAt?: Date;
  completedAt?: Date;
}

export class ProcessingJobRepository {
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
   * Creates a processing job, enforcing workspace ownership.
   */
  static async create(
    ctx: WorkspaceContext,
    data: CreateProcessingJobInput
  ): Promise<ProcessingJob> {
    return this.run(ctx, (db) =>
      db.processingJob.create({
        data: {
          workspaceId: ctx.workspaceId,
          documentId: data.documentId,
          status: data.status ?? "QUEUED",
          progress: data.progress ?? 0,
          progressMessage: data.progressMessage ?? "Job queued",
        },
      })
    );
  }

  /**
   * Finds a processing job by ID within the workspace context.
   */
  static async findById(
    ctx: WorkspaceContext,
    jobId: string
  ): Promise<ProcessingJob | null> {
    return this.run(ctx, (db) =>
      db.processingJob.findFirst({
        where: {
          id: jobId,
          workspaceId: ctx.workspaceId,
        },
      })
    );
  }

  /**
   * Finds the latest processing job for a document within the workspace context.
   */
  static async findLatestByDocumentId(
    ctx: WorkspaceContext,
    documentId: string
  ): Promise<ProcessingJob | null> {
    return this.run(ctx, (db) =>
      db.processingJob.findFirst({
        where: {
          documentId,
          workspaceId: ctx.workspaceId,
        },
        orderBy: { createdAt: "desc" },
      })
    );
  }

  /**
   * Updates a processing job within the workspace context.
   * Returns null if job does not exist or workspace mismatch.
   */
  static async update(
    ctx: WorkspaceContext,
    jobId: string,
    data: UpdateProcessingJobInput
  ): Promise<ProcessingJob | null> {
    return this.run(ctx, async (db) => {
      const existing = await db.processingJob.findFirst({
        where: { id: jobId, workspaceId: ctx.workspaceId },
      });
      if (!existing) return null;

      return db.processingJob.update({
        where: { id: jobId },
        data,
      });
    });
  }

  /**
   * Counts processing jobs within the workspace context.
   */
  static async count(
    ctx: WorkspaceContext,
    documentId?: string
  ): Promise<number> {
    return this.run(ctx, (db) =>
      db.processingJob.count({
        where: {
          workspaceId: ctx.workspaceId,
          ...(documentId ? { documentId } : {}),
        },
      })
    );
  }
}
