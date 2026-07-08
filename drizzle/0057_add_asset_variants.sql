CREATE TABLE IF NOT EXISTS asset_variants (
  id                   TEXT PRIMARY KEY NOT NULL,
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id             TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  source_candidate_id  TEXT REFERENCES asset_candidates(id) ON DELETE SET NULL,
  source_occurrence_id TEXT REFERENCES asset_occurrences(id) ON DELETE SET NULL,
  variant_type         TEXT NOT NULL DEFAULT 'default',
  name                 TEXT NOT NULL,
  state                TEXT NOT NULL DEFAULT '',
  locked_traits        TEXT,
  changed_traits       TEXT,
  visual_constraints   TEXT NOT NULL DEFAULT '',
  negative_constraints TEXT NOT NULL DEFAULT '',
  reference_image      TEXT,
  status               TEXT NOT NULL DEFAULT 'draft',
  metadata             TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_asset_variants_asset ON asset_variants(asset_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_asset_variants_project ON asset_variants(project_id, asset_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_variants_asset_name ON asset_variants(asset_id, name);
