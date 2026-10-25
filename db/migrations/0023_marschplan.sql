-- Marschplan: Milestones merken sich, wann sie fertig wurden und wie ihr Enddatum
-- verschoben wurde, solange sie liefen; ein Release, wann es bei Beginn bereit sein sollte.
ALTER TABLE `milestone` ADD `end_changes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `milestone` ADD `done_at` text;--> statement-breakpoint
ALTER TABLE `release` ADD `ready_planned` text;--> statement-breakpoint
-- Für schon Erledigtes ist die letzte Änderung die beste Schätzung.
UPDATE `milestone` SET `done_at` = `updated_at` WHERE `status` = 'done';
