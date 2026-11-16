ALTER TABLE "processing_jobs"
ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "processing_jobs"
ADD COLUMN "progressMessage" TEXT;