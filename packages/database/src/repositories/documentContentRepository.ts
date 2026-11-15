import { withWorkspaceContext } from "../client.ts";
import type { WorkspaceContext } from "../workspaceContext.ts";
import type { DocumentContent, Prisma } from "../generated/prisma/client.ts";

export interface UpsertContentInput {
  text: string;
  pageCount?: number | null;
  charCount: number;
}

export class DocumentContentRepository {
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
   * Finds DocumentContent by documentId, joining against Document to verify workspace ownership in the query.
   */
  static async findByDocumentId(
    ctx: WorkspaceContext,
    documentId: string
  ): Promise<DocumentContent | null> {
    return this.run(ctx, (db) =>
      db.documentContent.findFirst({
        where: {
          documentId,
          document: {
            workspaceId: ctx.workspaceId,
            status: { not: "DELETING" },
          },
        },
      })
    );
  }

  /**
   * Upserts DocumentContent only if the document exists and belongs to the workspace context.
   * Returns null if document not found, belongs to another workspace, or is DELETING.
   */
  static async upsert(
    ctx: WorkspaceContext,
    documentId: string,
    data: UpsertContentInput
  ): Promise<DocumentContent | null> {
    return this.run(ctx, async (db) => {
      // Verify document workspace ownership first and confirm it's not being deleted
      const doc = await db.document.findFirst({
        where: {
          id: documentId,
          workspaceId: ctx.workspaceId,
          status: { not: "DELETING" },
        },
      });

      if (!doc) return null;

      return db.documentContent.upsert({
        where: { documentId },
        create: {
          documentId,
          text: data.text,
          pageCount: data.pageCount ?? null,
          charCount: data.charCount,
        },
        update: {
          text: data.text,
          pageCount: data.pageCount ?? null,
          charCount: data.charCount,
          extractedAt: new Date(),
        },
      });
    });
  }

  /**
   * Deletes DocumentContent if the document belongs to the workspace context.
   */
  static async deleteByDocumentId(
    ctx: WorkspaceContext,
    documentId: string
  ): Promise<boolean> {
    return this.run(ctx, async (db) => {
      const existing = await db.documentContent.findFirst({
        where: {
          documentId,
          document: { workspaceId: ctx.workspaceId },
        },
      });
      if (!existing) return false;

      await db.documentContent.delete({
        where: { documentId },
      });
      return true;
    });
  }
}
