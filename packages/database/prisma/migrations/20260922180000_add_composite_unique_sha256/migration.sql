-- Clean up duplicate documents keeping the earliest created one per (workspaceId, sha256)
WITH dupes AS (
  SELECT d1.id
  FROM "Document" d1
  WHERE d1.sha256 IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "Document" d2
      WHERE d2."workspaceId" = d1."workspaceId"
        AND d2.sha256 = d1.sha256
        AND (d2."createdAt" < d1."createdAt" OR (d2."createdAt" = d1."createdAt" AND d2.id < d1.id))
    )
)
DELETE FROM "DocumentContent" WHERE "documentId" IN (SELECT id FROM dupes);

WITH dupes AS (
  SELECT d1.id
  FROM "Document" d1
  WHERE d1.sha256 IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "Document" d2
      WHERE d2."workspaceId" = d1."workspaceId"
        AND d2.sha256 = d1.sha256
        AND (d2."createdAt" < d1."createdAt" OR (d2."createdAt" = d1."createdAt" AND d2.id < d1.id))
    )
)
DELETE FROM "Document" WHERE id IN (SELECT id FROM dupes);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Document_workspaceId_sha256_key" ON "Document"("workspaceId", "sha256");
