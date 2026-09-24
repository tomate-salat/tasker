-- Bilder, deren Ordner gelöscht wurde, zeigten noch auf ihn und waren nach dem
-- Wiederherstellen unsichtbar. Sie rücken ganz nach oben.
UPDATE `image` SET `folder_id` = NULL
WHERE `folder_id` IS NOT NULL AND `folder_id` NOT IN (SELECT `id` FROM `image_folder`);
