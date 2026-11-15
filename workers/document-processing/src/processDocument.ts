import { type PrismaClient, DocumentRepository, DocumentContentRepository, ProcessingJobRepository } from "@core/database";
import type { AIProvider } from "@core/ai";
import { downloadObjectBuffer } from "@core/storage";
import { extractText } from "@core/extraction";
import { indexDocument } from "@core/indexing";

export async function processDocument(
  documentId: string,
  workspaceId: string,
  processingJobId: string,
  attemptsMade: number,
  maxAttempts: number,
  provider: AIProvider,
  prisma: PrismaClient,
  overrides?: {
    download?: typeof downloadObjectBuffer;
    extract?: typeof extractText;
  }
): Promise<{
  documentId: string;
  workspaceId: string;
  status: "READY";
  chunkCount: number;
  embeddingCount: number;
}> {
  const ctx = { workspaceId };
  try {
    // 1. Verify Document
    const document = await DocumentRepository.findById(ctx, documentId);

    if (!document) {
      // Don't update status for missing documents
      const err = new Error(`Document not found: ${documentId}`);
      (err as any).skipStatusUpdate = true;
      (err as any).isNonRetryable = true;
      throw err;
    }

    // 2. Verify workspaceId
    if (document.workspaceId !== workspaceId) {
      const err = new Error(`Workspace mismatch for document ${documentId}. Expected ${workspaceId}, got ${document.workspaceId}`);
      (err as any).skipStatusUpdate = true;
      (err as any).isNonRetryable = true;
      throw err;
    }

    // 2b. Verify sha256 content hash is present (persisted during upload completion)
    if (!document.sha256) {
      const err = new Error(`Document ${documentId} is missing required sha256 content hash.`);
      (err as any).skipStatusUpdate = true;
      (err as any).isNonRetryable = true;
      throw err;
    }

    // 3. Verify eligible for processing
    if (document.status === "FAILED") {
       throw new Error(`Document ${documentId} is in FAILED state. Cannot process.`);
    }

    // 4. Update ProcessingJob to PROCESSING and increment attempts
    await ProcessingJobRepository.update(ctx, processingJobId, {
      status: "PROCESSING",
      progress: 10,
      progressMessage: "Processing document",
      startedAt: new Date(),
    }).catch(e => console.error(`Failed to update ProcessingJob ${processingJobId} to PROCESSING`, e));

    // 4b. Set document status to PROCESSING
    const processingDoc = await DocumentRepository.update(ctx, documentId, { status: "PROCESSING" });
    if (!processingDoc) {
      const err = new Error(`Document ${documentId} is being deleted or missing. Aborting processing.`);
      (err as any).skipStatusUpdate = true;
      (err as any).isNonRetryable = true;
      throw err;
    }

    // 5. Download object from MinIO
    const download = overrides?.download ?? downloadObjectBuffer;
    const buffer = await download(document.storageKey);

    // 6. Update progress to EXTRACTING (30%) & extract text
    await ProcessingJobRepository.update(ctx, processingJobId, {
      progress: 30,
      progressMessage: "Extracting document",
    }).catch(e => console.error(`Failed to update ProcessingJob ${processingJobId} progress to 30%`, e));

    const extract = overrides?.extract ?? extractText;
    const extractionResult = await extract(buffer, document.mimeType);

    // 7. Upsert DocumentContent
    const contentUpserted = await DocumentContentRepository.upsert(ctx, documentId, {
      text: extractionResult.text,
      pageCount: extractionResult.pageCount,
      charCount: extractionResult.text.length,
    });

    if (!contentUpserted) {
      const err = new Error(`Document ${documentId} was deleted during extraction. Aborting.`);
      (err as any).skipStatusUpdate = true;
      (err as any).isNonRetryable = true;
      throw err;
    }

    // 8. Update progress to INDEXING (70%) & run indexing orchestration
    await ProcessingJobRepository.update(ctx, processingJobId, {
      progress: 70,
      progressMessage: "Indexing document",
    }).catch(e => console.error(`Failed to update ProcessingJob ${processingJobId} progress to 70%`, e));

    const indexingResult = await indexDocument(
      documentId,
      workspaceId,
      provider,
      prisma
    );

    if (!indexingResult.ok) {
        throw new Error(`Indexing failed: ${indexingResult.error}`);
    }

    // 9. Document reaches READY inside indexDocument orchestration
    
    // 9b. Update ProcessingJob to COMPLETED (100%)
    await ProcessingJobRepository.update(ctx, processingJobId, {
      status: "COMPLETED",
      progress: 100,
      progressMessage: "Document ready",
      completedAt: new Date(),
    }).catch(e => console.error(`Failed to update ProcessingJob ${processingJobId} to COMPLETED`, e));

    // 10. Return processing statistics
    return {
      documentId,
      workspaceId,
      status: "READY",
      chunkCount: indexingResult.chunksProcessed,
      embeddingCount: indexingResult.embeddingsGenerated,
    };
  } catch (error) {
    console.error(`Processing failed for document ${documentId}:`, error);

    const isNonRetryable = (error as any).isNonRetryable;
    const isFinalAttempt = attemptsMade + 1 >= maxAttempts || isNonRetryable;
    
    // Always update ProcessingJob error. If final attempt, mark FAILED.
    if (!(error as any).skipStatusUpdate) {
        const errMsg = (error as Error).message.slice(0, 500);
        await ProcessingJobRepository.update(ctx, processingJobId, {
            lastError: errMsg,
            progressMessage: errMsg,
            ...(isFinalAttempt ? { status: "FAILED" } : {})
        }).catch(e => console.error(`Failed to update ProcessingJob ${processingJobId} on error`, e));
    }

    // Transition document to FAILED only if it's the final attempt
    if (!(error as any).skipStatusUpdate && isFinalAttempt) {
      await DocumentRepository.update(ctx, documentId, { status: "FAILED" }).catch(e => {
          console.error(`Failed to update status to FAILED for document ${documentId}`, e);
      });
    }

    // Unrecoverable errors for BullMQ
    if (isNonRetryable) {
       const bullmqError = new Error((error as Error).message);
       bullmqError.name = "UnrecoverableError"; 
       (bullmqError as any).isNonRetryable = true;
       (bullmqError as any).skipStatusUpdate = (error as any).skipStatusUpdate;
       throw bullmqError;
    }

    throw error;
  }
}
