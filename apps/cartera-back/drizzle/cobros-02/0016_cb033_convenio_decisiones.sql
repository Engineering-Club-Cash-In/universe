-- CB-033. No ejecutar desde agente: aplicar con flujo normal de migraciones.
--
-- Aprobación de convenios por supervisor. Dos tablas con responsabilidades
-- distintas — no pueden compartir fila:
--
--   1. convenio_operaciones: reclamo idempotente del operacion_id. Se
--      inserta ANTES de conocer el snapshot y el credito_id, y se completa
--      (muta) cuando la operación termina. Es la que absorbe reintentos.
--
--   2. convenio_decisiones: la bitácora real, append-only. Se inserta UNA
--      SOLA VEZ, completa, cuando ya se conoce todo. Nunca se actualiza ni
--      se borra — es el historial que sobrevive aunque el convenio se
--      elimine (el rechazo hace DELETE duro sobre convenios_pago).
--
-- Ver docs/features/cobros-02/06-ficha-360.md §3.5 para el contrato completo.
BEGIN;
SET LOCAL search_path TO cartera;

CREATE TABLE IF NOT EXISTS convenio_operaciones (
  operacion_id uuid PRIMARY KEY,
  request_fingerprint text NOT NULL,
  estado text NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'completada')),
  decision_id integer,
  resultado jsonb,
  creada_en timestamptz NOT NULL DEFAULT now(),
  completada_en timestamptz,

  CONSTRAINT ck_convenio_operaciones_completa CHECK (
    estado <> 'completada'
    OR (decision_id IS NOT NULL AND resultado IS NOT NULL AND completada_en IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS convenio_decisiones (
  decision_id serial PRIMARY KEY,
  operacion_id uuid NOT NULL REFERENCES convenio_operaciones(operacion_id),
  -- Sin FK a convenios_pago: el rechazo borra esa fila y la bitácora tiene
  -- que sobrevivir a ese borrado.
  convenio_id integer NOT NULL,
  credito_id integer NOT NULL REFERENCES creditos(credito_id),
  decision text NOT NULL CHECK (decision IN ('aprobado', 'rechazado')),
  motivo text,
  snapshot_version smallint NOT NULL DEFAULT 1,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  origen text NOT NULL CHECK (origen IN ('crm', 'cartera_front')),

  -- Identidad: SIEMPRE las dos, y la humana SIEMPRE presente. actuado_por
  -- es quien ejecutó de verdad (del JWT); decidido_por_email es la persona
  -- responsable de la decisión (puede ser la misma, o el supervisor que el
  -- CRM nombra cuando el ejecutor es la cuenta de servicio).
  actuado_por integer NOT NULL REFERENCES platform_users(id),
  actuado_por_email varchar(150) NOT NULL,
  decidido_por_email varchar(150) NOT NULL,
  decidido_en timestamptz NOT NULL DEFAULT now(),

  -- Un CHECK que evalúa a NULL PASA en Postgres: hay que descartar NULL
  -- explícitamente, o un motivo NULL en un rechazo pasaría sin frenarse.
  CONSTRAINT ck_convenio_decisiones_motivo CHECK (
    decision <> 'rechazado'
    OR (motivo IS NOT NULL AND length(btrim(motivo)) >= 5)
  ),

  CONSTRAINT uq_convenio_decisiones_operacion UNIQUE (operacion_id)
);

CREATE INDEX IF NOT EXISTS idx_convenio_decisiones_credito
  ON convenio_decisiones (credito_id, decidido_en DESC);
CREATE INDEX IF NOT EXISTS idx_convenio_decisiones_convenio
  ON convenio_decisiones (convenio_id, decidido_en DESC);

-- FK diferida: convenio_operaciones.decision_id referencia una fila que se
-- crea DESPUÉS (paso 5 del servicio, antes del paso 6 que cierra la
-- operación) — ambas dentro de la misma transacción, así que la referencia
-- solo se valida al COMMIT, no en cada sentencia intermedia.
ALTER TABLE convenio_operaciones
  DROP CONSTRAINT IF EXISTS fk_convenio_operaciones_decision;
ALTER TABLE convenio_operaciones
  ADD CONSTRAINT fk_convenio_operaciones_decision
  FOREIGN KEY (decision_id) REFERENCES convenio_decisiones(decision_id)
  DEFERRABLE INITIALLY DEFERRED;

COMMIT;
