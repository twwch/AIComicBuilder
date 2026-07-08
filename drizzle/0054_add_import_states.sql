CREATE TABLE IF NOT EXISTS `import_states` (
  `project_id` text PRIMARY KEY NOT NULL,
  `current_step` integer DEFAULT 0 NOT NULL,
  `step_status` text,
  `full_text` text DEFAULT '',
  `review_issues` text,
  `story_analysis` text,
  `characters` text,
  `items` text,
  `environments` text,
  `voices` text,
  `relationships` text,
  `episodes` text,
  `confirmed_episode_indexes` text,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
