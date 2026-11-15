-- Phase 10: Create Full-Text Search GIN Index on chunks(content)
CREATE INDEX IF NOT EXISTS "chunks_content_fts_idx"
    ON "chunks"
    USING gin (to_tsvector('english', "content"));
