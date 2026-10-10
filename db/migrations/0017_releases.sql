CREATE TABLE `release_stage` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`done_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `release`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `release_stage_release_idx` ON `release_stage` (`release_id`);--> statement-breakpoint
CREATE TABLE `release` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`desc` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `release_project_idx` ON `release` (`project_id`);--> statement-breakpoint
-- Von Hand ergänzt: drizzle-kit lässt bei einer neuen Spalte das ON DELETE weg.
ALTER TABLE `milestone` ADD `release_id` text REFERENCES `release`(`id`) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `milestone_release_idx` ON `milestone` (`release_id`);