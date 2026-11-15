-- Phase 9.2: PostgreSQL Row-Level Security (RLS) policies for tenant isolation

-- Step 0: Ensure non-superuser / app user role exists for RLS enforcement
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'chie_app') THEN
    CREATE ROLE chie_app WITH LOGIN PASSWORD 'core' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON SCHEMA public TO chie_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO chie_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO chie_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO chie_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO chie_app;

-- Step 1: Enable and Force Row Level Security on workspace-sensitive tables
ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" FORCE ROW LEVEL SECURITY;

ALTER TABLE "chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chunks" FORCE ROW LEVEL SECURITY;

ALTER TABLE "processing_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processing_jobs" FORCE ROW LEVEL SECURITY;

ALTER TABLE "upload_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "upload_sessions" FORCE ROW LEVEL SECURITY;

ALTER TABLE "DocumentContent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentContent" FORCE ROW LEVEL SECURITY;

ALTER TABLE "chunk_embeddings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chunk_embeddings" FORCE ROW LEVEL SECURITY;

-- Step 2: Create RLS policies for tables with a direct workspaceId column

CREATE POLICY "document_workspace_isolation" ON "Document"
  FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "chunks_workspace_isolation" ON "chunks"
  FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "processing_jobs_workspace_isolation" ON "processing_jobs"
  FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "upload_sessions_workspace_isolation" ON "upload_sessions"
  FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

-- Step 3: Create RLS policies for indirectly workspace-owned tables

CREATE POLICY "document_content_workspace_isolation" ON "DocumentContent"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "Document" d
      WHERE d.id = "DocumentContent"."documentId"
        AND d."workspaceId" = current_setting('app.workspace_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Document" d
      WHERE d.id = "DocumentContent"."documentId"
        AND d."workspaceId" = current_setting('app.workspace_id', true)
    )
  );

CREATE POLICY "chunk_embeddings_workspace_isolation" ON "chunk_embeddings"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "chunks" c
      WHERE c.id = "chunk_embeddings"."chunkId"
        AND c."workspaceId" = current_setting('app.workspace_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "chunks" c
      WHERE c.id = "chunk_embeddings"."chunkId"
        AND c."workspaceId" = current_setting('app.workspace_id', true)
    )
  );
