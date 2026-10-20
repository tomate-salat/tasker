-- Was über den Eingang angelegt wurde, darf ein Zugangs-Token wieder löschen (Rückgängig im Godot-Addon).
CREATE TABLE `intake_task` (
	`task_id` text PRIMARY KEY NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
