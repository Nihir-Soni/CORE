import type { PrismaClient } from "@core/database";
import type { AIProvider } from "@core/ai";
import { downloadObjectBuffer } from "@core/storage";
import { extractText } from "@core/extraction";
export declare function processDocument(documentId: string, workspaceId: string, processingJobId: string, attemptsMade: number, maxAttempts: number, provider: AIProvider, prisma: PrismaClient, overrides?: {
    download?: typeof downloadObjectBuffer;
    extract?: typeof extractText;
}): Promise<{
    documentId: string;
    workspaceId: string;
    status: "READY";
    chunkCount: number;
    embeddingCount: number;
}>;
