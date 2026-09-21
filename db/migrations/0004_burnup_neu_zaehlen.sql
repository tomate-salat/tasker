-- Sammel-Aufgaben zählen jetzt selbst mit. Die bisherigen Protokolle sind mit der alten
-- Zählweise geschrieben; ohne sie baut der Server sie aus den Abschlusszeitpunkten neu auf
-- (backfillLog), statt heute einen scheinbaren Umfangssprung zu zeigen.
DELETE FROM `milestone_log`;
