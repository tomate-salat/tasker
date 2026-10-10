CREATE TABLE `release_heading` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `release`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `release_heading_release_idx` ON `release_heading` (`release_id`);--> statement-breakpoint
ALTER TABLE `task` ADD `changelog` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `changelog_skip` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `changelog_order` integer DEFAULT 0 NOT NULL;