import { documentProcessingQueue } from "@core/jobs";

async function run() {
  console.log("Enqueuing test job...");
  const job = await documentProcessingQueue.add("test-job", {
    documentId: "test-document-id",
    workspaceId: "test-workspace-id",
    processingJobId: "test-job-id",
  });
  console.log(`Successfully enqueued job ${job.id}`);
  process.exit(0);
}

run().catch(console.error);
