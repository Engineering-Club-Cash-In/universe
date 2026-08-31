-- 0050 · CB-028 — Poller Págalo: contador dedicado antes de finalizar un link cancelado/expirado
-- ============================================================================
--
-- Hallazgo de Codex en el PR #1502: al confirmar que un link cancelado/
-- expirado (status "3"/"4") no tiene transacción real detrás (la consulta de
-- transacción devuelve 400), el poller no debía finalizarlo en el primer
-- intento — un 400 puede ser una inconsistencia pasajera del proveedor
-- mientras una transacción ACCEPT real todavía no es visible, y finalizar de
-- una perdería ese pago para siempre (nextPollAt se limpia).
--
-- El primer fix reutilizó `poll_attempts`, pero ese contador se incrementa
-- por CUALQUIER causa de fallo del poll (incluidos varios ciclos previos con
-- status "1" sin pagar) — un link que arrastraba fallos no relacionados se
-- finalizaba en el primer 400 apenas Págalo reportaba "3"/"4", mismo bug
-- otra vez. Esta columna cuenta solo confirmaciones CONSECUTIVAS del patrón
-- exacto "status 3/4 + transacción no encontrada" y se resetea a 0 apenas
-- ese patrón deja de repetirse — recién al llegar al umbral se confía en que
-- ya no es una inconsistencia pasajera y se finaliza el link.
-- ============================================================================

ALTER TABLE "pagalo_payment_links"
  ADD COLUMN IF NOT EXISTS "terminal_not_found_attempts" integer NOT NULL DEFAULT 0;

ALTER TABLE "pagalo_payment_links"
  DROP CONSTRAINT IF EXISTS "pagalo_payment_links_terminal_not_found_attempts_chk";
ALTER TABLE "pagalo_payment_links"
  ADD CONSTRAINT "pagalo_payment_links_terminal_not_found_attempts_chk"
  CHECK ("terminal_not_found_attempts" >= 0);
