import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import fs from "node:fs";
import path from "node:path";

type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;
type SqliteConnection = import("better-sqlite3").Database;
type MigrationMeta = {
  folderMillis: number;
  hash: string;
};

const globalForDb = globalThis as unknown as {
  sqlite: SqliteConnection | undefined;
  drizzleDb: DrizzleDB | undefined;
};

function resolveDbPath() {
  // Dynamic require to avoid loading native binary at build time
  const dbPath = process.env.DATABASE_URL?.replace("file:", "") || "./data/aicomic.db";
  return path.resolve(dbPath);
}

function getSqlite(): SqliteConnection {
  if (globalForDb.sqlite) return globalForDb.sqlite;

  // Dynamic require to avoid loading native binary at build time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const absolutePath = resolveDbPath();

  // Ensure the directory exists before opening the database
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  const sqlite = new Database(absolutePath);
  if (process.env.NODE_ENV !== "production") {
    globalForDb.sqlite = sqlite;
  }

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  return sqlite;
}

function createDb(): DrizzleDB {
  if (globalForDb.drizzleDb) return globalForDb.drizzleDb;

  const sqlite = getSqlite();
  const instance = drizzle(sqlite, { schema });
  if (process.env.NODE_ENV !== "production") {
    globalForDb.drizzleDb = instance;
  }
  return instance;
}

function tableExists(sqlite: SqliteConnection, tableName: string) {
  const row = sqlite
    .prepare<[string], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .get(tableName);

  return Boolean(row);
}

function columnExists(
  sqlite: SqliteConnection,
  tableName: string,
  columnName: string,
) {
  if (!tableExists(sqlite, tableName)) return false;

  const columns = sqlite
    .prepare<[], { name: string }>(`PRAGMA table_info("${tableName}")`)
    .all();

  return columns.some((column) => column.name === columnName);
}

function ensureMigrationsTable(sqlite: SqliteConnection) {
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `).run();
}

function getRecordedMigrationCount(sqlite: SqliteConnection) {
  const row = sqlite
    .prepare<[], { count: number }>(
      'SELECT COUNT(*) AS count FROM "__drizzle_migrations"',
    )
    .get();

  return Number(row?.count ?? 0);
}

function getAppTableCount(sqlite: SqliteConnection) {
  const row = sqlite
    .prepare<[], { count: number }>(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name != '__drizzle_migrations'
    `)
    .get();

  return Number(row?.count ?? 0);
}

function isBaselineCompatibleSchema(sqlite: SqliteConnection) {
  return (
    columnExists(sqlite, "projects", "user_id") &&
    columnExists(sqlite, "projects", "world_setting") &&
    tableExists(sqlite, "episodes") &&
    tableExists(sqlite, "shot_assets") &&
    tableExists(sqlite, "agents") &&
    columnExists(sqlite, "agents", "platform") &&
    tableExists(sqlite, "agent_bindings") &&
    tableExists(sqlite, "import_states")
  );
}

function shouldBaselineExistingSchema(sqlite: SqliteConnection) {
  return (
    getRecordedMigrationCount(sqlite) === 0 &&
    getAppTableCount(sqlite) > 0 &&
    isBaselineCompatibleSchema(sqlite)
  );
}

function baselineMigrations(
  sqlite: SqliteConnection,
  migrationsFolder: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readMigrationFiles } = require("drizzle-orm/migrator") as {
    readMigrationFiles: (config: { migrationsFolder: string }) => MigrationMeta[];
  };

  const migrations = readMigrationFiles({ migrationsFolder });
  const insert = sqlite.prepare<[string, number]>(
    'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
  );

  sqlite.transaction(() => {
    for (const migration of migrations) {
      insert.run(migration.hash, migration.folderMillis);
    }
  })();
}

export function ensureImportStatesTable() {
  const sqlite = getSqlite();
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "import_states" (
      "project_id" text PRIMARY KEY NOT NULL,
      "current_step" integer DEFAULT 0 NOT NULL,
      "step_status" text,
      "full_text" text DEFAULT '',
      "review_issues" text,
      "story_analysis" text,
      "characters" text,
      "items" text,
      "environments" text,
      "voices" text,
      "relationships" text,
      "episodes" text,
      "confirmed_episode_indexes" text,
      "shot_review" text,
      "enrichment_job_id" text,
      "intake_job_id" text,
      "confirmed_script_version_id" text,
      "asset_library_version_id" text,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade
    )
  `).run();
  if (!columnExists(sqlite, "import_states", "shot_review")) {
    sqlite.prepare(`ALTER TABLE "import_states" ADD COLUMN "shot_review" text`).run();
  }
  if (!columnExists(sqlite, "import_states", "enrichment_job_id")) {
    sqlite.prepare(`ALTER TABLE "import_states" ADD COLUMN "enrichment_job_id" text`).run();
  }
  if (!columnExists(sqlite, "import_states", "intake_job_id")) {
    sqlite.prepare(`ALTER TABLE "import_states" ADD COLUMN "intake_job_id" text`).run();
  }
  if (!columnExists(sqlite, "import_states", "confirmed_script_version_id")) {
    sqlite.prepare(`ALTER TABLE "import_states" ADD COLUMN "confirmed_script_version_id" text`).run();
  }
  if (!columnExists(sqlite, "import_states", "asset_library_version_id")) {
    sqlite.prepare(`ALTER TABLE "import_states" ADD COLUMN "asset_library_version_id" text`).run();
  }
}

export function ensureScriptEnrichmentTables() {
  const sqlite = getSqlite();
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "script_enrichment_jobs" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "script_id" text,
      "status" text DEFAULT 'queued' NOT NULL,
      "total_tasks" integer DEFAULT 0 NOT NULL,
      "completed_tasks" integer DEFAULT 0 NOT NULL,
      "failed_tasks" integer DEFAULT 0 NOT NULL,
      "skipped_tasks" integer DEFAULT 0 NOT NULL,
      "current_episode" text DEFAULT '',
      "current_scene" text DEFAULT '',
      "progress" integer DEFAULT 0 NOT NULL,
      "base_text_hash" text DEFAULT '',
      "options" text,
      "error_message" text,
      "started_at" integer,
      "finished_at" integer,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_script_enrichment_jobs_project" ON "script_enrichment_jobs" ("project_id", "status")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "script_enrichment_tasks" (
      "id" text PRIMARY KEY NOT NULL,
      "job_id" text NOT NULL,
      "project_id" text NOT NULL,
      "script_id" text,
      "chunk_id" text,
      "episode_id" text,
      "scene_id" text,
      "beat_id" text DEFAULT '',
      "sequence" integer DEFAULT 0 NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "input_hash" text DEFAULT '' NOT NULL,
      "input_json" text,
      "retry_count" integer DEFAULT 0 NOT NULL,
      "max_retries" integer DEFAULT 2 NOT NULL,
      "result_json" text,
      "error_message" text,
      "started_at" integer,
      "finished_at" integer,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("job_id") REFERENCES "script_enrichment_jobs"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("chunk_id") REFERENCES "script_chunks"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_script_enrichment_tasks_job_status" ON "script_enrichment_tasks" ("job_id", "status", "sequence")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_script_enrichment_tasks_project" ON "script_enrichment_tasks" ("project_id", "job_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "script_enrichment_logs" (
      "id" text PRIMARY KEY NOT NULL,
      "job_id" text NOT NULL,
      "project_id" text NOT NULL,
      "level" text DEFAULT 'info' NOT NULL,
      "message" text DEFAULT '' NOT NULL,
      "meta_json" text,
      "created_at" integer NOT NULL,
      FOREIGN KEY ("job_id") REFERENCES "script_enrichment_jobs"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_script_enrichment_logs_job" ON "script_enrichment_logs" ("job_id", "created_at")`).run();
}

export function ensureScriptIntakeTables() {
  const sqlite = getSqlite();
  ensureStoryPipelineTables();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "intake_jobs" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "script_id" text,
      "source_filename" text DEFAULT '' NOT NULL,
      "source_type" text DEFAULT '' NOT NULL,
      "source_path" text DEFAULT '' NOT NULL,
      "status" text DEFAULT 'queued' NOT NULL,
      "current_stage" text DEFAULT 'upload_document' NOT NULL,
      "progress" integer DEFAULT 0 NOT NULL,
      "options" text,
      "issue_summary" text,
      "error_message" text,
      "confirmed_script_version_id" text,
      "started_at" integer,
      "finished_at" integer,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_intake_jobs_project_status" ON "intake_jobs" ("project_id", "status", "created_at")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_intake_jobs_script" ON "intake_jobs" ("script_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "intake_job_stages" (
      "id" text PRIMARY KEY NOT NULL,
      "job_id" text NOT NULL,
      "project_id" text NOT NULL,
      "stage" text NOT NULL,
      "sequence" integer DEFAULT 0 NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "input_hash" text DEFAULT '' NOT NULL,
      "result_json" text,
      "issues_json" text,
      "logs_json" text,
      "error_message" text,
      "started_at" integer,
      "finished_at" integer,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("job_id") REFERENCES "intake_jobs"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade
    )
  `).run();
  sqlite.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_intake_job_stages_job_stage" ON "intake_job_stages" ("job_id", "stage")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_intake_job_stages_status" ON "intake_job_stages" ("job_id", "status", "sequence")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "intake_job_logs" (
      "id" text PRIMARY KEY NOT NULL,
      "job_id" text NOT NULL,
      "project_id" text NOT NULL,
      "stage" text DEFAULT '' NOT NULL,
      "level" text DEFAULT 'info' NOT NULL,
      "message" text DEFAULT '' NOT NULL,
      "meta_json" text,
      "created_at" integer NOT NULL,
      FOREIGN KEY ("job_id") REFERENCES "intake_jobs"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_intake_job_logs_job" ON "intake_job_logs" ("job_id", "created_at")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "confirmed_script_versions" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "script_id" text,
      "intake_job_id" text,
      "version_num" integer DEFAULT 1 NOT NULL,
      "title" text DEFAULT '' NOT NULL,
      "language" text DEFAULT '' NOT NULL,
      "content_hash" text DEFAULT '' NOT NULL,
      "content" text DEFAULT '' NOT NULL,
      "structure_json" text,
      "review_summary" text,
      "confirmed_by" text DEFAULT '' NOT NULL,
      "status" text DEFAULT 'active' NOT NULL,
      "created_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("intake_job_id") REFERENCES "intake_jobs"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_confirmed_script_versions_project" ON "confirmed_script_versions" ("project_id", "status", "version_num")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_confirmed_script_versions_job" ON "confirmed_script_versions" ("intake_job_id")`).run();
}

export function ensureAssetLibraryTables() {
  const sqlite = getSqlite();
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "assets" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "type" text NOT NULL,
      "name" text NOT NULL,
      "aliases" text DEFAULT '[]' NOT NULL,
      "importance" integer DEFAULT 0 NOT NULL,
      "description" text DEFAULT '' NOT NULL,
      "visual_constraints" text DEFAULT '' NOT NULL,
      "negative_constraints" text DEFAULT '' NOT NULL,
      "first_appearance" text DEFAULT '' NOT NULL,
      "first_appearance_chunk_id" text,
      "confirmed" integer DEFAULT 0 NOT NULL,
      "reference_image" text,
      "version" integer DEFAULT 1 NOT NULL,
      "metadata" text,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("first_appearance_chunk_id") REFERENCES "script_chunks"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_assets_project_type" ON "assets" ("project_id", "type")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_assets_name" ON "assets" ("project_id", "name")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "character_assets" (
      "asset_id" text PRIMARY KEY NOT NULL,
      "character_id" text,
      "role_name" text DEFAULT '',
      "age" text DEFAULT '',
      "gender" text DEFAULT '',
      "personality" text DEFAULT '',
      "costume" text DEFAULT '',
      "voice" text DEFAULT '',
      "relationship_notes" text DEFAULT '',
      FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_character_assets_character" ON "character_assets" ("character_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "scene_assets" (
      "asset_id" text PRIMARY KEY NOT NULL,
      "scene_id" text,
      "location_type" text DEFAULT '',
      "time_of_day" text DEFAULT '',
      "lighting" text DEFAULT '',
      "weather" text DEFAULT '',
      "layout" text DEFAULT '',
      FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_scene_assets_scene" ON "scene_assets" ("scene_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "prop_assets" (
      "asset_id" text PRIMARY KEY NOT NULL,
      "prop_category" text DEFAULT '',
      "owner_character_id" text,
      "scene_id" text,
      "state" text DEFAULT '',
      "usage_rules" text DEFAULT '',
      FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("owner_character_id") REFERENCES "characters"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_prop_assets_scene" ON "prop_assets" ("scene_id")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_prop_assets_owner" ON "prop_assets" ("owner_character_id")`).run();

  ensureAssetVariantTable(sqlite);
}

function ensureAssetVariantTable(sqlite: SqliteConnection) {
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "asset_variants" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "asset_id" text NOT NULL,
      "source_candidate_id" text,
      "source_occurrence_id" text,
      "variant_type" text DEFAULT 'default' NOT NULL,
      "name" text NOT NULL,
      "state" text DEFAULT '' NOT NULL,
      "locked_traits" text,
      "changed_traits" text,
      "visual_constraints" text DEFAULT '' NOT NULL,
      "negative_constraints" text DEFAULT '' NOT NULL,
      "reference_image" text,
      "status" text DEFAULT 'draft' NOT NULL,
      "metadata" text,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("source_candidate_id") REFERENCES "asset_candidates"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("source_occurrence_id") REFERENCES "asset_occurrences"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_asset_variants_asset" ON "asset_variants" ("asset_id", "status")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_asset_variants_project" ON "asset_variants" ("project_id", "asset_id")`).run();
  sqlite.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_asset_variants_asset_name" ON "asset_variants" ("asset_id", "name")`).run();
}

export function ensureProductionBibleTable() {
  const sqlite = getSqlite();
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "production_bibles" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "episode_id" text,
      "source_script_id" text,
      "version" integer DEFAULT 1 NOT NULL,
      "title" text DEFAULT '' NOT NULL,
      "world_setting" text DEFAULT '' NOT NULL,
      "visual_style" text DEFAULT '' NOT NULL,
      "era_constraints" text DEFAULT '' NOT NULL,
      "location_rules" text DEFAULT '' NOT NULL,
      "character_rules" text DEFAULT '' NOT NULL,
      "scene_rules" text DEFAULT '' NOT NULL,
      "prop_rules" text DEFAULT '' NOT NULL,
      "positive_prompt_template" text DEFAULT '' NOT NULL,
      "negative_prompt_template" text DEFAULT '' NOT NULL,
      "compliance_rules" text DEFAULT '' NOT NULL,
      "status" text DEFAULT 'draft' NOT NULL,
      "is_active" integer DEFAULT 0 NOT NULL,
      "metadata" text,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("source_script_id") REFERENCES "scripts"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_production_bibles_project" ON "production_bibles" ("project_id", "is_active")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_production_bibles_episode" ON "production_bibles" ("episode_id")`).run();
}

export function ensureStoryPipelineTables() {
  const sqlite = getSqlite();
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "scripts" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "episode_id" text,
      "title" text DEFAULT '' NOT NULL,
      "source_filename" text DEFAULT '',
      "source_type" text DEFAULT '',
      "language" text DEFAULT '',
      "content_hash" text DEFAULT '',
      "raw_text" text DEFAULT '' NOT NULL,
      "cleaned_text" text DEFAULT '',
      "structured_json" text,
      "status" text DEFAULT 'uploaded' NOT NULL,
      "metadata" text,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_scripts_project" ON "scripts" ("project_id")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_scripts_episode" ON "scripts" ("episode_id")`).run();
  if (!columnExists(sqlite, "scripts", "structured_json")) {
    sqlite.prepare(`ALTER TABLE "scripts" ADD COLUMN "structured_json" text`).run();
  }

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "script_chunks" (
      "id" text PRIMARY KEY NOT NULL,
      "script_id" text NOT NULL,
      "project_id" text NOT NULL,
      "episode_id" text,
      "scene_id" text,
      "chunk_index" integer NOT NULL,
      "episode_index" integer DEFAULT 0,
      "scene_index" integer DEFAULT 0,
      "text" text NOT NULL,
      "start_index" integer DEFAULT 0 NOT NULL,
      "end_index" integer DEFAULT 0 NOT NULL,
      "overlap_before" integer DEFAULT 0 NOT NULL,
      "overlap_after" integer DEFAULT 0 NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "metadata" text,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_script_chunks_script_index" ON "script_chunks" ("script_id", "chunk_index")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_script_chunks_project_episode_scene" ON "script_chunks" ("project_id", "episode_id", "scene_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "compliance_reports" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "script_id" text,
      "chunk_id" text,
      "risk_level" text DEFAULT 'low' NOT NULL,
      "risk_type" text DEFAULT '' NOT NULL,
      "source_text" text DEFAULT '' NOT NULL,
      "reason" text DEFAULT '' NOT NULL,
      "suggestion" text DEFAULT '' NOT NULL,
      "need_human_review" integer DEFAULT 0 NOT NULL,
      "status" text DEFAULT 'open' NOT NULL,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("chunk_id") REFERENCES "script_chunks"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_compliance_reports_project" ON "compliance_reports" ("project_id", "risk_level")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_compliance_reports_chunk" ON "compliance_reports" ("chunk_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "asset_candidates" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "script_id" text,
      "chunk_id" text,
      "episode_id" text,
      "scene_id" text,
      "asset_type" text NOT NULL,
      "name" text NOT NULL,
      "normalized_name" text DEFAULT '' NOT NULL,
      "aliases" text,
      "role" text DEFAULT '' NOT NULL,
      "description" text DEFAULT '' NOT NULL,
      "evidence_text" text DEFAULT '' NOT NULL,
      "confidence" integer DEFAULT 50 NOT NULL,
      "source" text DEFAULT 'ai' NOT NULL,
      "status" text DEFAULT 'candidate' NOT NULL,
      "merged_asset_id" text,
      "metadata" text,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("chunk_id") REFERENCES "script_chunks"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("merged_asset_id") REFERENCES "assets"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_asset_candidates_project_type" ON "asset_candidates" ("project_id", "asset_type", "status")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_asset_candidates_chunk" ON "asset_candidates" ("chunk_id")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_asset_candidates_name" ON "asset_candidates" ("project_id", "asset_type", "normalized_name")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_asset_candidates_merged_asset" ON "asset_candidates" ("merged_asset_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "asset_occurrences" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "asset_id" text NOT NULL,
      "script_id" text,
      "chunk_id" text,
      "episode_id" text,
      "scene_id" text,
      "candidate_id" text,
      "occurrence_type" text DEFAULT 'mention' NOT NULL,
      "evidence_text" text DEFAULT '' NOT NULL,
      "importance" integer DEFAULT 0 NOT NULL,
      "metadata" text,
      "created_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("chunk_id") REFERENCES "script_chunks"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("candidate_id") REFERENCES "asset_candidates"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_asset_occurrences_asset" ON "asset_occurrences" ("asset_id")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_asset_occurrences_project_chunk" ON "asset_occurrences" ("project_id", "chunk_id")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_asset_occurrences_episode_scene" ON "asset_occurrences" ("episode_id", "scene_id")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_asset_occurrences_candidate" ON "asset_occurrences" ("candidate_id")`).run();

  ensureAssetVariantTable(sqlite);

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "shot_specs" (
      "id" text PRIMARY KEY NOT NULL,
      "shot_id" text,
      "project_id" text NOT NULL,
      "episode_id" text,
      "scene_id" text,
      "script_chunk_id" text,
      "sequence" integer DEFAULT 0 NOT NULL,
      "duration" integer DEFAULT 10 NOT NULL,
      "characters" text DEFAULT '[]' NOT NULL,
      "scene_asset_id" text,
      "prop_asset_ids" text DEFAULT '[]' NOT NULL,
      "shot_type" text DEFAULT '' NOT NULL,
      "camera_angle" text DEFAULT '' NOT NULL,
      "camera_movement" text DEFAULT '' NOT NULL,
      "action" text DEFAULT '' NOT NULL,
      "emotion" text DEFAULT '' NOT NULL,
      "dialogue" text DEFAULT '' NOT NULL,
      "voiceover" text DEFAULT '' NOT NULL,
      "continuity_in" text DEFAULT '' NOT NULL,
      "continuity_out" text DEFAULT '' NOT NULL,
      "positive_prompt" text DEFAULT '' NOT NULL,
      "negative_prompt" text DEFAULT '' NOT NULL,
      "status" text DEFAULT 'draft' NOT NULL,
      "version" integer DEFAULT 1 NOT NULL,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("shot_id") REFERENCES "shots"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("script_chunk_id") REFERENCES "script_chunks"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("scene_asset_id") REFERENCES "assets"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_shot_specs_project_episode_scene" ON "shot_specs" ("project_id", "episode_id", "scene_id")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_shot_specs_shot" ON "shot_specs" ("shot_id")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_shot_specs_chunk" ON "shot_specs" ("script_chunk_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "storyboard_frames" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "episode_id" text,
      "scene_id" text,
      "shot_id" text,
      "shot_spec_id" text,
      "frame_index" integer DEFAULT 0 NOT NULL,
      "image_url" text,
      "prompt" text DEFAULT '' NOT NULL,
      "negative_prompt" text DEFAULT '' NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "model_provider" text,
      "model_id" text,
      "metadata" text,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON UPDATE no action ON DELETE set null,
      FOREIGN KEY ("shot_id") REFERENCES "shots"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("shot_spec_id") REFERENCES "shot_specs"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_storyboard_frames_project" ON "storyboard_frames" ("project_id", "episode_id", "scene_id")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_storyboard_frames_shot" ON "storyboard_frames" ("shot_id", "frame_index")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_storyboard_frames_spec" ON "storyboard_frames" ("shot_spec_id")`).run();
}

export function ensureProductionPipelineTables() {
  const sqlite = getSqlite();
  ensureScriptIntakeTables();
  ensureAssetLibraryTables();
  ensureStoryPipelineTables();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "pipeline_jobs" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "type" text NOT NULL,
      "status" text DEFAULT 'queued' NOT NULL,
      "current_stage" text DEFAULT '' NOT NULL,
      "progress" integer DEFAULT 0 NOT NULL,
      "input_json" text,
      "result_json" text,
      "error_message" text,
      "started_at" integer,
      "finished_at" integer,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_pipeline_jobs_project" ON "pipeline_jobs" ("project_id", "type", "status", "created_at")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "pipeline_tasks" (
      "id" text PRIMARY KEY NOT NULL,
      "job_id" text NOT NULL,
      "project_id" text NOT NULL,
      "stage" text NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "input_hash" text DEFAULT '' NOT NULL,
      "retry_count" integer DEFAULT 0 NOT NULL,
      "result_json" text,
      "error_message" text,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("job_id") REFERENCES "pipeline_jobs"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_pipeline_tasks_job" ON "pipeline_tasks" ("job_id", "status", "stage")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "pipeline_logs" (
      "id" text PRIMARY KEY NOT NULL,
      "job_id" text,
      "project_id" text NOT NULL,
      "stage" text DEFAULT '' NOT NULL,
      "level" text DEFAULT 'info' NOT NULL,
      "message" text DEFAULT '' NOT NULL,
      "meta_json" text,
      "created_at" integer NOT NULL,
      FOREIGN KEY ("job_id") REFERENCES "pipeline_jobs"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_pipeline_logs_project" ON "pipeline_logs" ("project_id", "created_at")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_pipeline_logs_job" ON "pipeline_logs" ("job_id", "created_at")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "pipeline_issues" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "stage" text NOT NULL,
      "issue_type" text NOT NULL,
      "severity" text DEFAULT 'low' NOT NULL,
      "source_version_type" text DEFAULT '' NOT NULL,
      "source_version_id" text DEFAULT '' NOT NULL,
      "source_object_type" text DEFAULT '' NOT NULL,
      "source_object_id" text DEFAULT '' NOT NULL,
      "source_range_json" text,
      "source_text" text DEFAULT '' NOT NULL,
      "message" text DEFAULT '' NOT NULL,
      "suggested_action" text DEFAULT 'human_review' NOT NULL,
      "status" text DEFAULT 'open' NOT NULL,
      "resolution" text DEFAULT '' NOT NULL,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_pipeline_issues_project" ON "pipeline_issues" ("project_id", "stage", "status", "severity")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_pipeline_issues_source" ON "pipeline_issues" ("source_version_type", "source_version_id", "source_object_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "cost_ledger" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "stage" text NOT NULL,
      "object_type" text DEFAULT '' NOT NULL,
      "object_id" text DEFAULT '' NOT NULL,
      "provider" text DEFAULT '' NOT NULL,
      "model_id" text DEFAULT '' NOT NULL,
      "cost_cents" integer DEFAULT 0 NOT NULL,
      "currency" text DEFAULT 'USD' NOT NULL,
      "usage_json" text,
      "created_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_cost_ledger_project_stage" ON "cost_ledger" ("project_id", "stage", "created_at")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "asset_library_versions" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "confirmed_script_version_id" text NOT NULL,
      "version_num" integer DEFAULT 1 NOT NULL,
      "status" text DEFAULT 'draft' NOT NULL,
      "assets_json" text NOT NULL,
      "variants_json" text NOT NULL,
      "review_summary" text,
      "locked_by" text DEFAULT '' NOT NULL,
      "created_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("confirmed_script_version_id") REFERENCES "confirmed_script_versions"("id") ON UPDATE no action ON DELETE cascade
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_asset_library_versions_project" ON "asset_library_versions" ("project_id", "status", "version_num")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_asset_library_versions_script" ON "asset_library_versions" ("confirmed_script_version_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "visual_asset_versions" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "asset_library_version_id" text NOT NULL,
      "version_num" integer DEFAULT 1 NOT NULL,
      "status" text DEFAULT 'draft' NOT NULL,
      "items_json" text NOT NULL,
      "validation_json" text,
      "locked_by" text DEFAULT '' NOT NULL,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("asset_library_version_id") REFERENCES "asset_library_versions"("id") ON UPDATE no action ON DELETE cascade
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_visual_asset_versions_project" ON "visual_asset_versions" ("project_id", "status", "version_num")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_visual_asset_versions_library" ON "visual_asset_versions" ("asset_library_version_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "visual_assets" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "visual_asset_version_id" text NOT NULL,
      "asset_id" text NOT NULL,
      "variant_id" text,
      "asset_type" text NOT NULL,
      "prompt" text DEFAULT '' NOT NULL,
      "negative_prompt" text DEFAULT '' NOT NULL,
      "result_url" text,
      "provider" text DEFAULT '' NOT NULL,
      "model_id" text DEFAULT '' NOT NULL,
      "cost_cents" integer DEFAULT 0 NOT NULL,
      "status" text DEFAULT 'queued' NOT NULL,
      "review_json" text,
      "metadata" text,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("visual_asset_version_id") REFERENCES "visual_asset_versions"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("variant_id") REFERENCES "asset_variants"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_visual_assets_version" ON "visual_assets" ("visual_asset_version_id", "status")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_visual_assets_asset" ON "visual_assets" ("asset_id", "variant_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "shot_versions" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "confirmed_script_version_id" text NOT NULL,
      "asset_library_version_id" text NOT NULL,
      "version_num" integer DEFAULT 1 NOT NULL,
      "status" text DEFAULT 'draft' NOT NULL,
      "shots_json" text NOT NULL,
      "validation_json" text,
      "locked_by" text DEFAULT '' NOT NULL,
      "created_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("confirmed_script_version_id") REFERENCES "confirmed_script_versions"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("asset_library_version_id") REFERENCES "asset_library_versions"("id") ON UPDATE no action ON DELETE cascade
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_shot_versions_project" ON "shot_versions" ("project_id", "status", "version_num")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_shot_versions_asset_library" ON "shot_versions" ("asset_library_version_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "storyboard_pipeline_versions" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "shot_version_id" text NOT NULL,
      "visual_asset_version_id" text,
      "version_num" integer DEFAULT 1 NOT NULL,
      "status" text DEFAULT 'draft' NOT NULL,
      "frames_json" text NOT NULL,
      "validation_json" text,
      "locked_by" text DEFAULT '' NOT NULL,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("shot_version_id") REFERENCES "shot_versions"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("visual_asset_version_id") REFERENCES "visual_asset_versions"("id") ON UPDATE no action ON DELETE set null
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_storyboard_pipeline_versions_project" ON "storyboard_pipeline_versions" ("project_id", "status", "version_num")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_storyboard_pipeline_versions_shot" ON "storyboard_pipeline_versions" ("shot_version_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "video_clip_versions" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "storyboard_version_id" text NOT NULL,
      "version_num" integer DEFAULT 1 NOT NULL,
      "status" text DEFAULT 'draft' NOT NULL,
      "clips_json" text NOT NULL,
      "quality_json" text,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("storyboard_version_id") REFERENCES "storyboard_pipeline_versions"("id") ON UPDATE no action ON DELETE cascade
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_video_clip_versions_project" ON "video_clip_versions" ("project_id", "status", "version_num")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_video_clip_versions_storyboard" ON "video_clip_versions" ("storyboard_version_id")`).run();

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "final_export_versions" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "video_clip_version_id" text NOT NULL,
      "version_num" integer DEFAULT 1 NOT NULL,
      "status" text DEFAULT 'draft' NOT NULL,
      "exports_json" text NOT NULL,
      "timeline_json" text,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY ("video_clip_version_id") REFERENCES "video_clip_versions"("id") ON UPDATE no action ON DELETE cascade
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_final_export_versions_project" ON "final_export_versions" ("project_id", "status", "version_num")`).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_final_export_versions_clips" ON "final_export_versions" ("video_clip_version_id")`).run();
}

export function runMigrations() {
  const sqlite = getSqlite();
  const migrationsFolder = path.resolve("drizzle");
  ensureMigrationsTable(sqlite);

  if (shouldBaselineExistingSchema(sqlite)) {
    console.log(
      "[DB] Existing schema detected without migration history. Baselining migrations...",
    );
    baselineMigrations(sqlite, migrationsFolder);
    ensureImportStatesTable();
    ensureAssetLibraryTables();
    ensureProductionBibleTable();
    ensureStoryPipelineTables();
    ensureScriptEnrichmentTables();
    ensureScriptIntakeTables();
    ensureProductionPipelineTables();
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { migrate } = require("drizzle-orm/better-sqlite3/migrator");
  migrate(createDb(), { migrationsFolder });
  ensureImportStatesTable();
  ensureAssetLibraryTables();
  ensureProductionBibleTable();
  ensureStoryPipelineTables();
  ensureScriptEnrichmentTables();
  ensureScriptIntakeTables();
  ensureProductionPipelineTables();
}

// Proxy preserves the `db` export API — lazy-inits on first property access
export const db: DrizzleDB = new Proxy({} as DrizzleDB, {
  get(_, prop) {
    const instance = createDb();
    const value = (instance as never)[prop];
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(instance);
    }
    return value;
  },
});

export type DB = typeof db;
