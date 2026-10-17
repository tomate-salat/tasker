-- Der Reiter „Ready“ entfällt; „fertig geplant“ ist jetzt der Status „Bereit“ (Wunsch des Nutzers).
-- Was bisher ready war, steht danach in „Unsortiert“ – auf Bereit, wenn es offen war.
UPDATE `task` SET `status` = 'ready' WHERE `ready` = 1 AND `status` = 'open';--> statement-breakpoint
-- Offene Aufgaben in aktiven Milestones gelten als geplant – jede Ebene, damit der Tisch
-- nach dem Umbau so aussieht wie vorher.
UPDATE `task` SET `status` = 'ready'
WHERE `status` = 'open' AND `archived_at` IS NULL AND `id` IN (
  WITH RECURSIVE tree(id) AS (
    SELECT t.`id` FROM `task` t JOIN `milestone` m ON m.`id` = t.`milestone_id`
    WHERE t.`parent_id` IS NULL AND m.`archived_at` IS NULL
    UNION ALL
    SELECT c.`id` FROM `task` c JOIN tree ON c.`parent_id` = tree.id
  )
  SELECT id FROM tree
);--> statement-breakpoint
ALTER TABLE `task` DROP COLUMN `ready`;
