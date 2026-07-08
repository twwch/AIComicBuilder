CREATE TABLE IF NOT EXISTS asset_candidates (
  id              TEXT PRIMARY KEY NOT NULL,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  script_id       TEXT REFERENCES scripts(id) ON DELETE CASCADE,
  chunk_id        TEXT REFERENCES script_chunks(id) ON DELETE CASCADE,
  episode_id      TEXT REFERENCES episodes(id) ON DELETE SET NULL,
  scene_id        TEXT REFERENCES scenes(id) ON DELETE SET NULL,
  asset_type      TEXT NOT NULL,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL DEFAULT '',
  aliases         TEXT,
  role            TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  evidence_text   TEXT NOT NULL DEFAULT '',
  confidence      INTEGER NOT NULL DEFAULT 50,
  source          TEXT NOT NULL DEFAULT 'ai',
  status          TEXT NOT NULL DEFAULT 'candidate',
  merged_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  metadata        TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_asset_candidates_project_type ON asset_candidates(project_id, asset_type, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_asset_candidates_chunk ON asset_candidates(chunk_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_asset_candidates_name ON asset_candidates(project_id, asset_type, normalized_name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_asset_candidates_merged_asset ON asset_candidates(merged_asset_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS asset_occurrences (
  id              TEXT PRIMARY KEY NOT NULL,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id        TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  script_id       TEXT REFERENCES scripts(id) ON DELETE SET NULL,
  chunk_id        TEXT REFERENCES script_chunks(id) ON DELETE SET NULL,
  episode_id      TEXT REFERENCES episodes(id) ON DELETE SET NULL,
  scene_id        TEXT REFERENCES scenes(id) ON DELETE SET NULL,
  candidate_id    TEXT REFERENCES asset_candidates(id) ON DELETE SET NULL,
  occurrence_type TEXT NOT NULL DEFAULT 'mention',
  evidence_text   TEXT NOT NULL DEFAULT '',
  importance      INTEGER NOT NULL DEFAULT 0,
  metadata        TEXT,
  created_at      INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_asset_occurrences_asset ON asset_occurrences(asset_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_asset_occurrences_project_chunk ON asset_occurrences(project_id, chunk_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_asset_occurrences_episode_scene ON asset_occurrences(episode_id, scene_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_asset_occurrences_candidate ON asset_occurrences(candidate_id);
