ALTER TABLE `task` ADD `ready` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Die smarten Gruppen ziehen vom Backlog in den Reiter „Ready“. Was bisher in einer stand
-- (lose Wurzel mit Markierung), steht danach dort in derselben Gruppe.
UPDATE `task` SET `ready` = 1
WHERE `mark_id` IS NOT NULL AND `parent_id` IS NULL AND `milestone_id` IS NULL
  AND `group_id` IS NULL AND `doc` = 0;
