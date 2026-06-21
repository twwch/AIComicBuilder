CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  app_id TEXT NOT NULL,
  api_key TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agents_user_category ON agents(user_id, category);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_bindings (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  UNIQUE(project_id, category)
);
