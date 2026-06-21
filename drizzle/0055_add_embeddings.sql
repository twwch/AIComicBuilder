CREATE TABLE `embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`content_id` text NOT NULL,
	`model` text NOT NULL,
	`vector` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
