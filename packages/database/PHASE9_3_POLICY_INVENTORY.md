# Phase 9.3 — PostgreSQL RLS Policy Inventory

## Policy Overview

All tenant-owned tables have Row-Level Security (RLS) enabled with FORCE to ensure no bypass is possible.

## Direct Workspace-Owned Tables

### Document Table
- **Policy Name**: `document_workspace_isolation`
- **USING Condition**: `"workspaceId" = current_setting('app.workspace_id', true)`
- **WITH CHECK Condition**: `"workspaceId" = current_setting('app.workspace_id', true)`
- **Workspace Source**: Direct column `workspaceId`
- **Expected Isolation**: Blocks cross-workspace SELECT, INSERT, UPDATE, DELETE
- **RLS Status**: ENABLED, FORCED

### Chunks Table
- **Policy Name**: `chunks_workspace_isolation`
- **USING Condition**: `"workspaceId" = current_setting('app.workspace_id', true)`
- **WITH CHECK Condition**: `"workspaceId" = current_setting('app.workspace_id', true)`
- **Workspace Source**: Direct column `workspaceId`
- **Expected Isolation**: Blocks cross-workspace SELECT, INSERT, UPDATE, DELETE
- **RLS Status**: ENABLED, FORCED

### Processing Jobs Table
- **Policy Name**: `processing_jobs_workspace_isolation`
- **USING Condition**: `"workspaceId" = current_setting('app.workspace_id', true)`
- **WITH CHECK Condition**: `"workspaceId" = current_setting('app.workspace_id', true)`
- **Workspace Source**: Direct column `workspaceId`
- **Expected Isolation**: Blocks cross-workspace SELECT, INSERT, UPDATE, DELETE
- **RLS Status**: ENABLED, FORCED

### Upload Sessions Table
- **Policy Name**: `upload_sessions_workspace_isolation`
- **USING Condition**: `"workspaceId" = current_setting('app.workspace_id', true)`
- **WITH CHECK Condition**: `"workspaceId" = current_setting('app.workspace_id', true)`
- **Workspace Source**: Direct column `workspaceId`
- **Expected Isolation**: Blocks cross-workspace SELECT, INSERT, UPDATE, DELETE
- **RLS Status**: ENABLED, FORCED

## Indirect Workspace-Owned Tables

### Document Content Table
- **Policy Name**: `document_content_workspace_isolation`
- **USING Condition**: 
  ```sql
  EXISTS (
    SELECT 1 FROM "Document" d
    WHERE d.id = "DocumentContent"."documentId"
      AND d."workspaceId" = current_setting('app.workspace_id', true)
  )
  ```
- **WITH CHECK Condition**: 
  ```sql
  EXISTS (
    SELECT 1 FROM "Document" d
    WHERE d.id = "DocumentContent"."documentId"
      AND d."workspaceId" = current_setting('app.workspace_id', true)
  )
  ```
- **Workspace Source**: Parent table `Document` via `documentId` foreign key
- **Expected Isolation**: Blocks cross-workspace access through parent document workspace verification
- **RLS Status**: ENABLED, FORCED

### Chunk Embeddings Table
- **Policy Name**: `chunk_embeddings_workspace_isolation`
- **USING Condition**: 
  ```sql
  EXISTS (
    SELECT 1 FROM "chunks" c
    WHERE c.id = "chunk_embeddings"."chunkId"
      AND c."workspaceId" = current_setting('app.workspace_id', true)
  )
  ```
- **WITH CHECK Condition**: 
  ```sql
  EXISTS (
    SELECT 1 FROM "chunks" c
    WHERE c.id = "chunk_embeddings"."chunkId"
      AND c."workspaceId" = current_setting('app.workspace_id', true)
  )
  ```
- **Workspace Source**: Parent table `chunks` via `chunkId` foreign key
- **Expected Isolation**: Blocks cross-workspace access through parent chunk workspace verification
- **RLS Status**: ENABLED, FORCED

## Database Role Configuration

### Application Role
- **Role Name**: `chie_app`
- **Privileges**: 
  - ALL PRIVILEGES ON SCHEMA public
  - ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  - ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  - Default privileges for future tables/sequences
- **Security Properties**: NOSUPERUSER, NOBYPASSRLS
- **Purpose**: Application database connection with RLS enforcement

## Tables WITHOUT RLS (Correctly Excluded)

The following tables are intentionally global/auth-related and should NOT have workspace RLS:

- `organizations` - Global organization data
- `users` - Global user accounts
- `refresh_tokens` - Authentication tokens
- `memberships` - User-workspace membership mapping

## Workspace Context Mechanism

### Setting Name
- **PostgreSQL Setting**: `app.workspace_id`
- **Scope**: Transaction-local (set with `true` parameter to `set_config`)
- **Fail-Closed Behavior**: Returns no rows when unset (due to `true` parameter in `current_setting`)

### Transaction Safety
- **Establishment**: `SELECT set_config('app.workspace_id', ${workspaceId}, true)`
- **Scope**: Same transaction/connection used by protected queries
- **Pool Safety**: Setting is transaction-local, rolled back with transaction
- **No Global State**: No process-global mutable workspace variable

## Verification Status

All policies have been empirically verified through:
- Direct database RLS tests (Phase 9.2)
- Cross-workspace isolation tests (Phase 9.3)
- Fail-closed behavior tests
- INSERT/UPDATE/DELETE protection tests
- Raw vector retrieval isolation tests
- Concurrent context safety tests

## Security Matrix

| Table | A→A | A→B | unset context | INSERT | UPDATE | DELETE |
|-------|-----|-----|---------------|--------|--------|--------|
| Document | ✅ PASS | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK |
| Chunks | ✅ PASS | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK |
| Processing Jobs | ✅ PASS | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK |
| Upload Sessions | ✅ PASS | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK |
| Document Content | ✅ PASS | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK |
| Chunk Embeddings | ✅ PASS | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK | ✅ BLOCK |

## Migration Details

- **Migration Name**: `20260923224100_add_phase9_2_postgresql_rls`
- **Status**: Applied and verified
- **Database Schema**: Up to date with 10 migrations total