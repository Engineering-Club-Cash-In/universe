-- 0047 · CB-105 — Una sola intención Págalo en vuelo por crédito
-- ============================================================================
--
-- Hallazgo de Codex en el PR #1421: dos /crear concurrentes (retry de la
-- plataforma, mensaje duplicado) podían ver ambos "no hay grupo activo" y
-- emitir DOS juegos de links cobrables para el mismo crédito — doble cobro.
-- La única unicidad del grupo era contacto_cobro_id, que en los grupos del
-- bot es NULL.
--
-- El índice único parcial arbitra la carrera en la DB: solo puede existir UN
-- grupo por crédito fuera de los estados finales (COMPLETED/CANCELLED), sin
-- importar el origen — que es exactamente el invariante del contrato (§4.2:
-- reuso, reemplazo y PAGO_EN_PROCESO presuponen "el grupo activo del
-- crédito", en singular). El servicio hace el reemplazo (cancelar el viejo +
-- crear el nuevo) en UNA transacción; el perdedor de una carrera falla el
-- INSERT, relee y responde los links del ganador.

CREATE UNIQUE INDEX IF NOT EXISTS "pagalo_payment_groups_credit_active_uq"
	ON "pagalo_payment_groups" ("cartera_credito_id")
	WHERE "status" NOT IN ('COMPLETED', 'CANCELLED');
