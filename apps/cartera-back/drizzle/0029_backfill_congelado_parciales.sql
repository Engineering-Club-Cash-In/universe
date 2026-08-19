-- Backfill del reparto congelado para los pagos PARCIALES que ya se facturaron
-- ANTES de que existiera pagos_credito_inversionistas_facturado (migración 0028).
--
-- Por qué hace falta: la tabla nace vacía, y /facturar-pago-completo rechaza los
-- pagos que ya tienen facturas activas — o sea que el tráfico normal NUNCA va a
-- sellar estos pagos. Sin este backfill siguen recalculándose con el roster vivo,
-- incluido el pago 152741 (crédito 01010214118190) que originó el reporte de conta.
--
-- Cómo reconstruye el roster del día de la factura:
--   aporte_histórico = monto_aportado de hoy
--                    − lo que ESE inversionista compró/reinvirtió después del pago
--                    + (solo CUBE) lo que compraron los demás después del pago
--   La suma a CUBE es clave: la reinversión de un inversionista sale de la posición
--   de CUBE, y CUBE no lleva fila en compras_credito_inversionista. Sin eso el
--   denominador queda corto y el reparto sale mal (el pago 152741 daba 6.86 en vez
--   de los 6.42 que se facturaron).
--
-- SOLO inserta lo que se puede COMPROBAR: se reconstruye el reparto, se compara
-- contra el rubro INTERES_INVERSIONISTAS que quedó grabado en facturacion_desglose
-- ese día, y si no cuadra al centavo el pago se descarta. Medido contra producción
-- el 2026-08-19: 359 pagos candidatos, 35 con rubro contra el cual validar, 34
-- reconstruyen exacto y 1 (pago 151727, crédito 01010101001190) queda fuera por
-- Q0.02 de redondeo — ese se revisa a mano si hace falta.
--
-- Los pagos que no se siembran no cambian de comportamiento: al no tener congelado
-- siguen simulándose con el roster vivo, exactamente como hoy.
--
-- Idempotente: ON CONFLICT DO NOTHING. Reversible: DELETE de las filas insertadas.

WITH candidatos AS (
  SELECT p.pago_id, p.credito_id, p.fecha_aplicado,
         p.abono_interes::numeric AS interes,
         COALESCE(p.abono_iva_12, 0)::numeric AS iva,
         p.abono_interes::numeric + COALESCE(p.abono_iva_12, 0)::numeric AS bruto
  FROM cartera.pagos_credito p
  WHERE p.validation_status = 'validated'
    AND p.abono_interes > 0
    AND NOT EXISTS (SELECT 1 FROM cartera.pagos_credito_inversionistas x
                    WHERE x.pago_id = p.pago_id)
    AND EXISTS (SELECT 1 FROM cartera.facturacion_desglose d
                WHERE d.pago_id = p.pago_id AND d.rubro::text = 'INTERES')
    AND EXISTS (SELECT 1 FROM cartera.facturas_electronicas f
                WHERE f.pago_id = p.pago_id AND f.status = 'ACTIVA')
),
roster AS (
  SELECT c.pago_id, c.credito_id, c.interes, c.iva, c.bruto,
         ci.inversionista_id, i.nombre, i.emite_factura,
         ci.porcentaje_participacion_inversionista::numeric AS pct_inv,
         ci.porcentaje_cash_in::numeric AS pct_cash,
         (UPPER(TRIM(i.nombre)) LIKE '%CUBE INVESTMENTS%') AS es_cube,
         ci.monto_aportado::numeric
           - COALESCE((SELECT SUM(cc.monto_aportado::numeric)
                       FROM cartera.compras_credito_inversionista cc
                       WHERE cc.credito_id = ci.credito_id
                         AND cc.inversionista_id = ci.inversionista_id
                         AND cc.created_at > c.fecha_aplicado), 0)
           + CASE WHEN UPPER(TRIM(i.nombre)) LIKE '%CUBE INVESTMENTS%'
                  THEN COALESCE((SELECT SUM(cc2.monto_aportado::numeric)
                                 FROM cartera.compras_credito_inversionista cc2
                                 JOIN cartera.inversionistas i2
                                   ON i2.inversionista_id = cc2.inversionista_id
                                 WHERE cc2.credito_id = ci.credito_id
                                   AND UPPER(TRIM(i2.nombre)) NOT LIKE '%CUBE INVESTMENTS%'
                                   AND cc2.created_at > c.fecha_aplicado), 0)
                  ELSE 0 END AS aporte_hist
  FROM candidatos c
  JOIN cartera.creditos_inversionistas ci ON ci.credito_id = c.credito_id
  JOIN cartera.inversionistas i ON i.inversionista_id = ci.inversionista_id
),
tot AS (
  SELECT pago_id, SUM(aporte_hist) AS suma FROM roster GROUP BY pago_id
),
-- Reparto reconstruido de los que CUBE factura (no-CUBE que no se autofacturan):
-- es lo que tiene que dar igual al rubro INTERES_INVERSIONISTAS de ese día.
recon AS (
  SELECT r.pago_id,
         SUM(CASE WHEN NOT r.es_cube AND r.emite_factura = false
                  THEN ROUND(r.bruto * (r.aporte_hist / t.suma) * (r.pct_inv / 100), 2)
                  ELSE 0 END) AS reconstruido
  FROM roster r
  JOIN tot t ON t.pago_id = r.pago_id AND t.suma > 0
  GROUP BY r.pago_id
),
fact AS (
  SELECT pago_id, SUM(monto_total) AS facturado
  FROM cartera.facturacion_desglose
  WHERE rubro::text = 'INTERES_INVERSIONISTAS'
  GROUP BY pago_id
),
validos AS (
  SELECT r.pago_id
  FROM recon r
  JOIN fact f ON f.pago_id = r.pago_id
  WHERE ABS(r.reconstruido - f.facturado) <= 0.01
)
INSERT INTO cartera.pagos_credito_inversionistas_facturado
  (pago_id, credito_id, inversionista_id, abono_interes, abono_iva_12,
   monto_aportado, porcentaje_participacion, porcentaje_cash_in, redirigido_a_cube)
SELECT r.pago_id,
       r.credito_id,
       r.inversionista_id,
       -- Interés e IVA se redondean por separado, igual que calcularSplitInteresPci.
       ROUND(r.interes * (r.aporte_hist / t.suma)
             * ((CASE WHEN r.es_cube THEN r.pct_cash ELSE r.pct_inv END) / 100), 2),
       ROUND(r.iva * (r.aporte_hist / t.suma)
             * ((CASE WHEN r.es_cube THEN r.pct_cash ELSE r.pct_inv END) / 100), 2),
       r.aporte_hist,
       CASE WHEN r.es_cube THEN r.pct_cash ELSE r.pct_inv END,
       r.pct_cash,
       -- false a propósito: si alguno hubiera estado redirigido a CUBE, su parte
       -- no habría entrado al rubro INTERES_INVERSIONISTAS y el pago no habría
       -- pasado la validación de arriba. Para los que sí pasaron, false es el
       -- valor histórico correcto.
       false
FROM roster r
JOIN tot t ON t.pago_id = r.pago_id AND t.suma > 0
JOIN validos v ON v.pago_id = r.pago_id
ON CONFLICT (pago_id, inversionista_id) DO NOTHING;
