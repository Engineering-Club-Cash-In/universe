-- Hallazgo de Codex en el PR #1411 (2ª ronda): getActividadBot ahora filtra
-- también por numero_sifco (el rescate del codeudor multi-lead), y en un OR
-- basta una rama sin índice para que Postgres tenga que barrer la tabla
-- entera — que registra cada request del bot y no tiene retención.

CREATE INDEX IF NOT EXISTS "bot_cobros_interacciones_sifco_idx"
	ON "bot_cobros_interacciones" ("numero_sifco");
