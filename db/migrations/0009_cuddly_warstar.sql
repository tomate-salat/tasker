CREATE TABLE `image_folder` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`parent_id` text,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `image_folder_project_idx` ON `image_folder` (`project_id`);--> statement-breakpoint
CREATE INDEX `image_folder_parent_idx` ON `image_folder` (`parent_id`);--> statement-breakpoint
ALTER TABLE `image` ADD `folder_id` text;--> statement-breakpoint
CREATE INDEX `image_folder_idx` ON `image` (`folder_id`);