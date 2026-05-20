-- =============================================================================
-- SANEAMIENTO: cuotas atascadas (mora NO se toca)
-- =============================================================================
-- Contexto:
--   El bug en aplicarPagoAlCredito hacia que cuotas con pagos partidos
--   (donde la suma cubria el monto pero algun *_restante quedaba huerfano)
--   nunca se marcaran como pagadas. Esto causaba:
--     - /realizarPago seguia mostrandolas como pendientes
--     - Creditos con mora seguian apareciendo como MOROSO
--
-- Acciones de este script:
--   1) Marca como pagadas las cuotas cuya suma de monto_aplicado de pagos
--      validated (y paymentFalse=false) cubre creditos.cuota
--      (tolerancia de 1 centavo por redondeos).
--   2) Limpia los *_restante huerfanos en TODOS los pagos de esas cuotas.
--   3) Lista los pagos validated de esas cuotas que aun NO tienen
--      distribucion en pagos_credito_inversionistas, para que se procesen
--      manualmente desde el front ("Procesar Inversionistas").
--
-- NO toca mora: la condonacion se manejara por separado.
-- NO toca statusCredit: si un credito quedo MOROSO por la cuota atascada,
-- el equipo decidira si recalcular mora o condonarla manualmente.
--
-- Idempotencia: el filtro de cuotas a cerrar requiere pagado=false, asi
-- que correr el script dos veces no vuelve a tocar lo ya saneado.
-- =============================================================================

BEGIN;

SET search_path TO cartera, public;

-- ---------------------------------------------------------------------------
-- A.  Materializar las cuotas afectadas en una temp table para reutilizarla
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _cuotas_a_cerrar ON COMMIT DROP AS
SELECT
  c.cuota_id,
  c.credito_id,
  c.numero_cuota,
  cr.numero_credito_sifco,
  cr.cuota AS cuota_esperada,
  COALESCE(
    SUM(p.monto_aplicado) FILTER (
      WHERE p.validation_status = 'validated'
        AND p."paymentFalse" = false
    ),
    0
  ) AS total_aplicado
FROM cartera.cuotas_credito c
JOIN cartera.creditos cr ON cr.credito_id = c.credito_id
LEFT JOIN cartera.pagos_credito p ON p.cuota_id = c.cuota_id
WHERE c.pagado = false
GROUP BY c.cuota_id, c.credito_id, c.numero_cuota, cr.numero_credito_sifco, cr.cuota
HAVING COALESCE(
  SUM(p.monto_aplicado) FILTER (
    WHERE p.validation_status = 'validated'
      AND p."paymentFalse" = false
  ),
  0
) >= (cr.cuota - 0.01);  -- tolerancia de 1 centavo


-- Lista por credito: cuantas cuotas atascadas tiene y si tiene mora activa
-- (la mora se muestra solo como referencia, este script NO la toca).
SELECT
  cr.numero_credito_sifco                                   AS sifco,
  ca.credito_id                                             AS cred_id,
  COUNT(*)                                                  AS num_cuotas_atascadas,
  ARRAY_AGG(ca.numero_cuota ORDER BY ca.numero_cuota)       AS cuotas,
  SUM(ca.cuota_esperada)                                    AS monto_total_cuotas,
  cr."statusCredit"                                         AS status_actual,
  CASE
    WHEN m.mora_id IS NOT NULL AND m.activa
      THEN m.monto_mora::text
    ELSE '-'
  END                                                       AS mora_activa_referencia
FROM _cuotas_a_cerrar ca
JOIN cartera.creditos cr ON cr.credito_id = ca.credito_id
LEFT JOIN cartera.moras_credito m ON m.credito_id = ca.credito_id AND m.activa = true
GROUP BY cr.numero_credito_sifco, ca.credito_id, cr."statusCredit", m.mora_id, m.activa, m.monto_mora
ORDER BY num_cuotas_atascadas DESC, ca.credito_id;

-- ---------------------------------------------------------------------------
-- B.  Preview de lo que se va a tocar (no muta nada)
-- ---------------------------------------------------------------------------
SELECT 'CUOTAS A CERRAR'                          AS seccion, COUNT(*)::text AS cantidad FROM _cuotas_a_cerrar
UNION ALL
SELECT 'CREDITOS A LIMPIAR RESTANTES',                       COUNT(DISTINCT credito_id)::text FROM _cuotas_a_cerrar
UNION ALL
SELECT 'CREDITOS AFECTADOS CON MORA ACTIVA (no se tocan)',
       COUNT(DISTINCT ca.credito_id)::text
  FROM _cuotas_a_cerrar ca
  JOIN cartera.moras_credito m ON m.credito_id = ca.credito_id
 WHERE m.activa = true;

SELECT
  ca.numero_credito_sifco             AS sifco,
  ca.credito_id                       AS cred,
  ca.numero_cuota                     AS cuota,
  ca.cuota_esperada                   AS esperada,
  ca.total_aplicado                   AS aplicado,
  cr."statusCredit"                   AS status
FROM _cuotas_a_cerrar ca
JOIN cartera.creditos cr ON cr.credito_id = ca.credito_id
ORDER BY ca.credito_id, ca.numero_cuota;

-- ---------------------------------------------------------------------------
-- C.  Marcar las cuotas como pagadas
-- ---------------------------------------------------------------------------
UPDATE cartera.cuotas_credito c
   SET pagado = true
  FROM _cuotas_a_cerrar ca
 WHERE c.cuota_id = ca.cuota_id;

-- ---------------------------------------------------------------------------
-- D.  Limpiar *_restante huerfanos en TODOS los pagos de esas cuotas
--     (solo paymentFalse=false; los reversados no se tocan)
-- ---------------------------------------------------------------------------
UPDATE cartera.pagos_credito p
   SET capital_restante = '0',
       interes_restante = '0',
       iva_12_restante  = '0',
       seguro_restante  = '0',
       gps_restante     = '0'
  FROM _cuotas_a_cerrar ca
 WHERE p.cuota_id = ca.cuota_id
   AND p."paymentFalse" = false;

-- ---------------------------------------------------------------------------
-- E.  Verificacion post-fix
-- ---------------------------------------------------------------------------
SELECT 'cuotas marcadas pagado=true' AS check, COUNT(*) AS n
  FROM cartera.cuotas_credito c
  JOIN _cuotas_a_cerrar ca ON ca.cuota_id = c.cuota_id
 WHERE c.pagado = true
UNION ALL
SELECT 'pagos con restantes limpiados',         COUNT(*)
  FROM cartera.pagos_credito p
  JOIN _cuotas_a_cerrar ca ON ca.cuota_id = p.cuota_id
 WHERE p."paymentFalse" = false
   AND p.capital_restante = 0
   AND p.interes_restante = 0
   AND p.iva_12_restante = 0
   AND p.seguro_restante = 0
   AND p.gps_restante = 0;

-- ---------------------------------------------------------------------------
-- F.  Pagos validated SIN distribucion a inversionistas (gap conocido)
--
-- Bajo el codigo viejo, los pagos parciales (los que caian en "tieneRestantes")
-- nunca llamaban a insertPagosCreditoInversionistasV2, asi que los
-- inversionistas no recibieron su parte. Este script NO replica esa logica
-- (es delicada: porcentajes por inversionista, upsert, descuento de
-- monto_aportado). Listamos los pago_id que quedaron pendientes para
-- procesarlos desde el front con el boton "Procesar Inversionistas"
-- o llamando al endpoint /processInvestors por cada uno.
-- ---------------------------------------------------------------------------
SELECT
  cr.numero_credito_sifco                       AS sifco,
  p.credito_id,
  p.cuota_id,
  p.pago_id,
  p.monto_aplicado,
  p.fecha_aplicado::date                        AS fecha_aplicado
FROM cartera.pagos_credito p
JOIN cartera.creditos cr ON cr.credito_id = p.credito_id
WHERE p.cuota_id IN (SELECT cuota_id FROM _cuotas_a_cerrar)
  AND p.validation_status = 'validated'
  AND p."paymentFalse" = false
  AND NOT EXISTS (
    SELECT 1 FROM cartera.pagos_credito_inversionistas pi
    WHERE pi.pago_id = p.pago_id
  )
ORDER BY p.credito_id, p.pago_id;

-- ---------------------------------------------------------------------------
-- Si todo OK: COMMIT;     Si algo mal: ROLLBACK;
-- ---------------------------------------------------------------------------
-- COMMIT;
-- ROLLBACK;
