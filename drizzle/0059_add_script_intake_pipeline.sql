CREATE TABLE IF NOT EXISTS intake_jobs (
  id                          TEXT PRIMARY KEY NOT NULL,
  project_id                  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  script_id                   TEXT REFERENCES scripts(id) ON DELETE SET NULL,
  source_filename             TEXT NOT NULL DEFAULT '',
  source_type                 TEXT NOT NULL DEFAULT '',
  source_path                 TEXT NOT NULL DEFAULT '',
  status                      TEXT NOT NULL DEFAULT 'queued',
  current_stage               TEXT NOT NULL DEFAULT 'upload_document',
  progress                    INTEGER NOT NULL DEFAULT 0,
  options                     TEXT,
  issue_summary               TEXT,
  error_message               TEXT,
  confirmed_script_version_id TEXT,
  started_at                  INTEGER,
  finished_at                 INTEGER,
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_intake_jobs_project_status ON intake_jobs(project_id, status, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_intake_jobs_script ON intake_jobs(script_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS intake_job_stages (
  id            TEXT PRIMARY KEY NOT NULL,
  job_id        TEXT NOT NULL REFERENCES intake_jobs(id) ON DELETE CASCADE,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,
  sequence      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',
  input_hash    TEXT NOT NULL DEFAULT '',
  result_json   TEXT,
  issues_json   TEXT,
  logs_json     TEXT,
  error_message TEXT,
  started_at    INTEGER,
  finished_at   INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_job_stages_job_stage ON intake_job_stages(job_id, stage);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_intake_job_stages_status ON intake_job_stages(job_id, status, sequence);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS intake_job_logs (
  id         TEXT PRIMARY KEY NOT NULL,
  job_id     TEXT NOT NULL REFERENCES intake_jobs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage      TEXT NOT NULL DEFAULT '',
  level      TEXT NOT NULL DEFAULT 'info',
  message    TEXT NOT NULL DEFAULT '',
  meta_json  TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_intake_job_logs_job ON intake_job_logs(job_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS confirmed_script_versions (
  id             TEXT PRIMARY KEY NOT NULL,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  script_id      TEXT REFERENCES scripts(id) ON DELETE SET NULL,
  intake_job_id  TEXT REFERENCES intake_jobs(id) ON DELETE SET NULL,
  version_num    INTEGER NOT NULL DEFAULT 1,
  title          TEXT NOT NULL DEFAULT '',
  language       TEXT NOT NULL DEFAULT '',
  content_hash   TEXT NOT NULL DEFAULT '',
  content        TEXT NOT NULL DEFAULT '',
  structure_json TEXT,
  review_summary TEXT,
  confirmed_by   TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_confirmed_script_versions_project ON confirmed_script_versions(project_id, status, version_num);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_confirmed_script_versions_job ON confirmed_script_versions(intake_job_id);
