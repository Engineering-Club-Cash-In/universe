-- 🔴 ORDEN DE DESPLIEGUE — 0043 y 0044 van a producción ANTES que el código.
-- El código de este cambio escribe `moras_historial.pago_id` y lee/escribe
-- `mora_pagada_cuota` en cada pago que cobra mora, en cada condonación y en el
-- cron. Si el código sale primero, TODO eso falla ("column pago_id does not
-- exist" / "relation mora_pagada_cuota does not exist") hasta que corran las
-- migraciones. Aplicarlas a mano, verificar, y recién después desplegar.
--
-- Agregar columna pago_id a moras_historial para ligar eventos de mora a pagos
--
-- ── CONTEXTO ────────────────────────────────────────────────────────────────
-- Hasta hoy, la única forma de saber qué pago causó un movimiento de mora es
-- una búsqueda de texto: se busca una etiqueta pegada al final del campo
-- `motivo` — " [pago #164405]" — con `LIKE`. Esa estrategia es frágil:
--   • Si el estampado de la etiqueta falla nadie se entera (es post-hoc).
--   • La búsqueda de texto es lenta en una tabla grande.
--   • Un cambio de formato de la etiqueta quiebra todo lo que la dependa.
--
-- ── SOLUCIÓN ────────────────────────────────────────────────────────────────
-- Se agrega una columna `pago_id` ANULABLE con el id del pago que originó el
-- evento. Será escrita SOLO cuando un evento de mora nace de un pago; otros
-- movimientos (el recálculo automático del cron, una condonación, un ajuste
-- manual) llevan `pago_id` en NULL.
--
-- SIN clave foránea, a propósito: la reversa BORRA la fila de `pagos_credito`.
-- Con FK, ese DELETE fallaría (o con CASCADE se llevaría la bitácora, que es
-- justo lo que tiene que sobrevivir para auditar la reversa).
--
-- El índice parcial `WHERE pago_id IS NOT NULL` indexa solo la minoría de
-- eventos que sí vienen de un pago.
--
-- ── PRODUCCIÓN ──────────────────────────────────────────────────────────────
-- El ADD COLUMN es solo metadatos (anulable, sin default): no reescribe la tabla.
-- El índice NO: las migraciones corren dentro de una transacción, donde
-- CONCURRENTLY no está permitido, y un CREATE INDEX normal bloquea las
-- escrituras de `moras_historial` mientras dura. En producción, ANTES del pase,
-- crearlo a mano en su propia conexión:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS moras_historial_idx_pago
--     ON cartera.moras_historial (pago_id) WHERE pago_id IS NOT NULL;
--
-- Así el `IF NOT EXISTS` de abajo queda en no-op cuando corre la migración.

ALTER TABLE cartera.moras_historial
  ADD COLUMN IF NOT EXISTS pago_id integer;  -- SIN FK: la bitácora sobrevive al pago revertido

CREATE INDEX IF NOT EXISTS moras_historial_idx_pago
  ON cartera.moras_historial (pago_id) WHERE pago_id IS NOT NULL;
