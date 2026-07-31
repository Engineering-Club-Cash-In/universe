-- =====================================================================
-- COBROS-02 · Backfill de convenios_pago.cuotas_convenio (snapshot histórico)
-- =====================================================================
-- La columna `cuotas_convenio` (integer[]) guarda las cuotas (cuota_id) que un
-- convenio reestructuró al crearse. Los convenios NUEVOS la llenan solos
-- (createPaymentAgreement). Los VIEJOS quedaron en NULL — este script los llena
-- desde el pivot `convenios_pagos_resume` (convenio_id ↔ pago_id → cuota_id),
-- que es el único registro real de qué pagos/cuotas se seleccionaron al crear.
--
-- Por qué el pivot y no monto+cuota: el monto_total_convenio es una SUMA; de una
-- suma no se puede saber CUÁLES cuotas la componen. El pivot sí lo sabe.
-- Cobertura medida en el sandbox: 46/46 convenios vivos de créditos EN_CONVENIO
-- recuperan todas sus cuotas del pivot (0 sin pivot).
--
-- Para qué sirve: el job de buckets de convenio (bucketsConvenio.ts) mide el
-- atraso EXCLUYENDO estas cuotas. Sin backfill, un convenio viejo contaría sus
-- cuotas reestructuradas como atrasadas y subiría de bucket de más.
--
-- Idempotente: solo toca filas con cuotas_convenio IS NULL (NO pisa el snapshot
-- que dejó la creación). Re-correrlo no cambia nada.
-- NOTA: Cartera aplica el SQL a mano. Se aplica DESPUÉS de crear la columna.
-- =====================================================================

BEGIN;

-- Apunta a PRODUCCIÓN (`cartera`) por defecto: es el ambiente real del backfill,
-- y correrlo contra el schema equivocado deja las filas de prod en NULL (los
-- convenios viejos se bucketearían de más). Para el sandbox de COBROS-02 cambiar
-- a `cartera_cobros2` (ya corrido ahí).
SET LOCAL search_path TO cartera;

UPDATE convenios_pago cp
   SET cuotas_convenio = sub.cuotas,
       updated_at = NOW()
  FROM (
    SELECT r.convenio_id,
           array_agg(DISTINCT pc.cuota_id) AS cuotas
      FROM convenios_pagos_resume r
      JOIN pagos_credito pc ON pc.pago_id = r.pago_id
     GROUP BY r.convenio_id
  ) sub
 WHERE cp.convenio_id = sub.convenio_id
   AND cp.cuotas_convenio IS NULL;

-- Resumen: cuántos convenios quedaron con/ sin cuotas tras el backfill.
SELECT
  count(*) FILTER (WHERE cuotas_convenio IS NOT NULL) AS con_cuotas,
  count(*) FILTER (WHERE cuotas_convenio IS NULL)     AS sin_cuotas
FROM convenios_pago
WHERE completado = false;

COMMIT;
