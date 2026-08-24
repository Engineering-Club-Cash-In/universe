-- Hallazgo de Codex en el PR #1411 (3ª ronda): borrar una fila de co_debtors
-- pone co_debtor_id en NULL (SET NULL), y la ficha deducía el operador de ese
-- FK — un codeudor borrado pasaba a mostrarse como "titular", cambiando la
-- identidad histórica en vez de solo perder el nombre.
--
-- operado_por graba quién operó EN EL MOMENTO de la interacción y no depende
-- de que la fila del codeudor siga viva.

ALTER TABLE "bot_cobros_interacciones"
	ADD COLUMN IF NOT EXISTS "operado_por" text;

-- Backfill: lo escrito hasta hoy tiene sus FKs intactos, así que la deducción
-- todavía es correcta — es justamente lo que deja de serlo tras un borrado.
UPDATE "bot_cobros_interacciones"
	SET "operado_por" = CASE WHEN "co_debtor_id" IS NOT NULL THEN 'codeudor' ELSE 'titular' END
	WHERE "operado_por" IS NULL;
