-- CB-114. No ejecutar desde agente: aplicar con flujo normal de migraciones.
BEGIN;
-- Cambiar cartera por cartera_cobros2 si se aplica al sandbox.
SET LOCAL search_path TO cartera;

CREATE TABLE IF NOT EXISTS operaciones_traslado_cartera (
  id uuid PRIMARY KEY,
  idempotency_key text UNIQUE,
  payload_hash text NOT NULL,
  modo text NOT NULL CHECK (modo IN ('traslado_completo', 'redistribucion', 'destino_por_bucket', 'nivelacion')),
  motivo text NOT NULL,
  asesor_origen_id integer NOT NULL REFERENCES asesores(asesor_id),
  actor_email text NOT NULL,
  estado text NOT NULL DEFAULT 'previsualizada' CHECK (estado IN ('previsualizada', 'confirmada', 'fallida')),
  solicitud jsonb NOT NULL,
  preview jsonb NOT NULL,
  vence_en timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operaciones_traslado_cartera_detalle (
  operacion_id uuid NOT NULL REFERENCES operaciones_traslado_cartera(id) ON DELETE CASCADE,
  credito_id integer NOT NULL REFERENCES creditos(credito_id),
  asesor_anterior_id integer REFERENCES asesores(asesor_id),
  asesor_nuevo_id integer NOT NULL REFERENCES asesores(asesor_id),
  bucket integer NOT NULL REFERENCES buckets(numero),
  prioridad smallint NOT NULL CHECK (prioridad IN (0, 1)),
  PRIMARY KEY (operacion_id, credito_id)
);

CREATE INDEX IF NOT EXISTS operaciones_traslado_cartera_origen_idx
  ON operaciones_traslado_cartera(asesor_origen_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operaciones_traslado_cartera_detalle_credito_idx
  ON operaciones_traslado_cartera_detalle(credito_id);

-- También actualiza instalaciones donde CB-114 ya creó la tabla antes de
-- agregarse el modo de asignación manual por bucket.
ALTER TABLE IF EXISTS operaciones_traslado_cartera
  DROP CONSTRAINT IF EXISTS operaciones_traslado_cartera_modo_check;
ALTER TABLE IF EXISTS operaciones_traslado_cartera
  ADD CONSTRAINT operaciones_traslado_cartera_modo_check
  CHECK (modo IN ('traslado_completo', 'redistribucion', 'destino_por_bucket', 'nivelacion'));

-- INCOBRABLE, CANCELADO, PENDIENTE_CANCELACION y CAIDO cambian de responsable
-- sin pertenecer a un bucket operativo.
ALTER TABLE IF EXISTS operaciones_traslado_cartera_detalle
  ALTER COLUMN bucket DROP NOT NULL;
COMMIT;
