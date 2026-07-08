ALTER TABLE scripts ADD COLUMN structured_json TEXT;
--> statement-breakpoint
ALTER TABLE import_states ADD COLUMN intake_job_id TEXT;
--> statement-breakpoint
ALTER TABLE import_states ADD COLUMN confirmed_script_version_id TEXT;
--> statement-breakpoint
ALTER TABLE import_states ADD COLUMN asset_library_version_id TEXT;
