-- =====================================================================
-- COBROS-02 · Asignación inicial — PASO 3/3: línea base en buckets_historial
-- =====================================================================
-- Siembra el evento INICIAL (1 por crédito) para los créditos que aún no
-- tienen NINGÚN registro en buckets_historial, con el bucket derivado con
-- las mismas reglas del motor (idéntico al PASO 2). Así el historial del
-- sandbox tiene línea base sin necesidad de correr la app, y cuando el
-- motor (procesarMoras) corra después, ya no re-siembra: solo registrará
-- SUBIDAs/BAJADAs reales.
--
-- Campos, espejo de lo que insertaría el motor:
--   · bucket_anterior NULL + tipo_evento INICIAL (el CHECK de coherencia lo exige)
--   · asesor_id NULL: la atribución es para BAJADAs (quién curó la cuenta);
--     el dueño del crédito se ve por creditos.asesor_id / su bitácora.
--   · origen API_MANUAL: lo sembró este script, no el job.
-- Idempotente: el NOT EXISTS (y el unique parcial buckets_historial_uq_inicial)
-- impiden duplicar.
-- =====================================================================

BEGIN;

-- ⇦ Sandbox de pruebas. Cambiar a `cartera` cuando toque el ambiente real.
SET LOCAL search_path TO cartera_cobros2;

INSERT INTO buckets_historial
  (credito_id, bucket_nuevo, tipo_evento, origen,
   cuotas_atrasadas_nuevas, status_credito, motivo)
SELECT
  d.credito_id, d.bucket, 'INICIAL', 'API_MANUAL',
  d.cuotas, d.status,
  'Línea base — carga inicial COBROS-02 (SQL, previo al primer procesarMoras)'
FROM (
  -- misma derivación que 02_asignar_asesores_creditos.sql
  SELECT
    c.credito_id,
    c."statusCredit" AS status,
    COALESCE(m.cuotas_atrasadas, 0) AS cuotas,
    COALESCE(
      (SELECT b.numero FROM buckets b
        WHERE b.activo AND c."statusCredit" = ANY (b.estados_incluidos)
        ORDER BY b.numero LIMIT 1),
      (SELECT b.numero FROM buckets b
        WHERE b.activo
          AND COALESCE(m.cuotas_atrasadas, 0) >= b.cuotas_min
          AND (b.cuotas_max IS NULL OR COALESCE(m.cuotas_atrasadas, 0) <= b.cuotas_max)
        ORDER BY b.numero LIMIT 1)
    ) AS bucket
  FROM creditos c
  LEFT JOIN moras_credito m ON m.credito_id = c.credito_id AND m.activa = true
  WHERE c."statusCredit" NOT IN
    ('CANCELADO', 'PENDIENTE_CANCELACION', 'EN_CONVENIO', 'CAIDO')
) d
WHERE d.bucket IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM buckets_historial h WHERE h.credito_id = d.credito_id
  );

-- Resumen: línea base por bucket
SELECT h.bucket_nuevo, b.prefijo, count(*) AS creditos
FROM buckets_historial h
JOIN buckets b ON b.numero = h.bucket_nuevo
WHERE h.tipo_evento = 'INICIAL'
GROUP BY h.bucket_nuevo, b.prefijo
ORDER BY h.bucket_nuevo;

COMMIT;
