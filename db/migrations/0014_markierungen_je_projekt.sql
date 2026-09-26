-- Markierungen gehören ab jetzt zu einem Projekt. Die Spalte bleibt in der
-- Datenbank ohne NOT NULL: das ginge nur mit Neuaufbau der Tabelle, und das
-- Löschen der alten Tabelle würde über den Fremdschlüssel `mark_id` an allen
-- Tasks leeren.
ALTER TABLE `mark` ADD `project_id` text REFERENCES `project`(`id`) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `mark_project_idx` ON `mark` (`project_id`);--> statement-breakpoint
-- Jede bisherige Markierung gibt es danach in jedem Projekt: das erste Projekt
-- behält die alte Zeile, die anderen bekommen eine Kopie.
CREATE TABLE `__mark_copy` (`old_id` text NOT NULL, `project_id` text NOT NULL, `new_id` text NOT NULL);--> statement-breakpoint
INSERT INTO `__mark_copy` (`old_id`, `project_id`, `new_id`)
SELECT `m`.`id`, `p`.`id`,
  CASE WHEN `p`.`id` = (SELECT `id` FROM `project` ORDER BY `sort_order`, `id` LIMIT 1)
    THEN `m`.`id`
    ELSE 'k' || lower(hex(randomblob(9)))
  END
FROM `mark` `m`, `project` `p`
WHERE `m`.`project_id` IS NULL;--> statement-breakpoint
INSERT INTO `mark` (`id`, `project_id`, `emoji`, `name`, `sort_order`, `cover_image_id`, `created_at`, `updated_at`, `version`)
SELECT `c`.`new_id`, `c`.`project_id`, `m`.`emoji`, `m`.`name`, `m`.`sort_order`, `m`.`cover_image_id`, `m`.`created_at`, `m`.`updated_at`, 1
FROM `__mark_copy` `c` JOIN `mark` `m` ON `m`.`id` = `c`.`old_id`
WHERE `c`.`new_id` <> `c`.`old_id`;--> statement-breakpoint
UPDATE `mark` SET `project_id` = (SELECT `project_id` FROM `__mark_copy` WHERE `new_id` = `mark`.`id`)
WHERE `project_id` IS NULL;--> statement-breakpoint
-- Ohne ein einziges Projekt gibt es nichts, wozu sie gehören könnten.
DELETE FROM `mark` WHERE `project_id` IS NULL;--> statement-breakpoint
-- Jeder Task zeigt auf die Markierung seines eigenen Projekts.
UPDATE `task` SET `mark_id` = (
  SELECT `c`.`new_id` FROM `__mark_copy` `c`
  WHERE `c`.`old_id` = `task`.`mark_id` AND `c`.`project_id` = `task`.`project_id`
)
WHERE `mark_id` IS NOT NULL;--> statement-breakpoint
-- Das Titelbild bleibt nur, wo das Bild zum Projekt gehört (oder zu keinem).
UPDATE `mark` SET `cover_image_id` = NULL
WHERE `cover_image_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `image` `i`
  WHERE `i`.`id` = `mark`.`cover_image_id` AND (`i`.`project_id` = `mark`.`project_id` OR `i`.`project_id` IS NULL)
);--> statement-breakpoint
DROP TABLE `__mark_copy`;
