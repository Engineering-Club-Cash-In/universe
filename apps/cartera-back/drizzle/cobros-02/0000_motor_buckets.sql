-- ============================================================================
-- COBROS-02 · Motor de Buckets — 0000_motor_buckets
-- ============================================================================
-- Rediseño de cobros (release COBROS-02, aislado, sale en meses). Este archivo
-- crea el MOTOR de buckets: el historial de transiciones + la asignación
-- asesor↔bucket (pool). El "bucket actual" NO se materializa: es derivado de
-- las cuotas atrasadas / estado del crédito (lo calcula el job procesarMoras).
--
-- Buckets: B0=0 cuotas · B1=1 · B2=2 · B3=3 · B4=4 · B5=>=5 (o INCOBRABLE/legal).
--
-- NOTA: Cartera aplica el SQL a mano (no drizzle-kit). Idempotente. Pendiente de
-- aplicar en dev/prod. Corresponde al schema en src/database/db/schema.ts.
-- ============================================================================

-- Enums ----------------------------------------------------------------------
-- Tipo de evento: INICIAL = línea base (primer registro del crédito, punto de
-- partida); SUBIDA = empeora; BAJADA = mejora/cura.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'bucket_evento_tipo' AND n.nspname = 'cartera'
  ) THEN
    CREATE TYPE cartera.bucket_evento_tipo AS ENUM ('INICIAL', 'SUBIDA', 'BAJADA');
  END IF;
END$$;
--> statement-breakpoint
-- Por si el tipo ya existía sin 'INICIAL' (aplicado en una versión previa).
ALTER TYPE cartera.bucket_evento_tipo ADD VALUE IF NOT EXISTS 'INICIAL';
--> statement-breakpoint

-- Origen del evento (hoy siempre PROCESO_AUTO; API_MANUAL para ajustes futuros).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'bucket_evento_origen' AND n.nspname = 'cartera'
  ) THEN
    CREATE TYPE cartera.bucket_evento_origen AS ENUM ('PROCESO_AUTO', 'API_MANUAL');
  END IF;
END$$;
--> statement-breakpoint

-- Asignación asesor ↔ bucket (modelo POOL, muchos-a-muchos) -------------------
-- Un bucket con varios asesores y un asesor en varios buckets.
CREATE TABLE IF NOT EXISTS cartera.asesor_bucket (
  id          serial PRIMARY KEY,
  asesor_id   integer NOT NULL REFERENCES cartera.asesores (asesor_id) ON DELETE CASCADE,
  bucket      integer NOT NULL,                    -- 0-5
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamp DEFAULT now(),
  updated_at  timestamp DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS asesor_bucket_uq
  ON cartera.asesor_bucket (asesor_id, bucket);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS asesor_bucket_bucket_idx
  ON cartera.asesor_bucket (bucket);
--> statement-breakpoint

-- Historial de transiciones de bucket (append-only) --------------------------
-- Solo se registra CUÁNDO cambia el bucket (SUBIDA = empeora, BAJADA = mejora/cura).
-- asesor_id/pago_id = atribución para métricas (sobre todo la BAJADA = cuenta
-- curada). asesor_id se llena cuando el nuevo flujo de pago capture al asesor.
CREATE TABLE IF NOT EXISTS cartera.buckets_historial (
  historial_id             serial PRIMARY KEY,
  credito_id               integer NOT NULL REFERENCES cartera.creditos (credito_id) ON DELETE CASCADE,
  bucket_anterior          integer,                              -- null en el primer registro
  bucket_nuevo             integer NOT NULL,
  tipo_evento              cartera.bucket_evento_tipo NOT NULL,
  origen                   cartera.bucket_evento_origen NOT NULL DEFAULT 'PROCESO_AUTO',
  cuotas_atrasadas_nuevas  integer NOT NULL DEFAULT 0,
  status_credito           text,                                 -- status al momento (traza B5/legal)
  asesor_id                integer REFERENCES cartera.asesores (asesor_id) ON DELETE SET NULL,
  pago_id                  integer REFERENCES cartera.pagos_credito (pago_id) ON DELETE SET NULL,
  motivo                   text,
  fecha                    timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS buckets_historial_fecha_idx
  ON cartera.buckets_historial (fecha);
--> statement-breakpoint
-- Sirve el "último bucket por crédito": DISTINCT ON (credito_id) ORDER BY
-- credito_id, fecha DESC, historial_id DESC (el tiebreaker por historial_id
-- hace determinista el empate de fecha — sin él, dos eventos con el mismo
-- timestamp dejan indefinido el "último" y el motor podría registrar
-- transiciones fantasma). El prefijo (credito_id) cubre las búsquedas por
-- crédito: no hace falta un índice aparte de solo credito_id.
CREATE INDEX IF NOT EXISTS buckets_historial_credito_fecha_idx
  ON cartera.buckets_historial (credito_id, fecha DESC, historial_id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS buckets_historial_asesor_idx
  ON cartera.buckets_historial (asesor_id);
--> statement-breakpoint

-- Garantiza UNA sola línea base (INICIAL) por crédito. Respaldo duro a nivel BD
-- contra la carrera de procesarMoras corriendo en paralelo (varias réplicas) —
-- la misma lección que ya pagó moras_credito (moras_credito_uq_activa).
CREATE UNIQUE INDEX IF NOT EXISTS buckets_historial_uq_inicial
  ON cartera.buckets_historial (credito_id)
  WHERE tipo_evento = 'INICIAL';
--> statement-breakpoint

-- CHECK de coherencia evento ↔ buckets: blinda la bitácora (que alimenta las
-- métricas de incentivos) frente a escritores futuros vía API_MANUAL.
-- Los guards IS NOT NULL son obligatorios: sin ellos, 'SUBIDA' con
-- bucket_anterior NULL evaluaría a NULL y el CHECK lo dejaría pasar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'buckets_historial_evento_coherente_ck'
  ) THEN
    ALTER TABLE cartera.buckets_historial
      ADD CONSTRAINT buckets_historial_evento_coherente_ck CHECK (
        (tipo_evento = 'INICIAL' AND bucket_anterior IS NULL)
        OR (tipo_evento = 'SUBIDA' AND bucket_anterior IS NOT NULL AND bucket_nuevo > bucket_anterior)
        OR (tipo_evento = 'BAJADA' AND bucket_anterior IS NOT NULL AND bucket_nuevo < bucket_anterior)
      );
  END IF;
END$$;
