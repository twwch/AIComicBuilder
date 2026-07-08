CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id            TEXT PRIMARY KEY NOT NULL,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued',
  current_stage TEXT NOT NULL DEFAULT '',
  progress      INTEGER NOT NULL DEFAULT 0,
  input_json    TEXT,
  result_json   TEXT,
  error_message TEXT,
  started_at    INTEGER,
  finished_at   INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_project ON pipeline_jobs(project_id, type, status, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pipeline_tasks (
  id            TEXT PRIMARY KEY NOT NULL,
  job_id        TEXT NOT NULL REFERENCES pipeline_jobs(id) ON DELETE CASCADE,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  input_hash    TEXT NOT NULL DEFAULT '',
  retry_count   INTEGER NOT NULL DEFAULT 0,
  result_json   TEXT,
  error_message TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pipeline_tasks_job ON pipeline_tasks(job_id, status, stage);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pipeline_logs (
  id         TEXT PRIMARY KEY NOT NULL,
  job_id     TEXT REFERENCES pipeline_jobs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage      TEXT NOT NULL DEFAULT '',
  level      TEXT NOT NULL DEFAULT 'info',
  message    TEXT NOT NULL DEFAULT '',
  meta_json  TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pipeline_logs_project ON pipeline_logs(project_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pipeline_logs_job ON pipeline_logs(job_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pipeline_issues (
  id                  TEXT PRIMARY KEY NOT NULL,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage               TEXT NOT NULL,
  issue_type          TEXT NOT NULL,
  severity            TEXT NOT NULL DEFAULT 'low',
  source_version_type TEXT NOT NULL DEFAULT '',
  source_version_id   TEXT NOT NULL DEFAULT '',
  source_object_type  TEXT NOT NULL DEFAULT '',
  source_object_id    TEXT NOT NULL DEFAULT '',
  source_range_json   TEXT,
  source_text         TEXT NOT NULL DEFAULT '',
  message             TEXT NOT NULL DEFAULT '',
  suggested_action    TEXT NOT NULL DEFAULT 'human_review',
  status              TEXT NOT NULL DEFAULT 'open',
  resolution          TEXT NOT NULL DEFAULT '',
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pipeline_issues_project ON pipeline_issues(project_id, stage, status, severity);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pipeline_issues_source ON pipeline_issues(source_version_type, source_version_id, source_object_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS cost_ledger (
  id          TEXT PRIMARY KEY NOT NULL,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  object_type TEXT NOT NULL DEFAULT '',
  object_id   TEXT NOT NULL DEFAULT '',
  provider    TEXT NOT NULL DEFAULT '',
  model_id    TEXT NOT NULL DEFAULT '',
  cost_cents  INTEGER NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'USD',
  usage_json  TEXT,
  created_at  INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cost_ledger_project_stage ON cost_ledger(project_id, stage, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS asset_library_versions (
  id                          TEXT PRIMARY KEY NOT NULL,
  project_id                  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  confirmed_script_version_id TEXT NOT NULL REFERENCES confirmed_script_versions(id) ON DELETE CASCADE,
  version_num                 INTEGER NOT NULL DEFAULT 1,
  status                      TEXT NOT NULL DEFAULT 'draft',
  assets_json                 TEXT NOT NULL,
  variants_json               TEXT NOT NULL,
  review_summary              TEXT,
  locked_by                   TEXT NOT NULL DEFAULT '',
  created_at                  INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_asset_library_versions_project ON asset_library_versions(project_id, status, version_num);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_asset_library_versions_script ON asset_library_versions(confirmed_script_version_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS visual_asset_versions (
  id                       TEXT PRIMARY KEY NOT NULL,
  project_id               TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_library_version_id TEXT NOT NULL REFERENCES asset_library_versions(id) ON DELETE CASCADE,
  version_num              INTEGER NOT NULL DEFAULT 1,
  status                   TEXT NOT NULL DEFAULT 'draft',
  items_json               TEXT NOT NULL,
  validation_json          TEXT,
  locked_by                TEXT NOT NULL DEFAULT '',
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_visual_asset_versions_project ON visual_asset_versions(project_id, status, version_num);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_visual_asset_versions_library ON visual_asset_versions(asset_library_version_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS visual_assets (
  id                      TEXT PRIMARY KEY NOT NULL,
  project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  visual_asset_version_id TEXT NOT NULL REFERENCES visual_asset_versions(id) ON DELETE CASCADE,
  asset_id                TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  variant_id              TEXT REFERENCES asset_variants(id) ON DELETE SET NULL,
  asset_type              TEXT NOT NULL,
  prompt                  TEXT NOT NULL DEFAULT '',
  negative_prompt         TEXT NOT NULL DEFAULT '',
  result_url              TEXT,
  provider                TEXT NOT NULL DEFAULT '',
  model_id                TEXT NOT NULL DEFAULT '',
  cost_cents              INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'queued',
  review_json             TEXT,
  metadata                TEXT,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_visual_assets_version ON visual_assets(visual_asset_version_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_visual_assets_asset ON visual_assets(asset_id, variant_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS shot_versions (
  id                          TEXT PRIMARY KEY NOT NULL,
  project_id                  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  confirmed_script_version_id TEXT NOT NULL REFERENCES confirmed_script_versions(id) ON DELETE CASCADE,
  asset_library_version_id    TEXT NOT NULL REFERENCES asset_library_versions(id) ON DELETE CASCADE,
  version_num                 INTEGER NOT NULL DEFAULT 1,
  status                      TEXT NOT NULL DEFAULT 'draft',
  shots_json                  TEXT NOT NULL,
  validation_json             TEXT,
  locked_by                   TEXT NOT NULL DEFAULT '',
  created_at                  INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_shot_versions_project ON shot_versions(project_id, status, version_num);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_shot_versions_asset_library ON shot_versions(asset_library_version_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storyboard_pipeline_versions (
  id                      TEXT PRIMARY KEY NOT NULL,
  project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_version_id         TEXT NOT NULL REFERENCES shot_versions(id) ON DELETE CASCADE,
  visual_asset_version_id TEXT REFERENCES visual_asset_versions(id) ON DELETE SET NULL,
  version_num             INTEGER NOT NULL DEFAULT 1,
  status                  TEXT NOT NULL DEFAULT 'draft',
  frames_json             TEXT NOT NULL,
  validation_json         TEXT,
  locked_by               TEXT NOT NULL DEFAULT '',
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storyboard_pipeline_versions_project ON storyboard_pipeline_versions(project_id, status, version_num);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storyboard_pipeline_versions_shot ON storyboard_pipeline_versions(shot_version_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS video_clip_versions (
  id                    TEXT PRIMARY KEY NOT NULL,
  project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  storyboard_version_id TEXT NOT NULL REFERENCES storyboard_pipeline_versions(id) ON DELETE CASCADE,
  version_num           INTEGER NOT NULL DEFAULT 1,
  status                TEXT NOT NULL DEFAULT 'draft',
  clips_json            TEXT NOT NULL,
  quality_json          TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_video_clip_versions_project ON video_clip_versions(project_id, status, version_num);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_video_clip_versions_storyboard ON video_clip_versions(storyboard_version_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS final_export_versions (
  id                    TEXT PRIMARY KEY NOT NULL,
  project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  video_clip_version_id TEXT NOT NULL REFERENCES video_clip_versions(id) ON DELETE CASCADE,
  version_num           INTEGER NOT NULL DEFAULT 1,
  status                TEXT NOT NULL DEFAULT 'draft',
  exports_json          TEXT NOT NULL,
  timeline_json         TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_final_export_versions_project ON final_export_versions(project_id, status, version_num);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_final_export_versions_clips ON final_export_versions(video_clip_version_id);
