CREATE TABLE `api_token` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`name` text NOT NULL,
	`hint` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_token_hash_unique` ON `api_token` (`hash`);