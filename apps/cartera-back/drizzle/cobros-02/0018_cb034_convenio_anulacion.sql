-- COBROS-02 · Fase 3 — DESHACER un convenio: soft delete, no borrado.
--
-- Hasta hoy la única forma de "quitar" un convenio era RECHAZARLO en la cola de
-- aprobación, y eso hace un DELETE duro sobre `convenios_pago`, `convenio_cuotas`
-- y el pivot de pagos (ver convenioDecision.ts). Para un convenio ya APROBADO
-- —uno que el cliente firmó y dejó de pagar— borrar no sirve: se pierde el
-- acuerdo, su plan de cuotas y la traza de lo que sí pagó. La decisión 10 del
-- plan 08 lo dice directo: deshacer es soft delete.
--
-- Ojo con el estado que queda. Un convenio anulado tiene `activo=false` y
-- `completado=false`, que es EXACTAMENTE la firma de "pendiente de aprobación"
-- (CB-033). Sin la marca de abajo, un convenio deshecho reaparecería en la cola
-- del supervisor y "aprobarlo" lo resucitaría. Por eso `anulado_at` no es
-- decorativo: es lo que distingue los dos estados, y toda consulta de pendientes
-- tiene que filtrarlo.

ALTER TABLE cartera.convenios_pago
  ADD COLUMN IF NOT EXISTS anulado_at timestamp with time zone;
--> statement-breakpoint

-- Quién lo deshizo. Sin FK obligatoria: un convenio anulado por un proceso o
-- por una cuenta que después se borra sigue siendo un convenio anulado.
ALTER TABLE cartera.convenios_pago
  ADD COLUMN IF NOT EXISTS anulado_por integer REFERENCES cartera.platform_users (id);
--> statement-breakpoint

-- Por qué. Obligatorio a nivel de aplicación (mismo criterio que el motivo de
-- rechazo): deshacer un acuerdo firmado es una decisión que tiene que poder
-- responder por sí misma.
ALTER TABLE cartera.convenios_pago
  ADD COLUMN IF NOT EXISTS motivo_anulacion text;
--> statement-breakpoint

-- Coherencia: o están los tres datos de la anulación, o no está ninguno. Sin
-- esto, un UPDATE parcial deja un convenio "anulado" sin motivo ni responsable,
-- que es justo lo que el soft delete vino a evitar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'convenios_pago_anulacion_coherente_ck'
       AND conrelid = 'cartera.convenios_pago'::regclass
  ) THEN
    ALTER TABLE cartera.convenios_pago
      ADD CONSTRAINT convenios_pago_anulacion_coherente_ck CHECK (
        (anulado_at IS NULL AND anulado_por IS NULL AND motivo_anulacion IS NULL)
        OR (anulado_at IS NOT NULL AND motivo_anulacion IS NOT NULL)
      );
  END IF;
END$$;
--> statement-breakpoint

-- La cola de aprobación consulta activo=false AND completado=false: este índice
-- parcial la sirve ya descartando los anulados.
CREATE INDEX IF NOT EXISTS convenios_pago_pendientes_idx
  ON cartera.convenios_pago (credito_id)
  WHERE activo = false AND completado = false AND anulado_at IS NULL;
