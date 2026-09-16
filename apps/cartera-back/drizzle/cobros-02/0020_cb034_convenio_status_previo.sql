-- COBROS-02 · Fase 4 — la precedencia del convenio sobre `EN_RECUPERACION`.
--
-- Decisión 4 del plan 08: **el convenio manda sobre el estado**. Un convenio
-- creado desde B4 se queda en B4, y ningún pago del convenio levanta la
-- recuperación — solo la levanta pagar el total SIN convenio (decisión 5).
--
-- El problema es que `statusCredit` es UNA columna. Al firmar el convenio el
-- crédito pasa a `EN_CONVENIO` y el `EN_RECUPERACION` que traía desaparece; al
-- terminar el convenio el código lo dejaba `ACTIVO`, o sea que completar un
-- convenio LEVANTABA la recuperación por la puerta de atrás — exactamente lo
-- que la decisión 4 prohíbe.
--
-- Esta columna guarda el estado con el que el crédito ENTRÓ al convenio, para
-- poder devolvérselo cuando el convenio termina, se deshace o se rechaza. No es
-- una bitácora (esa es `convenio_decisiones`): es el dato operativo que hace
-- falta para restaurar.
ALTER TABLE cartera.convenios_pago
  ADD COLUMN IF NOT EXISTS status_credito_previo text;
--> statement-breakpoint

COMMENT ON COLUMN cartera.convenios_pago.status_credito_previo IS
  'COBROS-02 Fase 4: statusCredit del credito ANTES de entrar al convenio. Se le devuelve al completar/deshacer/rechazar, para que un convenio no pueda levantar EN_RECUPERACION (decision 4 del plan 08). NULL en los convenios anteriores a esta migracion.';
