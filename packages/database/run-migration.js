import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

async function run() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL || "postgresql://core:core@127.0.0.1:5432/core";
  console.log("Connecting to", connectionString);
  const client = new pg.Client({ connectionString });
  await client.connect();

  const migrationSql = fs.readFileSync(
    path.resolve(process.cwd(), "packages/database/prisma/migrations/20260923224100_add_phase9_2_postgresql_rls/migration.sql"),
    "utf8"
  );

  console.log("Applying RLS migration SQL...");
  await client.query(migrationSql);
  console.log("MIGRATION EXECUTED SUCCESSFULLY");

  // Also record in _prisma_migrations table if present
  try {
    await client.query(`
      INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
      VALUES (gen_random_uuid()::text, 'checksum', NOW(), '20260923224100_add_phase9_2_postgresql_rls', NULL, NULL, NOW(), 1)
      ON CONFLICT (migration_name) DO NOTHING;
    `);
    console.log("_prisma_migrations table updated.");
  } catch (err) {
    console.log("Notice: _prisma_migrations table insert ignored", err.message);
  }

  await client.end();
}

run().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
