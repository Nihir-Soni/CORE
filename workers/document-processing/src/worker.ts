import { Worker } from "bullmq";
import { connection, type DocumentProcessingJob } from "@core/jobs";
import { processDocument } from "./processDocument.js";
import { prisma } from "@core/database";
import { createDefaultAIProvider } from "@core/ai";
import { verifyTesseract } from "@core/extraction";

console.log("Starting Document Processing Worker...");

// Non-blocking OCR diagnostic check at startup
verifyTesseract()
  .then((diag) => {
    if (diag.available && diag.hasRequiredLanguage) {
      console.log(
        `[OCR] Tesseract OCR is available at '${diag.binaryPath}' (v${diag.version}, languages: ${diag.languages.join(", ")})`
      );
    } else if (diag.available && !diag.hasRequiredLanguage) {
      console.warn(
        `[OCR] Warning: Tesseract OCR is installed at '${diag.binaryPath}', but required language '${diag.requiredLanguage}' is missing. ${diag.instructions}`
      );
    } else {
      console.warn(
        `[OCR] Notice: Tesseract OCR is not available. Scanned documents and images requiring OCR will fail with actionable diagnostic errors. ${diag.instructions}`
      );
    }
  })
  .catch((err) => {
    console.warn("[OCR] Failed to run Tesseract diagnostic check:", err);
  });

const provider = createDefaultAIProvider();

const worker = new Worker<DocumentProcessingJob>(
  "document-processing",
  async (job) => {
    return processDocument(
      job.data.documentId,
      job.data.workspaceId,
      job.data.processingJobId || job.id!,
      job.attemptsMade,
      job.opts.attempts || 3,
      provider,
      prisma
    );
  },
  {
    connection,
  }
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed successfully.`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down worker...");
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});
