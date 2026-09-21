PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_drawing` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`milestone_id` text,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`shapes` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestone`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "drawing_owner" CHECK((task_id IS NULL) <> (milestone_id IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_drawing`("id", "task_id", "milestone_id", "name", "sort_order", "shapes", "created_at", "updated_at", "version") SELECT "id", "task_id", NULL, "name", "sort_order", "shapes", "created_at", "updated_at", "version" FROM `drawing`;--> statement-breakpoint
DROP TABLE `drawing`;--> statement-breakpoint
ALTER TABLE `__new_drawing` RENAME TO `drawing`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `drawing_task_idx` ON `drawing` (`task_id`);--> statement-breakpoint
CREATE INDEX `drawing_milestone_idx` ON `drawing` (`milestone_id`);