
import { Queue, Worker } from "bullmq";
import { connection, type DocumentProcessingJob } from "@core/jobs";
import { processDocument } from "./processDocument.js";
import { prisma } from "@core/database";
import { createDefaultAIProvider } from "@core/ai";

const QUEUE_NAME = "document-processing";
const IDLE_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 2_000;

const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    const queue = new Queue<DocumentProcessingJob>(QUEUE_NAME, {
        connection,
    });

    const provider = createDefaultAIProvider();

    const worker = new Worker<DocumentProcessingJob>(
        QUEUE_NAME,
        async (job) => {
            console.log(`Processing job ${job.id}`);

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
        { connection }
    );

    worker.on("completed", (job) => {
        console.log(`Job ${job.id} completed successfully.`);
    });

    worker.on("failed", (job, error) => {
        console.error(`Job ${job?.id} failed:`, error);
    });

    worker.on("error", (error) => {
        console.error("Worker error:", error);
    });

    try {
        await worker.waitUntilReady();

        console.log("One-shot document worker is ready.");

        let idleSince: number | null = null;

        while (true) {
            const counts = await queue.getJobCounts(
                "waiting",
                "active",
                "delayed",
                "prioritized",
                "waiting-children"
            );

            const pendingJobs = Object.values(counts).reduce(
                (total, count) => total + count,
                0
            );

            if (pendingJobs === 0) {
                if (idleSince === null) {
                    idleSince = Date.now();
                }

                if (Date.now() - idleSince >= IDLE_TIMEOUT_MS) {
                    console.log("Queue idle. Shutting down worker.");
                    break;
                }
            } else {
                idleSince = null;
                console.log(`Jobs remaining in queue: ${pendingJobs}`);
            }

            await sleep(POLL_INTERVAL_MS);
        }
    } finally {
        await worker.close();
        await queue.close();
        await prisma.$disconnect();

        console.log("One-shot worker shut down cleanly.");
    }
}

main().catch((error) => {
    console.error("One-shot worker failed:", error);
    process.exitCode = 1;
});
