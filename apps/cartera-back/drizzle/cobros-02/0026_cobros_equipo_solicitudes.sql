-- COBROS-02 · Mi equipo y Solicitudes del supervisor, backend (issue #1895,
-- tareas M1 a M7), docs/features/cobros-02/24-plan-backend-equipo-solicitudes.md.
--
-- Se aplica a mano. Idempotente: se puede correr más de una vez. Solo en la BD
-- local o en DEV, nunca en PROD (COBROS-02 no va a PROD hasta el pase masivo).

-- ── M3 · historial global de decisiones de convenio ───────────────────────────
-- GET /payment-agreements/decisiones/historial ordena y filtra por fecha de
-- decisión y por quien decidió; hasta hoy solo había índices por crédito y por
-- convenio.
CREATE INDEX IF NOT EXISTS idx_convenio_decisiones_decidido_en
  ON cartera.convenio_decisiones (decidido_en DESC, decision_id DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_convenio_decisiones_decidido_por
  ON cartera.convenio_decisiones (lower(decidido_por_email), decidido_en DESC);
