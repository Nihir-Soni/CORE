import { Queue } from "bullmq";
import { connection } from "./connection.js";
import type { DocumentProcessingJob } from "./types.js";

export const documentProcessingQueue = new Queue<DocumentProcessingJob>(
  "document-processing",
  {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: {
        age: 24 * 3600,
        count: 1000,
      },
      removeOnFail: {
        age: 7 * 24 * 3600,
      }
    }
  }
);
