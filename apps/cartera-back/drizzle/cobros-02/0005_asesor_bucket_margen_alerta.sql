-- ============================================================================
-- COBROS-02 · Motor de Buckets — 0005_asesor_bucket_margen_alerta
-- ============================================================================
-- CB-018: margen sobre capacidad_base antes de disparar la alerta de nueva
-- posición. Confirmado con el informador del ticket: la alerta NO debe salir
-- apenas se toca el límite (capacidad_base) sino con un margen encima (ej.
-- límite=100, alerta a partir de 110 = 100 + 10%). El margen es parametrizable
-- por fila (asesor+bucket) como PORCENTAJE o CANTIDAD FIJA, "para que lo
-- parametricen como quieran más adelante" sin tocar código.
--
-- margen_alerta_tipo = 'porcentaje' (default) → margen = capacidad_base * (valor/100)
-- margen_alerta_tipo = 'fijo'                 → margen = valor (cuentas)
-- umbral de alerta = capacidad_base + margen resuelto
--
-- `sobrecarga` (cuentas > capacidad_base, sin margen) NO cambia con esto — es
-- una señal distinta ("ya pasó su cupo nominal") de "alerta_nueva_posicion"
-- ("ya amerita contratar").
--
-- CHECKs (review): margen_alerta_valor negativo invierte el orden de las
-- señales (alerta dispararía ANTES que sobrecarga, contradice el invariante
-- de arriba) — se bloquea a nivel BD. capacidad_base también se protege aquí
-- (>0): con 0 permitido, utilizacion_pct muestra 0% pero sobrecarga/alerta
-- igual disparan true (fila contradictoria en el dashboard). capacidad_base
-- la agregó la migración 0004 (sin CHECK); se corrige acá porque ninguna de
-- las dos migraciones se ha corrido aún.
--
-- NOTA: Cartera aplica el SQL a mano (no drizzle-kit). Idempotente.
-- ============================================================================

ALTER TABLE cartera.asesor_bucket ADD COLUMN IF NOT EXISTS margen_alerta_tipo varchar(16) NOT NULL DEFAULT 'porcentaje';
--> statement-breakpoint

ALTER TABLE cartera.asesor_bucket ADD COLUMN IF NOT EXISTS margen_alerta_valor numeric NOT NULL DEFAULT 10;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'asesor_bucket_margen_alerta_tipo_check'
  ) THEN
    ALTER TABLE cartera.asesor_bucket
      ADD CONSTRAINT asesor_bucket_margen_alerta_tipo_check
      CHECK (margen_alerta_tipo IN ('porcentaje', 'fijo'));
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'asesor_bucket_margen_alerta_valor_check'
  ) THEN
    ALTER TABLE cartera.asesor_bucket
      ADD CONSTRAINT asesor_bucket_margen_alerta_valor_check
      CHECK (margen_alerta_valor >= 0);
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'asesor_bucket_capacidad_base_check'
  ) THEN
    ALTER TABLE cartera.asesor_bucket
      ADD CONSTRAINT asesor_bucket_capacidad_base_check
      CHECK (capacidad_base > 0);
  END IF;
END $$;
