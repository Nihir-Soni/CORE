-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'DELETING';

-- DropForeignKey and AddForeignKey with ON DELETE CASCADE
ALTER TABLE "DocumentContent" DROP CONSTRAINT IF EXISTS "DocumentContent_documentId_fkey";
ALTER TABLE "DocumentContent" ADD CONSTRAINT "DocumentContent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
