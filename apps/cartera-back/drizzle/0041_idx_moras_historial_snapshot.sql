-- NOTA: aplicar a mano en dev y prod (Cartera aplica el SQL a mano, no drizzle-kit).
--
-- El snapshot de mora "as-of" una fecha (controllers/moraSnapshotSql.ts, que
-- alimenta Mora Histórica, el reporte por etapa/asesor y el de recuperación)
-- reconstruye por crédito el último evento de cartera.moras_historial. Hasta
-- ahora lo hacía con dos window functions sobre un filtro que envolvía la
-- columna `fecha` en AT TIME ZONE: no había índice utilizable, así que cada
-- llamada hacía Seq Scan + Sort del historial COMPLETO (2,3 MB de sort con
-- 21.892 filas, contra un work_mem de 4 MB).
--
-- Con la mora proporcional el cron escribe un RECALCULO por crédito por noche:
-- el historial pasa de ~313 filas/día a ~1.500, así que ese sort cruzaba
-- work_mem en un par de semanas y se iba a disco de golpe. Es un escalón, no
-- una degradación gradual.
--
-- La consulta pasó a `DISTINCT ON (credito_id) … ORDER BY credito_id,
-- fecha DESC, historial_id DESC` contra la columna cruda, que con estos dos
-- índices resuelve con Index Only Scan + Unique: cero sorts, cero heap fetches.
--
-- INCLUDE y no columnas de clave: las columnas incluidas no participan del
-- orden, solo evitan ir al heap. Sin ellas el plan sigue sin sort pero hace una
-- lectura aleatoria del heap por fila (medido: 23.521 buffers contra 164).
--
-- El segundo índice es PARCIAL (cuotas_atrasadas_nuevas > 0) porque sostiene el
-- carry-forward de las cuotas: los eventos "payment-only" registran cuotas=0 y
-- el snapshot tiene que saltárselos para no mandar a "Al día" un crédito que
-- sigue en mora. Con el índice completo el planner prefería Seq Scan + Sort.
--
-- ⚠️ EN PRODUCCIÓN: moras_historial es una tabla VIVA (el cron le escribe cada
-- noche). Un CREATE INDEX normal toma ShareLock y BLOQUEA las escrituras
-- mientras construye. Lo correcto en prod es correr las dos sentencias con
-- CONCURRENTLY y UNA POR CONEXIÓN:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_moras_historial_snapshot …
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_moras_historial_snapshot_cuotas …
--
-- No van así en este archivo por la misma razón que en
-- 0035_idx_pagos_espejo_credito_no_liquidado y 0034_add_origen_historico_monto
-- _aportado: el archivo se ejecuta como statement múltiple, Postgres lo envuelve
-- en una transacción implícita y ahí CONCURRENTLY aborta con "cannot run inside
-- a transaction block", haciendo rollback de toda la migración. El repo no tiene
-- hoy manera de expresar una migración no transaccional.

CREATE INDEX IF NOT EXISTS ix_moras_historial_snapshot
  ON cartera.moras_historial (credito_id, fecha DESC, historial_id DESC)
  INCLUDE (tipo_evento, monto_nuevo, cuotas_atrasadas_nuevas);

CREATE INDEX IF NOT EXISTS ix_moras_historial_snapshot_cuotas
  ON cartera.moras_historial (credito_id, fecha DESC, historial_id DESC)
  INCLUDE (cuotas_atrasadas_nuevas)
  WHERE cuotas_atrasadas_nuevas > 0;
