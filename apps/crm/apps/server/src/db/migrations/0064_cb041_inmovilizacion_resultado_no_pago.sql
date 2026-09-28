-- CB-041 (review de Codex, PR #1758) — registrarResultadoLlamada marcaba
-- resultado = 'enviada_recuperacion' con solo la respuesta "no pagó" del
-- asesor, sin que el endpoint dispare (ni tenga forma de saber si el
-- asesor después dispara) enviarCreditoARecuperacion (routers/cobros.ts).
-- Si esa acción nunca se ejecuta o falla, el historial mentía diciendo que
-- el crédito sí se mandó a recuperación.
--
-- Nuevo valor separado: 'no_pago_pendiente_recuperacion' es lo único que
-- el endpoint sabe con certeza (la respuesta de la llamada). El valor
-- existente 'enviada_recuperacion' queda para cuando esa acción se
-- confirme — hoy nada la setea automáticamente, así que un
-- 'enviada_recuperacion' en la tabla vuelve a significar lo que su nombre
-- dice.

ALTER TYPE "inmovilizacion_resultado" ADD VALUE IF NOT EXISTS 'no_pago_pendiente_recuperacion';
