-- =============================================================================
-- SANEAMIENTO: cuotas atascadas + condonacion de mora
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
--      validated (y paymentFalse=false) cubre creditos.cuota.
--   2) Limpia los *_restante huerfanos en TODOS los pagos de esas cuotas.
--   3) Condona la mora de los creditos afectados que tienen mora activa:
--        a. Inserta registro en moras_condonaciones (con el monto original)
--        b. Cierra la mora (activa=false, monto_mora=0)
--        c. Pone statusCredit='ACTIVO' SOLO si era MOROSO
--           (no toca EN_CONVENIO, CANCELADO, INCOBRABLE)
--
-- Usuario registrado en la condonacion: id=12 (daniel.r@clubcashin.com)
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

-- ---------------------------------------------------------------------------
-- B.  Preview de lo que se va a tocar (no muta nada)
-- ---------------------------------------------------------------------------
SELECT 'CUOTAS A CERRAR'              AS seccion, COUNT(*)::text AS cantidad FROM _cuotas_a_cerrar
UNION ALL
SELECT 'CREDITOS A LIMPIAR RESTANTES',           COUNT(DISTINCT credito_id)::text FROM _cuotas_a_cerrar
UNION ALL
SELECT 'MORAS ACTIVAS A CONDONAR',
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
  cr."statusCredit"                   AS status,
  CASE
    WHEN m.mora_id IS NOT NULL AND m.activa
      THEN m.monto_mora::text
    ELSE '-'
  END                                 AS mora_a_condonar
FROM _cuotas_a_cerrar ca
JOIN cartera.creditos cr ON cr.credito_id = ca.credito_id
LEFT JOIN cartera.moras_credito m ON m.credito_id = ca.credito_id
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
-- E.  Condonar mora donde aplica
-- ---------------------------------------------------------------------------
-- E.1  Snapshot de las moras activas a condonar (con su monto ORIGINAL,
--      antes de ponerlo a 0). Sirve de fuente para el INSERT y el UPDATE.
CREATE TEMP TABLE _moras_a_condonar ON COMMIT DROP AS
SELECT
  m.mora_id,
  m.credito_id,
  m.monto_mora
FROM cartera.moras_credito m
WHERE m.activa = true
  AND m.credito_id IN (SELECT DISTINCT credito_id FROM _cuotas_a_cerrar);

-- E.2  Insertar el registro de condonacion ANTES de cerrar la mora
--      (para que monto_condonacion lleve el monto original)
INSERT INTO cartera.moras_condonaciones (
  credito_id,
  mora_id,
  motivo,
  usuario_id,
  monto_condonacion
)
SELECT
  mc.credito_id,
  mc.mora_id,
  'Saneamiento automatico: cuota cerrada por bug de pagos partidos (suma de pagos cubria la cuota pero algun *_restante quedo huerfano)',
  12,  -- daniel.r@clubcashin.com
  mc.monto_mora
FROM _moras_a_condonar mc;

-- E.3  Cerrar la mora: activa=false, monto_mora=0, updated_at=now
UPDATE cartera.moras_credito m
   SET monto_mora = '0',
       activa     = false,
       updated_at = NOW()
  FROM _moras_a_condonar mc
 WHERE m.mora_id = mc.mora_id;

-- E.4  Mover statusCredit -> ACTIVO solo si era MOROSO
--      (no tocar EN_CONVENIO, CANCELADO, INCOBRABLE, etc)
UPDATE cartera.creditos c
   SET "statusCredit" = 'ACTIVO'
  FROM _moras_a_condonar mc
 WHERE c.credito_id = mc.credito_id
   AND c."statusCredit" = 'MOROSO';

-- ---------------------------------------------------------------------------
-- F.  Verificacion post-fix
-- ---------------------------------------------------------------------------
SELECT 'cuotas marcadas pagado=true'   AS check, COUNT(*) AS n
  FROM cartera.cuotas_credito c
  JOIN _cuotas_a_cerrar ca ON ca.cuota_id = c.cuota_id
 WHERE c.pagado = true
UNION ALL
SELECT 'moras desactivadas',                    COUNT(*)
  FROM cartera.moras_credito m
  JOIN _moras_a_condonar mc ON mc.mora_id = m.mora_id
 WHERE m.activa = false AND m.monto_mora = 0
UNION ALL
SELECT 'condonaciones registradas',             COUNT(*)
  FROM cartera.moras_condonaciones
 WHERE motivo LIKE 'Saneamiento automatico%'
   AND usuario_id = 12
UNION ALL
SELECT 'creditos pasados a ACTIVO desde MOROSO',COUNT(*)
  FROM cartera.creditos c
  JOIN _moras_a_condonar mc ON mc.credito_id = c.credito_id
 WHERE c."statusCredit" = 'ACTIVO';

-- ---------------------------------------------------------------------------
-- G.  Pagos validated SIN distribucion a inversionistas (gap conocido)
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
