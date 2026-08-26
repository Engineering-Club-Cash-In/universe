-- =====================================================================
-- Ajustes Autocash (liquidación) — 2026-08-26
--   1) Crédito 01010214117200 (Anabella, credito_id 890): cuota 3400.95 -> 3379.08
--      · creditos.cuota
--      · creditos_inversionistas (padre) y _espejo: cuota_inversionista + derivados
--      · pagos_credito: recibos NO pagados desde la cuota 13, re-amortizados
--        partiendo del saldo real (misma fórmula que recalcularPagosCredito,
--        pero arrancando del capital pendiente, no de creditos.capital)
--   2) Solo creditos_inversionistas_espejo.monto_aportado (fila de Autocash, inv 89):
--      01010202115520 Brenda  28,719.40 -> 23,376.73
--      01010214108640 Mario   50,338.06 -> 50,296.08
--      01010214117110 Miguel  50,740.17 -> 50,764.48
--      01010214116550 Pedro    5,324.53 ->  5,335.11
--   4) Pagos espejo NO_LIQUIDADO (Brenda, Anabella): UPDATE directo, prod no recalcula.
--   3) 01010202102560 (Eunice, 967): liquidar abono a capital id 101 (Q158.03) para que
--      el abono_capital del espejo quede en 598.35 y no 756.38. No se toca su monto.
--
-- Correr con: psql "$URL" -v ON_ERROR_STOP=1 -f autocash_liquidacion_20260826.sql
-- Idempotencia: los guards abortan si los valores actuales no son los esperados.
-- Rollback manual: tablas cartera.backup_autocash_20260826_* (+ borrar los 4 snapshots
--   insertados en historico_liquidaciones_espejo con liquidacion_id NULL y fecha de hoy)
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = cartera;

-- ---------------------------------------------------------------------
-- 0) GUARDS: el estado actual tiene que ser el que vimos en prod
-- ---------------------------------------------------------------------
DO $$
DECLARE v numeric; n int;
BEGIN
  SELECT cuota INTO v FROM creditos WHERE credito_id = 890 AND numero_credito_sifco = '01010214117200';
  IF v IS DISTINCT FROM 3400.95 THEN RAISE EXCEPTION 'Guard 890: cuota actual % (esperada 3400.95)', v; END IF;

  SELECT count(*) INTO n FROM creditos_inversionistas WHERE credito_id = 890;
  IF n <> 1 THEN RAISE EXCEPTION 'Guard 890: padre tiene % filas (esperada 1)', n; END IF;
  SELECT count(*) INTO n FROM creditos_inversionistas_espejo WHERE credito_id = 890;
  IF n <> 1 THEN RAISE EXCEPTION 'Guard 890: espejo tiene % filas (esperada 1)', n; END IF;

  -- Recibos a re-amortizar: cuota >= 13, no pagados, sin monto aplicado
  SELECT count(*) INTO n
    FROM pagos_credito p JOIN cuotas_credito c ON c.cuota_id = p.cuota_id
   WHERE p.credito_id = 890 AND c.numero_cuota >= 13 AND p.pagado = false
     AND coalesce(p.monto_aplicado,0) <> 0;
  IF n <> 0 THEN RAISE EXCEPTION 'Guard 890: hay % recibos >=13 con monto_aplicado', n; END IF;

  -- Espejos de los 4 créditos con el valor actual esperado
  SELECT count(*) INTO n FROM creditos_inversionistas_espejo e
   WHERE (e.id, e.credito_id, e.inversionista_id, round(e.monto_aportado,2)) IN (
     (1396, 32, 89, 28719.40),
     (3039, 437, 89, 50338.06),
     (3153, 31, 89, 50740.17),
     (7671, 259, 89, 5324.53));
  IF n <> 4 THEN RAISE EXCEPTION 'Guard espejos: % de 4 filas coinciden con el valor actual esperado', n; END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1) BACKUPS
-- ---------------------------------------------------------------------
CREATE TABLE backup_autocash_20260826_creditos AS
  SELECT * FROM creditos WHERE credito_id = 890;
CREATE TABLE backup_autocash_20260826_pagos_credito AS
  SELECT * FROM pagos_credito WHERE credito_id = 890;
CREATE TABLE backup_autocash_20260826_creditos_inv AS
  SELECT * FROM creditos_inversionistas WHERE credito_id = 890;
CREATE TABLE backup_autocash_20260826_creditos_inv_espejo AS
  SELECT * FROM creditos_inversionistas_espejo WHERE credito_id IN (890, 32, 437, 31, 259);

-- ---------------------------------------------------------------------
-- 2) ANABELLA (890): cuota 3379.08
--    interés = 1.5% × 69,625.61 = 1,044.38 → 80/20 = 835.50 / 208.88; IVA 12% = 100.26 / 25.07
-- ---------------------------------------------------------------------
UPDATE creditos SET cuota = 3379.08 WHERE credito_id = 890;

UPDATE creditos_inversionistas
   SET cuota_inversionista = 3379.08,
       monto_inversionista = 835.50, monto_cash_in = 208.88,
       iva_inversionista   = 100.26, iva_cash_in   = 25.07
 WHERE credito_id = 890 AND inversionista_id = 89;

UPDATE creditos_inversionistas_espejo
   SET cuota_inversionista = 3379.08,
       monto_inversionista = 835.50, monto_cash_in = 208.88,
       iva_inversionista   = 100.26, iva_cash_in   = 25.07,
       updated_at = now()
 WHERE credito_id = 890 AND inversionista_id = 89;

-- 2b) Re-amortizar recibos no pagados desde la cuota 13.
--     Saldo inicial = capital pendiente antes de la cuota 13, leído del propio
--     recibo 13 (total_restante + capital_restante = 50,585.17 + 1,736.09 = 52,321.26).
DO $$
DECLARE
  r record;
  v_saldo    numeric;
  v_cuota    numeric := 3379.08;
  v_tasa     numeric := 0.015;      -- porcentaje_interes 1.50
  v_seguro   numeric := 279.45;     -- seguro_10_cuotas
  v_gps      numeric := 0;          -- gps
  v_membr    numeric := 506.41;     -- membresias_pago
  v_interes  numeric; v_iva numeric; v_cap numeric;
  n int := 0;
BEGIN
  SELECT p.total_restante + p.capital_restante INTO v_saldo
    FROM pagos_credito p JOIN cuotas_credito c ON c.cuota_id = p.cuota_id
   WHERE p.credito_id = 890 AND c.numero_cuota = 13 AND p.pagado = false
   ORDER BY p.pago_id LIMIT 1;
  IF v_saldo IS DISTINCT FROM 52321.26 THEN
    RAISE EXCEPTION 'Saldo inicial inesperado: % (esperado 52321.26)', v_saldo;
  END IF;

  FOR r IN
    SELECT p.pago_id, c.numero_cuota
      FROM pagos_credito p JOIN cuotas_credito c ON c.cuota_id = p.cuota_id
     WHERE p.credito_id = 890 AND c.numero_cuota >= 13 AND p.pagado = false
     ORDER BY c.numero_cuota, p.pago_id
  LOOP
    v_interes := round(v_saldo * v_tasa, 2);
    v_iva     := round(v_interes * 0.12, 2);
    v_cap     := v_cuota - v_interes - v_iva - v_seguro - v_gps - v_membr;
    IF v_cap > v_saldo THEN v_cap := v_saldo; END IF;
    v_saldo   := v_saldo - v_cap;
    IF v_saldo < 0 THEN v_saldo := 0; END IF;

    UPDATE pagos_credito SET
      cuota            = v_cuota,
      abono_interes    = 0, abono_iva_12 = 0, abono_seguro = 0, abono_gps = 0,
      abono_capital    = 0, pago_del_mes = 0,
      interes_restante = v_interes,
      iva_12_restante  = v_iva,
      seguro_restante  = v_seguro,
      gps_restante     = v_gps,
      membresias       = v_membr,
      capital_restante = v_cap,
      total_restante   = v_saldo,
      pagado           = false
    WHERE pago_id = r.pago_id;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Recibos re-amortizados: % (saldo final %)', n, v_saldo;
  IF n <> 36 THEN RAISE EXCEPTION 'Se esperaban 36 recibos (13..48), hubo %', n; END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3) monto_aportado del espejo (solo Autocash). El trigger deja el rastro
--    en historico_monto_aportado_espejo.
-- ---------------------------------------------------------------------
UPDATE creditos_inversionistas_espejo SET monto_aportado = 23376.73, updated_at = now() WHERE id = 1396 AND credito_id = 32;
UPDATE creditos_inversionistas_espejo SET monto_aportado = 50296.08, updated_at = now() WHERE id = 3039 AND credito_id = 437;
UPDATE creditos_inversionistas_espejo SET monto_aportado = 50764.48, updated_at = now() WHERE id = 3153 AND credito_id = 31;
UPDATE creditos_inversionistas_espejo SET monto_aportado = 5335.11,  updated_at = now() WHERE id = 7671 AND credito_id = 259;

-- ---------------------------------------------------------------------
-- 3b) Alinear historico_liquidaciones_espejo con el nuevo monto del espejo.
--     insertPagosCreditoInversionistas (payments.ts) valida espejo == último
--     snapshot con .eq() exacto; si no se re-basa, "Calcular pagos" tira
--     MONTO_ESPEJO_INCONSISTENTE. Mismo patrón que la alineación del 2026-08-07
--     (liquidacion_id NULL). Solo valida, no mueve plata.
-- ---------------------------------------------------------------------
INSERT INTO historico_liquidaciones_espejo (credito_id, inversionista_id, monto_aportado, fecha, liquidacion_id)
SELECT e.credito_id, e.inversionista_id, e.monto_aportado, now(), NULL
  FROM creditos_inversionistas_espejo e
 WHERE e.id IN (1396, 3039, 3153, 7671) AND e.inversionista_id = 89
 ORDER BY e.credito_id;

-- ---------------------------------------------------------------------
-- 3c) Eunice 01010202102560 (credito_id 967): abono a capital pendiente de
--     Q158.03 (abonos_capital id 101, del sobrante de la boleta 125809 del
--     2026-05-01) que el motor SUMA al abono_capital del pago espejo
--     (598.35 + 158.03 = 756.38). Conta lo quiere en 598.35 (el Excel nunca
--     aplicó ese sobrante). Se marca liquidado para que no vuelva a sumarse,
--     y si ya existe la fila NO_LIQUIDADO colgada de ese abono, se le resta.
-- ---------------------------------------------------------------------
CREATE TABLE backup_autocash_20260826_abonos_capital AS
  SELECT * FROM abonos_capital WHERE abono_id = 101;

UPDATE abonos_capital SET liquidado = true, updated_at = now()
 WHERE abono_id = 101 AND credito_id = 967 AND inversionista_id = 89
   AND liquidado = false AND monto = 158.03;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM abonos_capital WHERE abono_id = 101 AND liquidado = true;
  IF n <> 1 THEN RAISE EXCEPTION 'Guard abono 101: no quedó liquidado (¿ya estaba liquidado o cambió el monto?)'; END IF;
END $$;

-- Si el pago espejo pendiente ya lo traía sumado, quitárselo (no-op si se va a regenerar)
UPDATE pagos_credito_inversionistas_espejo
   SET abono_capital = abono_capital - 158.03, abono_capital_id = NULL, updated_at = now()
 WHERE credito_id = 967 AND inversionista_id = 89
   AND estado_liquidacion = 'NO_LIQUIDADO' AND abono_capital_id = 101;

-- ---------------------------------------------------------------------
-- 3d) Pagos espejo NO_LIQUIDADO de Autocash: en prod NO se recalculan, así
--     que se actualizan a mano con lo que dio el motor en dev tras el ajuste
--     (calcularPagosEspejo inv 89 + ceros_abonos_autocash.sql, 2026-08-26):
--       · Brenda 32:   interés = 23,376.73 × 1.5% × 80% (×2 períodos, como ya venía)
--                      cap 40.30 → 219.82, int 689.26 → 561.04, iva 82.71 → 67.32
--       · Anabella 890: cuota 3,379.08 → cap 1,445.38 → 1,423.51 (int/iva iguales)
--       · Mario 437, Miguel 31, Pedro 259: ya están en 0 (lista de ceros) — no se tocan
--       · Eunice 967: la resta de 158.03 ya la hizo la sección 3c
--     Se empata por credito_id + inversionista + NO_LIQUIDADO (una fila por crédito).
-- ---------------------------------------------------------------------
CREATE TABLE backup_autocash_20260826_pagos_espejo AS
  SELECT * FROM pagos_credito_inversionistas_espejo
   WHERE inversionista_id = 89 AND estado_liquidacion = 'NO_LIQUIDADO'
     AND credito_id IN (890, 32, 437, 31, 259, 967);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pagos_credito_inversionistas_espejo
   WHERE inversionista_id = 89 AND estado_liquidacion = 'NO_LIQUIDADO'
     AND ((credito_id = 32  AND round(abono_capital,2) = 40.30   AND round(abono_interes,2) = 689.26)
       OR (credito_id = 890 AND round(abono_capital,2) = 1445.38 AND round(abono_interes,2) = 835.50));
  IF n <> 2 THEN RAISE EXCEPTION 'Guard 3d: % de 2 filas espejo NO_LIQUIDADO (32, 890) con los valores esperados', n; END IF;
  SELECT count(*) INTO n FROM pagos_credito_inversionistas_espejo
   WHERE inversionista_id = 89 AND estado_liquidacion = 'NO_LIQUIDADO'
     AND credito_id IN (437, 31, 259) AND abono_capital = 0 AND abono_interes = 0 AND abono_iva_12 = 0;
  IF n <> 3 THEN RAISE EXCEPTION 'Guard 3d: Mario/Miguel/Pedro ya no están en 0 (%/3) — revisar antes de seguir', n; END IF;
END $$;

UPDATE pagos_credito_inversionistas_espejo
   SET abono_capital = 219.82, abono_interes = 561.04, abono_iva_12 = 67.32, updated_at = now()
 WHERE credito_id = 32 AND inversionista_id = 89 AND estado_liquidacion = 'NO_LIQUIDADO';

UPDATE pagos_credito_inversionistas_espejo
   SET abono_capital = 1423.51, updated_at = now()
 WHERE credito_id = 890 AND inversionista_id = 89 AND estado_liquidacion = 'NO_LIQUIDADO';

-- ---------------------------------------------------------------------
-- 4) VERIFICACIÓN
-- ---------------------------------------------------------------------
SELECT e.credito_id, e.id, e.pago_id, e.abono_capital, e.abono_interes, e.abono_iva_12, e.abono_capital_id
  FROM pagos_credito_inversionistas_espejo e
 WHERE e.inversionista_id = 89 AND e.estado_liquidacion = 'NO_LIQUIDADO'
   AND e.credito_id IN (890, 32, 437, 31, 259, 967) ORDER BY 1;
SELECT abono_id, credito_id, monto, liquidado FROM abonos_capital WHERE abono_id = 101;
SELECT id, abono_capital, abono_interes, abono_capital_id FROM pagos_credito_inversionistas_espejo
 WHERE credito_id = 967 AND inversionista_id = 89 AND estado_liquidacion = 'NO_LIQUIDADO';
SELECT h.credito_id, h.inversionista_id, h.monto_aportado, h.fecha, h.liquidacion_id
  FROM historico_liquidaciones_espejo h
 WHERE h.inversionista_id = 89 AND h.credito_id IN (32, 437, 31, 259)
   AND h.fecha = (SELECT max(fecha) FROM historico_liquidaciones_espejo x WHERE x.credito_id = h.credito_id AND x.inversionista_id = 89)
 ORDER BY 1;
SELECT 'creditos' AS tabla, credito_id, cuota FROM creditos WHERE credito_id = 890;
SELECT 'padre'  AS tabla, id, cuota_inversionista, monto_inversionista, monto_cash_in, iva_inversionista, iva_cash_in FROM creditos_inversionistas        WHERE credito_id = 890
UNION ALL
SELECT 'espejo', id, cuota_inversionista, monto_inversionista, monto_cash_in, iva_inversionista, iva_cash_in FROM creditos_inversionistas_espejo WHERE credito_id = 890;
SELECT c.numero_cuota, p.pago_id, p.cuota, p.interes_restante, p.iva_12_restante, p.seguro_restante, p.membresias, p.capital_restante, p.total_restante, p.pagado
  FROM pagos_credito p JOIN cuotas_credito c ON c.cuota_id = p.cuota_id
 WHERE p.credito_id = 890 AND c.numero_cuota >= 12 ORDER BY c.numero_cuota, p.pago_id;
SELECT e.id, c.numero_credito_sifco, e.inversionista_id, e.monto_aportado, ci.monto_aportado AS padre_monto, e.status
  FROM creditos_inversionistas_espejo e
  JOIN creditos c ON c.credito_id = e.credito_id
  LEFT JOIN creditos_inversionistas ci ON ci.credito_id = e.credito_id AND ci.inversionista_id = e.inversionista_id
 WHERE e.credito_id IN (32, 437, 31, 259) ORDER BY 2, 1;

COMMIT;
