-- Nebenquests: eine besondere Gruppe je Projekt (legt der Server beim Start an) und der Stempel,
-- mit welchem Release eine Aufgabe rausgeht. Der Bestand bleibt ungestempelt (Wunsch des Nutzers).
ALTER TABLE `group` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `task` ADD `released_in` text REFERENCES `release`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `release_pending` integer DEFAULT false NOT NULL;
