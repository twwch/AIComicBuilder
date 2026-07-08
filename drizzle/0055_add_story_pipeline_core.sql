CREATE TABLE IF NOT EXISTS scripts (
  id              TEXT PRIMARY KEY NOT NULL,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  episode_id      TEXT REFERENCES episodes(id) ON DELETE SET NULL,
  title           TEXT NOT NULL DEFAULT '',
  source_filename TEXT DEFAULT '',
  source_type     TEXT DEFAULT '',
  language        TEXT DEFAULT '',
  content_hash    TEXT DEFAULT '',
  raw_text        TEXT NOT NULL DEFAULT '',
  cleaned_text    TEXT DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'uploaded',
  metadata        TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_scripts_project ON scripts(project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_scripts_episode ON scripts(episode_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS script_chunks (
  id              TEXT PRIMARY KEY NOT NULL,
  script_id       TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  episode_id      TEXT REFERENCES episodes(id) ON DELETE SET NULL,
  scene_id        TEXT REFERENCES scenes(id) ON DELETE SET NULL,
  chunk_index     INTEGER NOT NULL,
  episode_index   INTEGER DEFAULT 0,
  scene_index     INTEGER DEFAULT 0,
  text            TEXT NOT NULL,
  start_index     INTEGER NOT NULL DEFAULT 0,
  end_index       INTEGER NOT NULL DEFAULT 0,
  overlap_before  INTEGER NOT NULL DEFAULT 0,
  overlap_after   INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',
  metadata        TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_script_chunks_script_index ON script_chunks(script_id, chunk_index);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_script_chunks_project_episode_scene ON script_chunks(project_id, episode_id, scene_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS compliance_reports (
  id                 TEXT PRIMARY KEY NOT NULL,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  script_id          TEXT REFERENCES scripts(id) ON DELETE CASCADE,
  chunk_id           TEXT REFERENCES script_chunks(id) ON DELETE SET NULL,
  risk_level         TEXT NOT NULL DEFAULT 'low',
  risk_type          TEXT NOT NULL DEFAULT '',
  source_text        TEXT NOT NULL DEFAULT '',
  reason             TEXT NOT NULL DEFAULT '',
  suggestion         TEXT NOT NULL DEFAULT '',
  need_human_review  INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'open',
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_compliance_reports_project ON compliance_reports(project_id, risk_level);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_compliance_reports_chunk ON compliance_reports(chunk_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assets (
  id                        TEXT PRIMARY KEY NOT NULL,
  project_id                TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type                      TEXT NOT NULL,
  name                      TEXT NOT NULL,
  aliases                   TEXT NOT NULL DEFAULT '[]',
  importance                INTEGER NOT NULL DEFAULT 0,
  description               TEXT NOT NULL DEFAULT '',
  visual_constraints        TEXT NOT NULL DEFAULT '',
  negative_constraints      TEXT NOT NULL DEFAULT '',
  first_appearance          TEXT NOT NULL DEFAULT '',
  first_appearance_chunk_id TEXT REFERENCES script_chunks(id) ON DELETE SET NULL,
  confirmed                 INTEGER NOT NULL DEFAULT 0,
  reference_image           TEXT,
  version                   INTEGER NOT NULL DEFAULT 1,
  metadata                  TEXT,
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assets_project_type ON assets(project_id, type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(project_id, name);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS character_assets (
  asset_id           TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  character_id       TEXT REFERENCES characters(id) ON DELETE SET NULL,
  role_name          TEXT DEFAULT '',
  age                TEXT DEFAULT '',
  gender             TEXT DEFAULT '',
  personality        TEXT DEFAULT '',
  costume            TEXT DEFAULT '',
  voice              TEXT DEFAULT '',
  relationship_notes TEXT DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_character_assets_character ON character_assets(character_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS scene_assets (
  asset_id      TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  scene_id      TEXT REFERENCES scenes(id) ON DELETE SET NULL,
  location_type TEXT DEFAULT '',
  time_of_day   TEXT DEFAULT '',
  lighting      TEXT DEFAULT '',
  weather       TEXT DEFAULT '',
  layout        TEXT DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_scene_assets_scene ON scene_assets(scene_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS prop_assets (
  asset_id           TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  prop_category      TEXT DEFAULT '',
  owner_character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
  scene_id           TEXT REFERENCES scenes(id) ON DELETE SET NULL,
  state              TEXT DEFAULT '',
  usage_rules        TEXT DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prop_assets_scene ON prop_assets(scene_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prop_assets_owner ON prop_assets(owner_character_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS production_bibles (
  id                       TEXT PRIMARY KEY NOT NULL,
  project_id               TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  episode_id               TEXT REFERENCES episodes(id) ON DELETE SET NULL,
  source_script_id         TEXT REFERENCES scripts(id) ON DELETE SET NULL,
  version                  INTEGER NOT NULL DEFAULT 1,
  title                    TEXT NOT NULL DEFAULT '',
  world_setting            TEXT NOT NULL DEFAULT '',
  visual_style             TEXT NOT NULL DEFAULT '',
  era_constraints          TEXT NOT NULL DEFAULT '',
  location_rules           TEXT NOT NULL DEFAULT '',
  character_rules          TEXT NOT NULL DEFAULT '',
  scene_rules              TEXT NOT NULL DEFAULT '',
  prop_rules               TEXT NOT NULL DEFAULT '',
  positive_prompt_template TEXT NOT NULL DEFAULT '',
  negative_prompt_template TEXT NOT NULL DEFAULT '',
  compliance_rules         TEXT NOT NULL DEFAULT '',
  status                   TEXT NOT NULL DEFAULT 'draft',
  is_active                INTEGER NOT NULL DEFAULT 0,
  metadata                 TEXT,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_production_bibles_project ON production_bibles(project_id, is_active);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_production_bibles_episode ON production_bibles(episode_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS shot_specs (
  id               TEXT PRIMARY KEY NOT NULL,
  shot_id          TEXT REFERENCES shots(id) ON DELETE SET NULL,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  episode_id       TEXT REFERENCES episodes(id) ON DELETE CASCADE,
  scene_id         TEXT REFERENCES scenes(id) ON DELETE SET NULL,
  script_chunk_id  TEXT REFERENCES script_chunks(id) ON DELETE SET NULL,
  sequence         INTEGER NOT NULL DEFAULT 0,
  duration         INTEGER NOT NULL DEFAULT 10,
  characters       TEXT NOT NULL DEFAULT '[]',
  scene_asset_id   TEXT REFERENCES assets(id) ON DELETE SET NULL,
  prop_asset_ids   TEXT NOT NULL DEFAULT '[]',
  shot_type        TEXT NOT NULL DEFAULT '',
  camera_angle     TEXT NOT NULL DEFAULT '',
  camera_movement  TEXT NOT NULL DEFAULT '',
  action           TEXT NOT NULL DEFAULT '',
  emotion          TEXT NOT NULL DEFAULT '',
  dialogue         TEXT NOT NULL DEFAULT '',
  voiceover        TEXT NOT NULL DEFAULT '',
  continuity_in    TEXT NOT NULL DEFAULT '',
  continuity_out   TEXT NOT NULL DEFAULT '',
  positive_prompt  TEXT NOT NULL DEFAULT '',
  negative_prompt  TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'draft',
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_shot_specs_project_episode_scene ON shot_specs(project_id, episode_id, scene_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_shot_specs_shot ON shot_specs(shot_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_shot_specs_chunk ON shot_specs(script_chunk_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storyboard_frames (
  id              TEXT PRIMARY KEY NOT NULL,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  episode_id      TEXT REFERENCES episodes(id) ON DELETE CASCADE,
  scene_id        TEXT REFERENCES scenes(id) ON DELETE SET NULL,
  shot_id         TEXT REFERENCES shots(id) ON DELETE CASCADE,
  shot_spec_id    TEXT REFERENCES shot_specs(id) ON DELETE SET NULL,
  frame_index     INTEGER NOT NULL DEFAULT 0,
  image_url       TEXT,
  prompt          TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending',
  model_provider  TEXT,
  model_id        TEXT,
  metadata        TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storyboard_frames_project ON storyboard_frames(project_id, episode_id, scene_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storyboard_frames_shot ON storyboard_frames(shot_id, frame_index);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storyboard_frames_spec ON storyboard_frames(shot_spec_id);
