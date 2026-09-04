-- Normaliza el formato con el que quedaron guardados los DPI.
--
-- Los DPI que entran hoy se limpian antes de guardarse, pero los que vienen de
-- migraciones y cargas viejas quedaron con espacios ("3460 66638 0101"). Como
-- las búsquedas de duplicados comparaban texto contra texto, el mismo DPI
-- escrito de las dos formas no se reconocía como la misma persona y se creaban
-- leads repetidos (además de romper el join contra renapinfo, que sí está
-- limpia).
--
-- Sin índice único todavía: al momento de escribir esto hay 154 grupos de DPI
-- repetido en leads que hay que depurar a mano antes de poder imponerlo.
UPDATE "leads"
SET "dpi" = regexp_replace("dpi", '\s', '', 'g')
WHERE "dpi" IS NOT NULL
  AND "dpi" <> regexp_replace("dpi", '\s', '', 'g');

UPDATE "co_debtors"
SET "dpi" = regexp_replace("dpi", '\s', '', 'g')
WHERE "dpi" IS NOT NULL
  AND "dpi" <> regexp_replace("dpi", '\s', '', 'g');
