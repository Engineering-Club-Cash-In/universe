-- COBROS-02 · Workspace de cobros, backend (issue #1873, W3 · escalar a Jurídico),
-- docs/features/cobros-02/22-plan-backend-workspace.md.
--
-- · Estado `EN_JURIDICO` como PISO de B5 (mismo mecanismo que `EN_RECUPERACION`
--   para B4, migraciones 0019–0021): el crédito no baja de B5 mientras esté en
--   Jurídico, y sigue subiendo si la mora lo pide. Se agrega al piso de B5, sin
--   duplicar si ya está.
-- · `juridico_levantada_pago_id`: qué pago levantó Jurídico, para devolver el
--   estado si ese pago se reversa (igual que `recuperacion_levantada_pago_id`).
--
-- · `buckets_historial.referencia_externa`: llave de idempotencia del escalamiento
--   (el id de la solicitud del CRM). Un reintento con la misma referencia no
--   vuelve a escalar y el CRM puede preguntar si ya se aplicó, aunque el estado
--   del crédito haya cambiado desde entonces (p. ej. un pago lo sacó de Jurídico).
--
-- Se aplica a mano. Idempotente: se puede correr más de una vez.

ALTER TABLE cartera.creditos
  ADD COLUMN IF NOT EXISTS juridico_levantada_pago_id integer;
--> statement-breakpoint

UPDATE cartera.buckets
   SET estados_piso = array_append(estados_piso, 'EN_JURIDICO'), updated_at = now()
 WHERE numero = 5
   AND NOT ('EN_JURIDICO' = ANY(estados_piso));
--> statement-breakpoint

ALTER TABLE cartera.buckets_historial
  ADD COLUMN IF NOT EXISTS referencia_externa text;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS buckets_historial_referencia_externa_uq
  ON cartera.buckets_historial (referencia_externa)
  WHERE referencia_externa IS NOT NULL;
