-- 0046 · CB-105 — Los links REPLACED siguen en el barrido del poller
-- ============================================================================
--
-- Hallazgo de Codex en el PR #1421: los links no expiran (D-51) y no hay API
-- para cancelarlos, así que un link marcado REPLACED sigue siendo cobrable en
-- Págalo — pero el índice parcial del poll solo cubría CREATING/ACTIVE. Un
-- cliente pagando el link del mensaje viejo quedaría cobrado sin que el
-- poller lo observara jamás (ni REVIEW_REQUIRED, ni voucher, ni aviso).
--
-- El poller barre también los REPLACED (a cadencia más lenta) hasta observar
-- su destino final: pagado (→ grupo REVIEW_REQUIRED), cancelado a mano en el
-- panel (→ CANCELLED) o expirado (→ EXPIRED) — esos estados sí salen del
-- índice y dejan de consultarse.

DROP INDEX IF EXISTS "pagalo_payment_links_poll_idx";

CREATE INDEX IF NOT EXISTS "pagalo_payment_links_poll_idx"
	ON "pagalo_payment_links" ("next_poll_at")
	WHERE "status" IN ('CREATING', 'ACTIVE', 'REPLACED');
