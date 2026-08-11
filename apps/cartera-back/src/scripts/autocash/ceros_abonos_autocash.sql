-- ============================================================================
-- Deja en CERO los abonos del pago espejo NO_LIQUIDADO de 29 créditos de
-- AUTOCASH (89).   —   LISTO PARA PROD
-- ============================================================================
--
-- Cuándo se corre: cada vez que se revierten y se vuelven a calcular los pagos
-- espejo de Autocash. El recálculo los regenera con monto, y estos 29 tienen
-- que quedar en 0 (acuerdo con conta).
--
-- La lista va en duro a propósito: antes vivía en `cartera.lista_ceros_autocash`
-- de la DB local y eso ataba el script a tener local levantada.
--
-- Se empata por `numero_credito_sifco` y no por `id` ni `pago_id`: al borrar y
-- regenerar, las filas nuevas traen `id` nuevo y pueden colgar de otro `pago_id`
-- (el recálculo elige la primera cuota no liquidada). Hay exactamente UNA fila
-- NO_LIQUIDADO por crédito, así que el SIFCO es la llave estable.
--
-- Las cuatro columnas *_sin_compras / *_con_compras se reponen a NULL, que es
-- como estaban antes de que el recálculo las llenara.
-- ============================================================================

-- ── Paso 1: RESPALDO ────────────────────────────────────────────────────────
-- Guarda las 90 y pico filas NO_LIQUIDADO de Autocash, marcando cuáles son de
-- la lista. Cambiar la fecha del nombre en cada corrida.
DROP TABLE IF EXISTS cartera.bk_autocash_espejo_AAAAMMDD;
CREATE TABLE cartera.bk_autocash_espejo_AAAAMMDD AS
WITH lista(sifco) AS (VALUES
  ('01010202106270'),
  ('01010206104710'),
  ('01010214108640'),
  ('01010214109550'),
  ('01010214111170'),
  ('01010214111350'),
  ('01010214112390'),
  ('01010214112490'),
  ('01010214113800'),
  ('01010214115170'),
  ('01010214115560'),
  ('01010214116550'),
  ('01010214117110'),
  ('01010214117130'),
  ('01010214117220'),
  ('01010214117420'),
  ('01010214118280'),
  ('01010214118420'),
  ('01010214118440'),
  ('01010214118500'),
  ('01010214119480'),
  ('01010214119560'),
  ('01010214119610'),
  ('01010214120020'),
  ('01010214121730'),
  ('CRM-3487060b-1e50-4d3c-8080-260f0d342543'),
  ('CRM-9c22e4c9-3d02-472e-b2f6-7ab266d8b00e'),
  ('CRM-b0f852b2-7c1f-43f1-ab1d-7ee495cc4eba'),
  ('CRM-c066702e-dfb5-450f-bbcf-2a913f0aa867')
)
SELECT e.*, c.numero_credito_sifco AS sifco, u.nombre AS cliente,
       (c.numero_credito_sifco IN (SELECT sifco FROM lista)) AS en_lista_ceros,
       now() AS respaldado_en
FROM cartera.pagos_credito_inversionistas_espejo e
JOIN cartera.creditos c ON c.credito_id = e.credito_id
LEFT JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
WHERE e.inversionista_id = 89 AND e.estado_liquidacion = 'NO_LIQUIDADO';

-- `de_la_lista` tiene que dar 29. Si da menos, algún crédito no se regeneró:
-- revisar con el control del final ANTES de seguir.
SELECT count(*) AS filas_respaldadas,
       count(*) FILTER (WHERE en_lista_ceros) AS de_la_lista,
       count(*) FILTER (WHERE abono_capital = 0 AND abono_interes = 0
                          AND abono_iva_12 = 0) AS ya_en_cero
FROM cartera.bk_autocash_espejo_AAAAMMDD;


-- ── Paso 2: dejar en 0 ──────────────────────────────────────────────────────
-- El bloque aborta solo si no quedan exactamente 29 en cero.
BEGIN;

WITH lista(sifco) AS (VALUES
  ('01010202106270'), ('01010206104710'), ('01010214108640'), ('01010214109550'),
  ('01010214111170'), ('01010214111350'), ('01010214112390'), ('01010214112490'),
  ('01010214113800'), ('01010214115170'), ('01010214115560'), ('01010214116550'),
  ('01010214117110'), ('01010214117130'), ('01010214117220'), ('01010214117420'),
  ('01010214118280'), ('01010214118420'), ('01010214118440'), ('01010214118500'),
  ('01010214119480'), ('01010214119560'), ('01010214119610'), ('01010214120020'),
  ('01010214121730'),
  ('CRM-3487060b-1e50-4d3c-8080-260f0d342543'),
  ('CRM-9c22e4c9-3d02-472e-b2f6-7ab266d8b00e'),
  ('CRM-b0f852b2-7c1f-43f1-ab1d-7ee495cc4eba'),
  ('CRM-c066702e-dfb5-450f-bbcf-2a913f0aa867')
)
UPDATE cartera.pagos_credito_inversionistas_espejo e
   SET abono_capital             = 0,
       abono_interes             = 0,
       abono_iva_12              = 0,
       abono_interes_sin_compras = NULL,
       abono_interes_con_compras = NULL,
       abono_iva_12_sin_compras  = NULL,
       abono_iva_12_con_compras  = NULL,
       updated_at                = now()
  FROM cartera.creditos c
 WHERE e.credito_id          = c.credito_id
   AND e.inversionista_id    = 89
   AND e.estado_liquidacion  = 'NO_LIQUIDADO'
   AND c.numero_credito_sifco IN (SELECT sifco FROM lista);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM cartera.pagos_credito_inversionistas_espejo e
  JOIN cartera.bk_autocash_espejo_AAAAMMDD b
    ON b.credito_id = e.credito_id AND b.en_lista_ceros
  WHERE e.inversionista_id = 89 AND e.estado_liquidacion = 'NO_LIQUIDADO'
    AND e.abono_capital = 0 AND e.abono_interes = 0 AND e.abono_iva_12 = 0;
  IF n <> 29 THEN
    RAISE EXCEPTION 'Esperaba 29 filas en cero, encontré %', n;
  END IF;
END $$;

COMMIT;


-- ── Paso 3: verificar ───────────────────────────────────────────────────────
SELECT count(*) AS total_no_liquidado,
       count(*) FILTER (WHERE abono_capital = 0 AND abono_interes = 0
                          AND abono_iva_12 = 0) AS en_cero
FROM cartera.pagos_credito_inversionistas_espejo
WHERE inversionista_id = 89 AND estado_liquidacion = 'NO_LIQUIDADO';


-- ── Control: créditos de la lista que NO se regeneraron ─────────────────────
-- Si el recálculo omite alguno (crédito sin cuota con pago, o participación
-- fuera de período), acá sale y no se le pudo poner 0.
WITH lista(sifco) AS (VALUES
  ('01010202106270'), ('01010206104710'), ('01010214108640'), ('01010214109550'),
  ('01010214111170'), ('01010214111350'), ('01010214112390'), ('01010214112490'),
  ('01010214113800'), ('01010214115170'), ('01010214115560'), ('01010214116550'),
  ('01010214117110'), ('01010214117130'), ('01010214117220'), ('01010214117420'),
  ('01010214118280'), ('01010214118420'), ('01010214118440'), ('01010214118500'),
  ('01010214119480'), ('01010214119560'), ('01010214119610'), ('01010214120020'),
  ('01010214121730'),
  ('CRM-3487060b-1e50-4d3c-8080-260f0d342543'),
  ('CRM-9c22e4c9-3d02-472e-b2f6-7ab266d8b00e'),
  ('CRM-b0f852b2-7c1f-43f1-ab1d-7ee495cc4eba'),
  ('CRM-c066702e-dfb5-450f-bbcf-2a913f0aa867')
)
SELECT l.sifco, c.credito_id, c."statusCredit" AS status
FROM lista l
LEFT JOIN cartera.creditos c ON c.numero_credito_sifco = l.sifco
WHERE NOT EXISTS (
        SELECT 1 FROM cartera.pagos_credito_inversionistas_espejo e
         WHERE e.credito_id = c.credito_id
           AND e.inversionista_id = 89
           AND e.estado_liquidacion = 'NO_LIQUIDADO')
ORDER BY l.sifco;


-- ── Rollback, si hiciera falta después del COMMIT ───────────────────────────
-- UPDATE cartera.pagos_credito_inversionistas_espejo e
--    SET abono_capital = b.abono_capital,
--        abono_interes = b.abono_interes,
--        abono_iva_12  = b.abono_iva_12,
--        abono_interes_sin_compras = b.abono_interes_sin_compras,
--        abono_interes_con_compras = b.abono_interes_con_compras,
--        abono_iva_12_sin_compras  = b.abono_iva_12_sin_compras,
--        abono_iva_12_con_compras  = b.abono_iva_12_con_compras,
--        updated_at = now()
--   FROM cartera.bk_autocash_espejo_AAAAMMDD b
--  WHERE e.credito_id = b.credito_id
--    AND e.inversionista_id = 89
--    AND e.estado_liquidacion = 'NO_LIQUIDADO'
--    AND b.en_lista_ceros;
