-- Das Burnup-Protokoll führt statt eines Kalendertags den Zeitpunkt in UTC;
-- vorhandene Tage werden zur Tagesmitte, damit sie in jeder Zeitzone auf ihrem Tag bleiben.
ALTER TABLE `milestone_log` RENAME COLUMN `day` TO `at`;--> statement-breakpoint
UPDATE `milestone_log` SET `at` = `at` || 'T12:00:00.000Z' WHERE length(`at`) = 10;
