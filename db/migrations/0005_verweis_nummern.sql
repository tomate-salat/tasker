CREATE TABLE `ref_seq` (
	`id` integer PRIMARY KEY NOT NULL,
	`next` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `milestone` ADD `ref` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `milestone_ref_idx` ON `milestone` (`ref`);--> statement-breakpoint
ALTER TABLE `task` ADD `ref` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `task_ref_idx` ON `task` (`ref`);--> statement-breakpoint
-- Verweis-Nummern ($142): alles Bestehende bekommt eine, in der Reihenfolge des Anlegens,
-- Aufgaben und Milestones in einer gemeinsamen Folge.
WITH `numbered` AS (
	SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at`, `id`) AS `n`
	FROM (SELECT `id`, `created_at` FROM `task` UNION ALL SELECT `id`, `created_at` FROM `milestone`)
)
UPDATE `task` SET `ref` = (SELECT `n` FROM `numbered` WHERE `numbered`.`id` = `task`.`id`);--> statement-breakpoint
WITH `numbered` AS (
	SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at`, `id`) AS `n`
	FROM (SELECT `id`, `created_at` FROM `task` UNION ALL SELECT `id`, `created_at` FROM `milestone`)
)
UPDATE `milestone` SET `ref` = (SELECT `n` FROM `numbered` WHERE `numbered`.`id` = `milestone`.`id`);--> statement-breakpoint
INSERT INTO `ref_seq` (`id`, `next`) VALUES (1, (SELECT count(*) FROM `task`) + (SELECT count(*) FROM `milestone`) + 1);--> statement-breakpoint
-- Neue Zeilen ohne Nummer bekommen die nächste. Das gilt für jedes Einfügen – Anlegen,
-- Duplizieren, Import und Einträge aus dem Papierkorb, die noch keine Nummer hatten.
CREATE TRIGGER `task_ref` AFTER INSERT ON `task` WHEN NEW.`ref` IS NULL
BEGIN
	UPDATE `task` SET `ref` = (SELECT `next` FROM `ref_seq` WHERE `id` = 1) WHERE `id` = NEW.`id`;
	UPDATE `ref_seq` SET `next` = `next` + 1 WHERE `id` = 1;
END;--> statement-breakpoint
CREATE TRIGGER `milestone_ref` AFTER INSERT ON `milestone` WHEN NEW.`ref` IS NULL
BEGIN
	UPDATE `milestone` SET `ref` = (SELECT `next` FROM `ref_seq` WHERE `id` = 1) WHERE `id` = NEW.`id`;
	UPDATE `ref_seq` SET `next` = `next` + 1 WHERE `id` = 1;
END;
