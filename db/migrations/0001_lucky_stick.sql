ALTER TABLE `task` ADD `hidden_by` text;--> statement-breakpoint
CREATE INDEX `task_active_idx` ON `task` (`hidden_by`,`archived_at`);