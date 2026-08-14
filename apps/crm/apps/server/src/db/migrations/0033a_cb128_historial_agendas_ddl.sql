-- 0033a: CB-128 — Historial de agendas de cobros (snapshot de bucket + auditoría).
-- Espejo exacto del schema drizzle (`contactos_cobros.bucket_snapshot`,
-- `contactos_cobros.updated_at` y la tabla `contactos_cobros_audit` en
-- src/db/schema/cobros.ts). Idempotente: seguro de re-correr. Aplicar A MANO
-- (no drizzle-kit push/migrate — mismo criterio que 0026..0032).
--
-- ORDEN DE APLICACIÓN: 0033a (este archivo) y DESPUÉS 0033b.
--
-- Este archivo es transaccional y rápido: se puede correr entero, incluso con
-- `psql -1`. Los índices CONCURRENTLY viven en 0033b porque Postgres los
-- PROHÍBE dentro de una transacción, y tenerlos en el mismo archivo convertía
-- un `psql -f` inocente en un error a mitad de camino.
--
-- ── Por qué ──────────────────────────────────────────────────────────────
--
-- bucket_snapshot: el AC-2 pide que cada registro del historial diga en qué
-- bucket estaba la cuenta AL MOMENTO de la gestión. Hoy el bucket se deriva en
-- vivo desde cartera-back (buckets-classification.ts), así que una cuenta que
-- subió de B1 a B3 re-etiquetaría retroactivamente todas sus gestiones viejas.
-- Congelarlo en la fila es la única forma de que el historial sea histórico.
-- NULL = desconocido (filas previas a esta migración, o cartera-back no
-- respondió al crear la gestión — la captura es best-effort y jamás bloquea el
-- guardado del asesor). NO hay backfill: reconstruirlo cruzando fecha por fila
-- contra buckets_historial de cartera-back sería caro y aproximado, y es un
-- campo informativo.
--
-- contactos_cobros_audit: el AC-6 pide que no se alteren registros históricos
-- sin auditoría. contactos_cobros es append-only SALVO tres UPDATE (edición
-- manual de promesa CB-029, y dos recálculos de estado_promesa —
-- getEstadoPromesasPago y el job check-promesas-pago). Solo el manual pierde
-- información irrecuperable, por eso guarda snapshot completo; los de sistema
-- guardan solo la transición {de, a} porque estado_promesa es reconstruible
-- desde columnas que ya persisten (es lo que hace evaluarPromesa()).
-- Ver el comentario largo en src/db/schema/cobros.ts para la matriz completa
-- de qué captura y qué NO captura esta tabla.

ALTER TABLE public.contactos_cobros
  ADD COLUMN IF NOT EXISTS bucket_snapshot integer;

-- Dato TÉCNICO (última escritura), no de negocio: lo tocan también los UPDATE
-- de sistema que solo recalculan estado_promesa. La marca de "editado" que ve
-- el usuario sale de contactos_cobros_audit con origen='manual', NO de acá.
ALTER TABLE public.contactos_cobros
  ADD COLUMN IF NOT EXISTS updated_at timestamp;

CREATE TABLE IF NOT EXISTS public.contactos_cobros_audit (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contacto_id         uuid NOT NULL REFERENCES public.contactos_cobros(id) ON DELETE CASCADE,
  caso_cobro_id       uuid NOT NULL REFERENCES public.casos_cobros(id),
  -- 'edicion_promesa' | 'cambio_estado_promesa'. Texto libre a propósito: un
  -- UPDATE futuro sobre contactos_cobros entra sin migración.
  accion              text NOT NULL,
  -- 'manual' | 'sistema_lectura' | 'sistema_job'
  origen              text NOT NULL,
  -- manual: snapshot completo de la fila antes del UPDATE.
  -- sistema: solo {"de": <estado>, "a": <estado>}.
  valores_anteriores  jsonb NOT NULL,
  -- NULL cuando origen != 'manual' — los UPDATE de sistema no tienen usuario.
  editado_por         text REFERENCES public."user"(id),
  editado_en          timestamp NOT NULL DEFAULT now()
);

-- Estos tres van SIN CONCURRENTLY a propósito: contactos_cobros_audit se crea
-- vacía en este mismo archivo, así que no hay filas que indexar ni lock que
-- moleste a nadie.
CREATE INDEX IF NOT EXISTS idx_contactos_audit_contacto
  ON public.contactos_cobros_audit (contacto_id, editado_en DESC);

CREATE INDEX IF NOT EXISTS idx_contactos_audit_caso
  ON public.contactos_cobros_audit (caso_cobro_id);

-- El listado del historial solo pregunta "¿lo editó un humano?" — parcial para
-- que ese lookup no pague por las filas de sistema, que son mayoría.
CREATE INDEX IF NOT EXISTS idx_contactos_audit_manual
  ON public.contactos_cobros_audit (contacto_id)
  WHERE origen = 'manual';
