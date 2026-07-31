-- Snapshot de las cuotas (cuota_id) que un convenio reestructuró al momento de
-- crearlo. Se popula en createPaymentAgreement desde los pagos seleccionados y
-- NO cambia con reversas/borrados posteriores de pagos.
--
-- Para qué: el job de buckets de convenios (COBROS-02) mide el atraso sobre
-- cuotas_credito EXCLUYENDO estos cuota_id, porque el convenio ya las absorbió.
-- Así las "born-overdue" (1, 2) no cuentan y solo suben de bucket las cuotas
-- nuevas que no se pagan (3, 4...).
--
-- Se prefirió esta columna sobre el pivot convenios_pagos_resume (pago_id) por
-- durabilidad: la reversa de pagos es común y rompería el puente pago_id→cuota_id.
--
-- Idempotente. Las filas existentes quedan en NULL (convenios viejos: el job los
-- trata como sin exclusión hasta que se recreen o se haga backfill si se decide).

ALTER TABLE "cartera"."convenios_pago"
  ADD COLUMN IF NOT EXISTS "cuotas_convenio" integer[];
