-- COBROS-02 · Fase 2 — el convenio CONGELA el bucket.
--
-- Hasta hoy el job de convenios recalculaba el bucket con "borrón y cuenta
-- nueva": un convenio recién firmado caía a B0 y se lo llevaba el asesor de B0.
-- La regla acordada con el PM (decisión 9 del plan 08) es la contraria — el
-- crédito se queda en el bucket que tenía al firmar, con su asesor, hasta que
-- se pague completo o alguien deshaga el convenio.
--
-- Para poder ESCRIBIR eso en la bitácora hace falta un evento nuevo. Los tres
-- que hay describen movimiento (INICIAL / SUBIDA / BAJADA) y el CHECK de
-- coherencia los obliga a moverse: no existe forma de registrar "se quedó donde
-- estaba, y a propósito". Tampoco sirve un INICIAL: `buckets_historial_uq_inicial`
-- garantiza UNA sola línea base por crédito, y estos créditos ya la tienen de
-- cuando eran MOROSO.
--
-- `CONGELADO` es exactamente eso: mismo bucket, decisión humana detrás. Y hace
-- falta que exista como fila porque el lector (`bucketActualSql`) ignora, para
-- un crédito EN_CONVENIO, todo el historial que NO sea de su régimen de
-- convenio — sin una fila propia el crédito se queda sin bucket visible.

-- 1. El valor nuevo del enum. Aditivo, no reescribe la tabla. Un valor nuevo no
--    se puede usar en la MISMA transacción que lo crea, así que este archivo se
--    aplica con autocommit (flujo normal de psql).
ALTER TYPE cartera.bucket_evento_tipo ADD VALUE IF NOT EXISTS 'CONGELADO';
--> statement-breakpoint

-- 2. El CHECK de coherencia, ampliado. Se recrea entero (no hay ALTER de un
--    CHECK) manteniendo las tres reglas que ya había, palabra por palabra, y
--    agregando la cuarta. Los guards IS NOT NULL siguen siendo obligatorios:
--    sin ellos una comparación con NULL evalúa a NULL y el CHECK la deja pasar.
ALTER TABLE cartera.buckets_historial
  DROP CONSTRAINT IF EXISTS buckets_historial_evento_coherente_ck;
--> statement-breakpoint

ALTER TABLE cartera.buckets_historial
  ADD CONSTRAINT buckets_historial_evento_coherente_ck CHECK (
    (tipo_evento = 'INICIAL' AND bucket_anterior IS NULL)
    OR (tipo_evento = 'SUBIDA' AND bucket_anterior IS NOT NULL AND bucket_nuevo > bucket_anterior)
    OR (tipo_evento = 'BAJADA' AND bucket_anterior IS NOT NULL AND bucket_nuevo < bucket_anterior)
    -- CONGELADO: el crédito NO se mueve, y eso es el dato. Exige los dos
    -- lados presentes e iguales — un "congelado" que cambia de bucket sería
    -- una contradicción, no un congelamiento.
    OR (tipo_evento = 'CONGELADO' AND bucket_anterior IS NOT NULL AND bucket_nuevo = bucket_anterior)
  );
