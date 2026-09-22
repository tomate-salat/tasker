-- Sammel-Aufgaben zählen wieder nicht selbst mit, nur ihre Unteraufgaben (wie im Prototyp).
-- Die Protokolle seit 0004 sind mit der anderen Zählweise geschrieben; ohne sie baut der
-- Server sie aus den Abschlusszeitpunkten neu auf (backfillLog).
DELETE FROM `milestone_log`;
