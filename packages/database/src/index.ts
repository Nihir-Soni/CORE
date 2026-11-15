export { prisma, withWorkspaceContext, disconnectDatabase, pool } from "./client.ts";
export type { DatabaseClient } from "./client.ts";
export { PrismaClient, Prisma } from "./generated/prisma/client.ts";
export * from "./generated/prisma/enums.ts";
export type * from "./generated/prisma/models.js";

export type { WorkspaceContext } from "./workspaceContext.ts";
export { DocumentRepository } from "./repositories/documentRepository.ts";
export { DocumentContentRepository } from "./repositories/documentContentRepository.ts";
export { ChunkRepository } from "./repositories/chunkRepository.ts";
export { ChunkEmbeddingRepository } from "./repositories/chunkEmbeddingRepository.ts";
export { ProcessingJobRepository } from "./repositories/processingJobRepository.ts";
export { UploadSessionRepository } from "./repositories/uploadSessionRepository.ts";