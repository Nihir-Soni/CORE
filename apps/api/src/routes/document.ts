import { Router } from "express";

import {
    prisma,
    DocumentRepository,
    DocumentContentRepository,
    ChunkEmbeddingRepository,
    ProcessingJobRepository,
} from "@core/database";
import {
    buildStorageKey,
    presignUpload,
    presignDownload,
    getObjectStream,
    deleteObject,
} from "@core/storage";

import {
    requireAuth,
    type AuthedRequest,
} from "../middleware/requireAuth.ts";

import { requireWorkspaceRole } from "../middleware/requireWorkspaceRole.ts";
import { recordAuditLog } from "../lib/auditLogger.ts";
import { hashStoredObject } from "../lib/hashObject.ts";
import { extractText } from "@core/extraction";
import { downloadObjectBuffer } from "../lib/downloadObject.js";
import { indexDocument } from "@core/indexing";
import { GeminiProvider, createDefaultAIProvider, type AIProvider, searchHybridChunks, searchSimilarChunks, rerankSearchResults, buildRagContext, createRagSystemPrompt, mapCitations } from "@core/ai";
import { retrievalSchema, chatSchema, env, ALLOWED_MIME_SET, resolveMimeType } from "@core/shared";
import { documentProcessingQueue } from "@core/jobs";
import { SSESession } from "../lib/sse.ts";

let aiProvider: AIProvider | undefined;
export function setAIProvider(provider: AIProvider | undefined) {
    aiProvider = provider;
}

export const documentsRouter: Router = Router();
import { multipartRouter } from "./multipart.ts";

documentsRouter.use("/:workspaceId/multipart", multipartRouter);

const MAX_SIZE_BYTES = 100 * 1024 * 1024;

const ALLOWED_MIME = ALLOWED_MIME_SET;

documentsRouter.post(
    "/:workspaceId/upload-url",
    requireAuth,
    requireWorkspaceRole("MEMBER"),
    async (req: AuthedRequest, res, next) => {
        try {
            let { filename, mimeType, sizeBytes } = req.body;

            const resolvedMime = resolveMimeType(filename, mimeType);
            if (!resolvedMime) {
                return res.status(400).json({
                    error: "unsupported_file_type",
                });
            }
            mimeType = resolvedMime;

            if (
                typeof sizeBytes !== "number" ||
                sizeBytes <= 0
            ) {
                return res.status(400).json({
                    error: "invalid_file_size",
                });
            }

            if (sizeBytes > MAX_SIZE_BYTES) {
                return res.status(400).json({
                    error: "file_too_large",
                });
            }

            if (
                typeof filename !== "string" ||
                filename.trim().length === 0
            ) {
                return res.status(400).json({
                    error: "invalid_filename",
                });
            }

            const rawWorkspaceId = req.params.workspaceId;
            const workspaceId = Array.isArray(rawWorkspaceId)
                ? rawWorkspaceId[0]
                : rawWorkspaceId;

            const storageKey = buildStorageKey(
                workspaceId,
                filename,
            );

            const document = await DocumentRepository.create(
                { workspaceId },
                {
                    uploadedById: req.user!.userId,
                    filename,
                    mimeType,
                    sizeBytes,
                    storageKey,
                    status: "UPLOADING",
                }
            );

            const uploadUrl = await presignUpload(
                storageKey,
                mimeType,
            );

            return res.status(201).json({
                documentId: document.id,
                uploadUrl,
            });
        } catch (err) {
            next(err);
        }
    },
);

documentsRouter.post(
    "/:workspaceId/:documentId/complete",
    requireAuth,
    requireWorkspaceRole("MEMBER"),
    async (
        req: AuthedRequest,
        res,
        next,
    ) => {
        try {
            const workspaceId = req.params.workspaceId as string;
            const documentId = req.params.documentId as string;
            const ctx = { workspaceId };

            const document = await DocumentRepository.findById(ctx, documentId);

            if (!document) {
                return res.status(404).json({
                    error: "not_found",
                });
            }

            let sha256: string;
            try {
                sha256 = await hashStoredObject(document.storageKey);
            } catch (hashErr) {
                console.error(`Hashing failed for document ${document.id}:`, hashErr);
                await DocumentRepository.update(ctx, document.id, { status: "FAILED" }).catch(e => console.error(e));

                return res.status(500).json({ error: "hashing_failed" });
            }

            const existingDoc = await DocumentRepository.findBySha256(ctx, sha256, document.id);

            if (existingDoc) {
                await deleteObject(document.storageKey).catch(e => console.error("Failed to delete duplicate S3 object:", e));
                await DocumentRepository.delete(ctx, document.id).catch(e => console.error(e));

                return res.json({
                    duplicate: true,
                    documentId: existingDoc.id,
                    canonicalDocumentId: existingDoc.id,
                    status: existingDoc.status,
                    sha256: existingDoc.sha256,
                });
            }

            let updated: any;
            try {
                updated = await DocumentRepository.update(ctx, document.id, {
                    sha256,
                    status: "UPLOADED",
                });
            } catch (dbErr: any) {
                if (dbErr?.code === "P2002") {
                    const canonical = await DocumentRepository.findBySha256(ctx, sha256, document.id);

                    if (canonical) {
                        await deleteObject(document.storageKey).catch(e => console.error(e));
                        await DocumentRepository.delete(ctx, document.id).catch(e => console.error(e));

                        return res.json({
                            duplicate: true,
                            documentId: canonical.id,
                            canonicalDocumentId: canonical.id,
                            status: canonical.status,
                            sha256: canonical.sha256,
                        });
                    }
                }
                throw dbErr;
            }

            let processingJob;
            try {
                processingJob = await ProcessingJobRepository.create(ctx, {
                    documentId: updated.id,
                    status: "QUEUED",
                    progress: 0,
                    progressMessage: "Job queued",
                });
            } catch (err) {
                console.error(`Failed to create ProcessingJob for document ${updated.id}:`, err);
                return res.status(500).json({
                    error: "internal_error",
                });
            }

            try {
                await documentProcessingQueue.add("process-document", {
                    documentId: updated.id,
                    workspaceId: updated.workspaceId,
                    processingJobId: processingJob.id,
                }, {
                    jobId: processingJob.id,
                });
            } catch (err) {
                console.error(`Failed to enqueue job for document ${updated.id}:`, err);
                // Clean up the processing job if enqueue failed
                await ProcessingJobRepository.update(ctx, processingJob.id, {
                    status: "FAILED",
                    lastError: "Enqueue failed",
                }).catch(e => console.error(e));
                
                return res.status(500).json({
                    error: "queue_error",
                });
            }

            await recordAuditLog({
                workspaceId,
                userId: req.user!.userId,
                action: "DOCUMENT_UPLOADED",
                resourceId: updated.id,
                resourceName: updated.filename,
                details: {
                    sizeBytes: updated.sizeBytes,
                    mimeType: updated.mimeType,
                },
            });

            return res.json({
                documentId: updated.id,
                status: "PROCESSING",
                sha256: updated.sha256,
            });
        } catch (err) {
            next(err);
        }
    },
);


documentsRouter.get(
    "/:workspaceId",
    requireAuth,
    requireWorkspaceRole("MEMBER"),
    async (req: AuthedRequest, res, next) => {
        try {
            const workspaceId = req.params.workspaceId as string;

            const documents = await DocumentRepository.list({ workspaceId });

            return res.json(documents);
        } catch (err) {
            next(err);
        }
    },
);




documentsRouter.post(
  "/:workspaceId/:documentId/extract",
  requireAuth,
  requireWorkspaceRole("MEMBER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const workspaceId = typeof req.params.workspaceId === "string"
        ? req.params.workspaceId
        : req.params.workspaceId[0];
      const documentId = typeof req.params.documentId === "string"
        ? req.params.documentId
        : req.params.documentId[0];
      const ctx = { workspaceId };

      const doc = await DocumentRepository.findById(ctx, documentId);

      if (!doc) {
        return res.status(404).json({
          error: "not_found",
        });
      }

      if (doc.status !== "UPLOADED") {
        return res.status(400).json({
          error: "document_not_uploaded",
        });
      }

      await DocumentRepository.update(ctx, doc.id, {
        status: "PROCESSING",
      });

      try {
        const buffer = await downloadObjectBuffer(doc.storageKey);

        const { text, pageCount } = await extractText(
          buffer,
          doc.mimeType
        );

        await DocumentContentRepository.upsert(ctx, doc.id, {
          text,
          pageCount,
          charCount: text.length,
        });

        res.json({
          status: "PROCESSING",
          charCount: text.length,
          pageCount,
        });
      } catch (extractError) {
        await DocumentRepository.update(ctx, doc.id, {
          status: "FAILED",
        });

        if (
          extractError instanceof Error &&
          extractError.message.startsWith("unsupported_mime_type:")
        ) {
          return res.status(400).json({
            error: "extraction_not_supported",
          });
        }

        throw extractError;
      }
    } catch (err) {
      next(err);
    }
  }
);



documentsRouter.get(
  "/:workspaceId/:documentId/content",
  requireAuth,
  requireWorkspaceRole("MEMBER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const workspaceId = typeof req.params.workspaceId === "string"
        ? req.params.workspaceId
        : req.params.workspaceId[0];
      const documentId = typeof req.params.documentId === "string"
        ? req.params.documentId
        : req.params.documentId[0];
      const ctx = { workspaceId };

      const content = await DocumentContentRepository.findByDocumentId(ctx, documentId);

      if (!content) {
        return res.status(404).json({
          error: "not_extracted",
        });
      }

      res.json(content);
    } catch (err) {
      next(err);
    }
  }
);

documentsRouter.get(
  "/:workspaceId/:documentId/file",
  requireAuth,
  requireWorkspaceRole("MEMBER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const workspaceId = typeof req.params.workspaceId === "string"
        ? req.params.workspaceId
        : req.params.workspaceId[0];
      const documentId = typeof req.params.documentId === "string"
        ? req.params.documentId
        : req.params.documentId[0];
      const ctx = { workspaceId };

      const doc = await DocumentRepository.findById(ctx, documentId);
      if (!doc) {
        return res.status(404).json({ error: "not_found" });
      }

      if (doc.status === "UPLOADING") {
        return res.status(400).json({ error: "document_not_uploaded" });
      }

      const dispositionType = req.query.disposition === "attachment" ? "attachment" : "inline";
      const filename = doc.filename || "document";
      const encodedFilename = encodeURIComponent(filename);

      res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `${dispositionType}; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
      );
      if (doc.sizeBytes) {
        res.setHeader("Content-Length", String(doc.sizeBytes));
      }
      res.setHeader("Cache-Control", "private, max-age=3600");

      await recordAuditLog({
        workspaceId,
        userId: req.user!.userId,
        action: "DOCUMENT_DOWNLOADED",
        resourceId: doc.id,
        resourceName: doc.filename,
        details: {
          downloadType: dispositionType,
          sizeBytes: doc.sizeBytes,
          mimeType: doc.mimeType,
        },
      });

      const stream = await getObjectStream(doc.storageKey);
      for await (const chunk of stream) {
        res.write(chunk);
      }
      res.end();
    } catch (err) {
      next(err);
    }
  }
);

documentsRouter.get(
  "/:workspaceId/:documentId/download-url",
  requireAuth,
  requireWorkspaceRole("MEMBER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const workspaceId = typeof req.params.workspaceId === "string"
        ? req.params.workspaceId
        : req.params.workspaceId[0];
      const documentId = typeof req.params.documentId === "string"
        ? req.params.documentId
        : req.params.documentId[0];
      const ctx = { workspaceId };

      const doc = await DocumentRepository.findById(ctx, documentId);
      if (!doc) {
        return res.status(404).json({ error: "not_found" });
      }

      const downloadUrl = await presignDownload(doc.storageKey, 3600);

      await recordAuditLog({
        workspaceId,
        userId: req.user!.userId,
        action: "DOCUMENT_DOWNLOADED",
        resourceId: doc.id,
        resourceName: doc.filename,
        details: {
          downloadType: "presigned_url",
          sizeBytes: doc.sizeBytes,
          mimeType: doc.mimeType,
        },
      });

      return res.json({
        documentId: doc.id,
        filename: doc.filename,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        downloadUrl,
      });
    } catch (err) {
      next(err);
    }
  }
);


documentsRouter.post(
  "/:workspaceId/:documentId/index",
  requireAuth,
  requireWorkspaceRole("MEMBER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const workspaceId = typeof req.params.workspaceId === "string"
        ? req.params.workspaceId
        : req.params.workspaceId[0];
      const documentId = typeof req.params.documentId === "string"
        ? req.params.documentId
        : req.params.documentId[0];
      const ctx = { workspaceId };

      // 1. Resolve Provider
      let provider = aiProvider;
      if (!provider) {
        try {
          provider = createDefaultAIProvider();
        } catch (e) {
          // E.g. GEMINI_API_KEY missing
          return res.status(500).json({ error: "ai_provider_unconfigured" });
        }
      }

      // 2. Call indexDocument orchestration
      const result = await indexDocument(documentId, workspaceId, provider, prisma);
      
      if (!result.ok) {
        if (result.error === "document_not_found" || result.error === "wrong_workspace") {
          // Do not leak cross-workspace document existence
          return res.status(404).json({ error: "not_found" });
        }
        if (result.error === "content_missing") {
          return res.status(400).json({ error: "content_missing" });
        }
        return res.status(500).json({ error: "unknown_indexing_error" });
      }

      // 3. Collect Response Info
      const docInfo = await DocumentRepository.getWithChunkCount(ctx, documentId);
      const embeddingCount = await ChunkEmbeddingRepository.countByDocumentId(ctx, documentId);

      res.json({
        documentId,
        workspaceId,
        status: docInfo?.status,
        chunkCount: docInfo?._count.chunks ?? 0,
        embeddingCount
      });
    } catch (err) {
      next(err);
    }
  }
);

documentsRouter.post(
  "/:workspaceId/retrieve",
  requireAuth,
  requireWorkspaceRole("MEMBER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const workspaceId = typeof req.params.workspaceId === "string"
        ? req.params.workspaceId
        : req.params.workspaceId[0];

      // 1. Validate Input
      const parseResult = retrievalSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "invalid_request", details: parseResult.error.format() });
      }

      const { query, topK, mode, maxTokens, rerank } = parseResult.data;

      // 2. Resolve Provider
      let provider = aiProvider;
      if (!provider) {
        try {
          provider = createDefaultAIProvider();
        } catch (e) {
          return res.status(500).json({ error: "ai_provider_unconfigured" });
        }
      }

      // 3. Search Chunks (supports hybrid, vector, text modes)
      let results = await searchHybridChunks({
        query,
        workspaceId,
        provider,
        prisma,
        topK,
        mode: mode ?? "hybrid",
      });

      // 4. Optional Reranking Stage
      if (rerank) {
        results = await rerankSearchResults(query, results);
      }

      // 5. Return Results
      return res.json({
        workspaceId,
        query,
        mode: mode ?? "hybrid",
        results,
      });
    } catch (err) {
      next(err);
    }
  }
);

documentsRouter.post(
  "/:workspaceId/chat",
  requireAuth,
  requireWorkspaceRole("MEMBER"),
  async (req: AuthedRequest, res, next) => {
    let isStreaming = false;
    let sse: SSESession | null = null;
    try {
      const workspaceId = typeof req.params.workspaceId === "string"
        ? req.params.workspaceId
        : req.params.workspaceId[0];

      // 1. Validate Input
      const parseResult = chatSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "invalid_request", details: parseResult.error.format() });
      }

      const { query, topK, stream, mode, maxTokens, rerank, documentIds } = parseResult.data;
      isStreaming = stream === true;
      sse = isStreaming ? new SSESession(req, res) : null;

      console.log(`[DIAGNOSTIC] === CHAT START === Query: "${query}" (streaming: ${isStreaming})`);

      // 2. Resolve Provider
      let provider = aiProvider;
      if (!provider) {
        try {
          provider = createDefaultAIProvider();
        } catch (e) {
          console.error("[DIAGNOSTIC] Provider resolution failed:", e);
          if (isStreaming && sse) {
            sse.send({ event: "error", data: { message: "AI provider unconfigured" } });
            sse.close();
            return;
          }
          return res.status(500).json({ error: "ai_provider_unconfigured" });
        }
      }

      const retrievalMode = mode ?? "hybrid";
      // 3. Search Chunks (hybrid by default)
      let results = await searchHybridChunks({
        query,
        workspaceId,
        provider,
        prisma,
        topK,
        mode: retrievalMode,
        documentIds,
      });

      console.log(`[DIAGNOSTIC] Item 1 - Retrieval results returned: ${results.length}`);
      console.log(`[DIAGNOSTIC] Item 2 - Retrieval mode actually used: ${retrievalMode}`);

      const rerankRan = rerank !== false && results.length > 0;
      console.log(`[DIAGNOSTIC] Item 3 - Whether reranking ran: ${rerankRan}`);

      // 4. Optional Reranking Stage
      if (rerankRan) {
        results = await rerankSearchResults(query, results);
      }

      console.log(`[DIAGNOSTIC] Item 4 - Number of results passed to context builder: ${results.length}`);

      // 5. Handle Empty Retrieval
      if (results.length === 0) {
        console.log(`[DIAGNOSTIC] Retrieval results empty, returning fallback text.`);
        const fallbackText = "I couldn't find enough information in the available documents to answer that question.";
        if (isStreaming && sse) {
          sse.send({ event: "token", data: { text: fallbackText } });
          sse.send({ event: "citations", data: { citations: [] } });
          sse.send({ event: "complete", data: {} });
          sse.close();
          return;
        }

        return res.json({
          workspaceId,
          query,
          answer: fallbackText,
          citations: [],
          sources: [],
        });
      }

      // 6. Build Context and System Prompt with Token Budgeting
      const ragCtx = buildRagContext(results, { maxTokens });
      const context = ragCtx.text;
      const availableSources = ragCtx.sources;
      console.log(`[DIAGNOSTIC] Item 5 - Token budget: ${ragCtx.maxTokens}, Actual context token count: ${ragCtx.totalTokens}`);
      console.log(`[DIAGNOSTIC] Item 6 - buildRagContext truncated: ${ragCtx.isTruncated}`);

      const systemPrompt = createRagSystemPrompt();
      const userPrompt = `User question:\n${query}\n\nRetrieved context:\n${context}`;

      // 6. Handle SSE Streaming Chat
      if (isStreaming && sse) {
        let fullAnswer = "";
        let streamStage = "provider_stream";

        try {
          const hasChatStream = !!provider.chatStream;
          console.log(`[AI] Active chat provider: ${provider.constructor.name}`);
          console.log(`[DIAGNOSTIC] Item 7 - GeminiProvider.chatStream reached: true (hasChatStream: ${hasChatStream})`);
          console.log(`[DIAGNOSTIC] Item 8 - Resolved Gemini model: ${env.GEMINI_CHAT_MODEL}`);

          const streamIterable = provider.chatStream
            ? provider.chatStream({ systemPrompt, userPrompt })
            : (async function* () {
                const fullText = await provider!.chat({ systemPrompt, userPrompt });
                yield fullText;
              })();

          let firstTokenProduced = false;
          for await (const chunk of streamIterable) {
            if (!firstTokenProduced) {
              firstTokenProduced = true;
              console.log(`[DIAGNOSTIC] Item 9 - Provider stream produced first token: true`);
            }
            if (sse.isClosed()) {
              break;
            }
            fullAnswer += chunk;
            sse.send({
              event: "token",
              data: { text: chunk },
            });
          }

          console.log(`[AI] Chat streaming completed. Total characters: ${fullAnswer.length}`);

          if (!firstTokenProduced) {
            console.log(`[DIAGNOSTIC] Item 9 - Provider stream produced first token: false`);
          }

          if (!sse.isClosed()) {
            streamStage = "citation_mapping";
            const citations = mapCitations(fullAnswer, availableSources).map(r => ({
              chunkId: r.chunkId,
              documentId: r.documentId,
              filename: r.filename,
              pageNumber: r.pageNumber,
              chunkIndex: r.chunkIndex,
              similarity: r.similarity,
              content: r.content,
            }));

            streamStage = "sse_completion";
            sse.send({
              event: "citations",
              data: { citations },
            });
            sse.send({
              event: "complete",
              data: {},
            });
            sse.close();
          }
        } catch (streamErr) {
          const error = streamErr instanceof Error
            ? streamErr
            : new Error(String(streamErr));
          console.error("[DIAGNOSTIC] Item 10 - Exception occurred:", {
            stage: streamStage,
            name: error.name,
            message: error.message,
            stack: error.stack,
          });
          console.error("Chat streaming failed", {
            stage: streamStage,
            name: error.name,
            message: error.message,
            stack: error.stack,
          });
          if (!sse.isClosed()) {
            sse.send({
              event: "error",
              data: { message: "Unable to generate a response" },
            });
            sse.close();
          }
        }
        return;
      }

      // 7. Non-streaming Answer (Phase 5 backward compatibility)
      const answer = await provider.chat({
        systemPrompt,
        userPrompt,
      });

      // 8. Parse and Format Citations
      const citations = mapCitations(answer, availableSources).map(r => ({
        chunkId: r.chunkId,
        documentId: r.documentId,
        filename: r.filename,
        pageNumber: r.pageNumber,
        chunkIndex: r.chunkIndex,
        similarity: r.similarity,
        content: r.content,
      }));

      // 9. Format Sources (All retrieved chunks)
      const sources = results.map(r => ({
        chunkId: r.chunkId,
        documentId: r.documentId,
        filename: r.filename,
        pageNumber: r.pageNumber,
        chunkIndex: r.chunkIndex,
        similarity: r.similarity,
        content: r.content,
      }));

      // 10. Return Response
      return res.json({
        workspaceId,
        query,
        answer,
        citations,
        sources,
      });
    } catch (err) {
      if (isStreaming && sse && !sse.isClosed()) {
        sse.send({
          event: "error",
          data: { message: "Unable to generate a response" },
        });
        sse.close();
        return;
      }
      next(err);
    }
  }
);

documentsRouter.get(
  "/:workspaceId/:documentId/progress",
  requireAuth,
  requireWorkspaceRole("MEMBER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const workspaceId = typeof req.params.workspaceId === "string"
        ? req.params.workspaceId
        : req.params.workspaceId[0];
      const documentId = typeof req.params.documentId === "string"
        ? req.params.documentId
        : req.params.documentId[0];

      // 1. Check workspace existence
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
      });
      if (!workspace) {
        return res.status(404).json({ error: "not_found" });
      }

      const ctx = { workspaceId };

      // 2. Fetch document & latest processing job scoped to workspace
      const doc = await DocumentRepository.getWithLatestJob(ctx, documentId);

      if (!doc) {
        return res.status(404).json({ error: "not_found" });
      }

      // Helper to compute progress payload
      const getProgressPayload = (d: typeof doc) => {
        const job = d.processingJobs?.[0];

        if (d.status === "READY") {
          return {
            documentId: d.id,
            workspaceId: d.workspaceId,
            status: "READY" as const,
            progress: 100,
            message: job?.progressMessage ?? "Document ready",
          };
        }

        if (d.status === "FAILED") {
          return {
            documentId: d.id,
            workspaceId: d.workspaceId,
            status: "FAILED" as const,
            progress: job?.progress ?? 0,
            message: job?.progressMessage ?? job?.lastError ?? "Processing failed",
          };
        }

        if (job) {
          let status: "QUEUED" | "PROCESSING" | "READY" | "FAILED" = "PROCESSING";
          if (job.status === "QUEUED") status = "QUEUED";
          if (job.status === "FAILED") status = "FAILED";
          if (job.status === "COMPLETED") status = "READY";

          return {
            documentId: d.id,
            workspaceId: d.workspaceId,
            status,
            progress: job.progress ?? (job.status === "QUEUED" ? 0 : 10),
            message: job.progressMessage ?? (job.status === "QUEUED" ? "Job queued" : "Processing document"),
          };
        }

        return {
          documentId: d.id,
          workspaceId: d.workspaceId,
          status: (d.status === "UPLOADED" || d.status === "UPLOADING") ? ("QUEUED" as const) : ("PROCESSING" as const),
          progress: 0,
          message: "Job queued",
        };
      };

      let observerTimer: NodeJS.Timeout | null = null;
      const sse = new SSESession(req, res, {
        onClose: () => {
          if (observerTimer) {
            clearInterval(observerTimer);
            observerTimer = null;
          }
        },
      });

      const currentPayload = getProgressPayload(doc);
      sse.send({
        event: "progress",
        data: currentPayload,
      });

      if (doc.status === "READY") {
        sse.send({
          event: "complete",
          data: { documentId: doc.id, workspaceId: doc.workspaceId, status: "READY" },
        });
        sse.close();
        return;
      }

      if (doc.status === "FAILED") {
        sse.send({
          event: "error",
          data: { documentId: doc.id, workspaceId: doc.workspaceId, status: "FAILED", message: currentPayload.message },
        });
        sse.close();
        return;
      }

      // Live observation loop for in-progress job
      let lastProgress = currentPayload.progress;
      let lastStatus = currentPayload.status;
      let lastMessage = currentPayload.message;

      observerTimer = setInterval(async () => {
        if (sse.isClosed()) {
          if (observerTimer) {
            clearInterval(observerTimer);
            observerTimer = null;
          }
          return;
        }

        try {
          const updatedDoc = await DocumentRepository.getWithLatestJob(ctx, documentId);

          if (!updatedDoc) {
            sse.close();
            return;
          }

          const newPayload = getProgressPayload(updatedDoc);

          if (
            newPayload.progress !== lastProgress ||
            newPayload.status !== lastStatus ||
            newPayload.message !== lastMessage
          ) {
            lastProgress = newPayload.progress;
            lastStatus = newPayload.status;
            lastMessage = newPayload.message;

            sse.send({
              event: "progress",
              data: newPayload,
            });
          }

          if (updatedDoc.status === "READY") {
            sse.send({
              event: "complete",
              data: { documentId: updatedDoc.id, workspaceId: updatedDoc.workspaceId, status: "READY" },
            });
            sse.close();
          } else if (updatedDoc.status === "FAILED") {
            sse.send({
              event: "error",
              data: { documentId: updatedDoc.id, workspaceId: updatedDoc.workspaceId, status: "FAILED", message: newPayload.message },
            });
            sse.close();
          }
        } catch {
          sse.close();
        }
      }, 500);
    } catch (err) {
      next(err);
    }
  }
);

documentsRouter.delete(
  "/:workspaceId/:documentId",
  requireAuth,
  requireWorkspaceRole("ADMIN"),
  async (req: AuthedRequest, res, next) => {
    try {
      const workspaceId = typeof req.params.workspaceId === "string"
        ? req.params.workspaceId
        : req.params.workspaceId[0];
      const documentId = typeof req.params.documentId === "string"
        ? req.params.documentId
        : req.params.documentId[0];
      const ctx = { workspaceId };

      // 1. Verify document existence and workspace ownership (include DELETING for safe retry)
      const document = await DocumentRepository.findById(ctx, documentId, true);
      if (!document) {
        return res.status(404).json({ error: "not_found" });
      }

      // 2. Persist durable tombstone state (DELETING) before storage cleanup
      // This immediately excludes the document from search, retrieval, download, and workers
      await DocumentRepository.markDeleting(ctx, documentId);

      // 3. Delete physical object from MinIO/S3
      try {
        await deleteObject(document.storageKey);
      } catch (storageErr) {
        console.error(`Storage deletion failed for document ${documentId}:`, storageErr);
        // Retain document in DELETING state with storageKey preserved for future retry
        return res.status(502).json({
          error: "storage_cleanup_failed",
          documentId: document.id,
          status: "DELETING",
        });
      }

      // 4. Clean up database records (cascades chunks, embeddings, jobs, sessions; cleans content)
      await DocumentRepository.delete(ctx, documentId);

      await recordAuditLog({
        workspaceId,
        userId: req.user!.userId,
        action: "DOCUMENT_DELETED",
        resourceId: document.id,
        resourceName: document.filename,
        details: {
          sizeBytes: document.sizeBytes,
          mimeType: document.mimeType,
        },
      });

      return res.json({
        ok: true,
        documentId: document.id,
        status: "DELETED",
      });
    } catch (err) {
      next(err);
    }
  }
);