-- ============================================================================
-- Reponer en 0 los pagos espejo de AUTOCASH (89) que estaban en 0 antes de
-- borrarlos y volverlos a generar.   —   SOLO LOCAL
-- ============================================================================
--
-- Respaldo: cartera.bk_autocash_espejo_20260809
--   90 filas NO_LIQUIDADO de Autocash al 2026-08-09, con la columna
--   `abonos_en_cero` marcando las 38 que tenían abono_capital, abono_interes y
--   abono_iva_12 en 0. Trae además sifco / cliente / status para identificarlas.
--
-- Por qué se empata por `credito_id` y no por `id` ni `pago_id`: al borrar y
-- regenerar, las filas nuevas traen `id` nuevo y pueden colgar de otro `pago_id`
-- (el recálculo elige la primera cuota no liquidada). En cambio hay exactamente
-- UNA fila NO_LIQUIDADO por crédito — 90 filas / 90 créditos distintos — así que
-- `credito_id` es la llave estable.
--
-- Las cuatro columnas *_sin_compras / *_con_compras estaban en NULL en las 38,
-- por eso se reponen a NULL y no a 0.
-- ============================================================================

-- ── Paso 1: PREVIEW — qué se va a poner en 0 ────────────────────────────────
-- Correr DESPUÉS de regenerar los pagos. Deberían salir 38 filas.
SELECT b.sifco, b.cliente, b.status_credito,
       e.id                            AS id_nuevo,
       e.abono_capital::numeric(18,2)  AS cap_generado,
       e.abono_interes::numeric(18,2)  AS int_generado,
       e.abono_iva_12::numeric(18,2)   AS iva_generado,
       e.cuota::numeric(18,2)          AS cuota_generada
FROM cartera.pagos_credito_inversionistas_espejo e
JOIN cartera.bk_autocash_espejo_20260809 b USING (credito_id)
WHERE e.inversionista_id = 89
  AND e.estado_liquidacion = 'NO_LIQUIDADO'
  AND b.abonos_en_cero
ORDER BY b.sifco;


-- ── Paso 2: poner en 0 ──────────────────────────────────────────────────────
BEGIN;

UPDATE cartera.pagos_credito_inversionistas_espejo e
   SET abono_capital             = 0,
       abono_interes             = 0,
       abono_iva_12              = 0,
       abono_interes_sin_compras = NULL,
       abono_interes_con_compras = NULL,
       abono_iva_12_sin_compras  = NULL,
       abono_iva_12_con_compras  = NULL,
       updated_at                = now()
  FROM cartera.bk_autocash_espejo_20260809 b
 WHERE e.credito_id          = b.credito_id
   AND e.inversionista_id    = 89
   AND e.estado_liquidacion  = 'NO_LIQUIDADO'
   AND b.abonos_en_cero;

-- COMMIT;
-- ROLLBACK;


-- ── Paso 3: verificar ───────────────────────────────────────────────────────
-- `en_cero` tiene que dar 38 y `deberian_estar_en_cero_y_no_lo_estan` tiene que dar 0.
SELECT count(*) FILTER (WHERE e.abono_capital = 0 AND e.abono_interes = 0 AND e.abono_iva_12 = 0)
         AS en_cero,
       count(*) FILTER (WHERE b.abonos_en_cero
                          AND NOT (e.abono_capital = 0 AND e.abono_interes = 0 AND e.abono_iva_12 = 0))
         AS deberian_estar_en_cero_y_no_lo_estan,
       count(*) AS total_no_liquidado
FROM cartera.pagos_credito_inversionistas_espejo e
LEFT JOIN cartera.bk_autocash_espejo_20260809 b USING (credito_id)
WHERE e.inversionista_id = 89 AND e.estado_liquidacion = 'NO_LIQUIDADO';


-- ── Control: créditos del respaldo que NO se regeneraron ────────────────────
-- Si el recálculo omite alguno (crédito sin cuotas con pago, o con la
-- participación fuera de período), acá aparece y no se va a poder poner en 0.
SELECT b.sifco, b.cliente, b.status_credito, b.abonos_en_cero
FROM cartera.bk_autocash_espejo_20260809 b
WHERE NOT EXISTS (
        SELECT 1 FROM cartera.pagos_credito_inversionistas_espejo e
         WHERE e.credito_id = b.credito_id
           AND e.inversionista_id = 89
           AND e.estado_liquidacion = 'NO_LIQUIDADO')
ORDER BY b.abonos_en_cero DESC, b.sifco;
