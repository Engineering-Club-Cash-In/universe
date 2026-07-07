-- ============================================================================
-- COBROS-02 · Motor de Buckets — 0001_buckets_catalogo
-- ============================================================================
-- Convierte el "bucket" (antes int suelto 0-5) en un CATÁLOGO dinámico:
-- nombres, prefijos, rangos de cuotas y estados configurables → filtros full
-- dinámicos sin tocar código. Deriva así:
--   (1) estado fuera del funnel (CANCELADO/EN_CONVENIO/... → lista en código) = sin bucket
--   (2) estado que fuerza un bucket (INCOBRABLE → B5 vía estados_incluidos)
--   (3) rango de cuotas atrasadas (cuotas_min..cuotas_max, max NULL = abierto)
--
-- Además ata las FK de asesor_bucket.bucket y buckets_historial.bucket_(nuevo|anterior)
-- al catálogo. B4 = exactamente 4 cuotas (mora 120); B5 = 5..∞ o INCOBRABLE.
--
-- NOTA: Cartera aplica el SQL a mano (no drizzle-kit). Idempotente. Pendiente de
-- aplicar en dev/prod. Corresponde al schema en src/database/db/schema.ts.
-- Se aplica DESPUÉS de 0000_motor_buckets.sql.
-- ============================================================================

-- Catálogo de buckets --------------------------------------------------------
CREATE TABLE IF NOT EXISTS cartera.buckets (
  numero             integer PRIMARY KEY,                 -- 0-5, clave estable que produce el job
  prefijo            varchar(8)  NOT NULL,                -- "B0".."B5"
  nombre             varchar(64) NOT NULL,                -- "Al día", "Mora 30"...
  descripcion        text,
  cuotas_min         integer NOT NULL,                    -- umbral inferior (inclusive)
  cuotas_max         integer,                             -- superior (inclusive); NULL = abierto (B5)
  estados_incluidos  text[] NOT NULL DEFAULT ARRAY[]::text[],  -- estados que FUERZAN este bucket (INCOBRABLE→B5)
  es_operativo       boolean NOT NULL DEFAULT true,       -- false = fuera del funnel (B5 jurídico)
  orden              integer NOT NULL DEFAULT 0,
  color              varchar(16),
  activo             boolean NOT NULL DEFAULT true,
  created_at         timestamp DEFAULT now(),
  updated_at         timestamp DEFAULT now()
);
--> statement-breakpoint

-- Seed de los 6 buckets (idempotente). B4 = 4 exacto; B5 = 5..∞ o INCOBRABLE.
-- Nombre + descripción (= "Filosofía") según el doc "2. Estructura de Buckets".
-- Los "días de atraso" del doc (0 / 1-30 / 31-60 / 61-90 / 91-120 / 120+) son la
-- etiqueta de negocio; el sistema los mide en CUOTAS (1 cuota ≈ 30 días).
INSERT INTO cartera.buckets
  (numero, prefijo, nombre,                            descripcion,                                                  cuotas_min, cuotas_max, estados_incluidos,          es_operativo, orden, color)
VALUES
  (0, 'B0', 'Cartera Sana',                    'Mantener relación activa; recordatorios preventivos.',       0, 0,    ARRAY[]::text[],            true,  0, '#16a34a'),
  (1, 'B1', 'Alerta Temprana',                 'El cliente quiere pagar; el problema suele ser logístico.',  1, 1,    ARRAY[]::text[],            true,  1, '#84cc16'),
  (2, 'B2', 'Gestión Activa',                  'Diagnosticar causa raíz; proponer plan de pago.',            2, 2,    ARRAY[]::text[],            true,  2, '#eab308'),
  (3, 'B3', 'Rescate',                         'Presión + solución estructurada antes de escalar.',          3, 3,    ARRAY[]::text[],            true,  3, '#f97316'),
  (4, 'B4', 'Última Instancia / Pre Jurídico', 'Acuerdo final o inicio de recuperación del activo.',         4, 4,    ARRAY[]::text[],            true,  4, '#ef4444'),
  (5, 'B5', 'Jurídico',                        'Proceso legal de recuperación vehicular.',                   5, NULL, ARRAY['INCOBRABLE']::text[], false, 5, '#7f1d1d')
ON CONFLICT (numero) DO NOTHING;
--> statement-breakpoint

-- CHECK de rangos: el catálogo es EDITABLE — un rango invertido o negativo haría
-- que bucketDeCredito no matchee y devuelva null EN SILENCIO (indistinguible de
-- "fuera del funnel" → créditos desclasificados sin error). No previene gaps
-- ENTRE filas (p.ej. borrar B2): ese riesgo queda documentado en el README.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'buckets_rango_ck'
  ) THEN
    ALTER TABLE cartera.buckets
      ADD CONSTRAINT buckets_rango_ck CHECK (
        cuotas_min >= 0 AND (cuotas_max IS NULL OR cuotas_max >= cuotas_min)
      );
  END IF;
END$$;
--> statement-breakpoint

-- FK: asesor_bucket.bucket → buckets.numero -----------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'asesor_bucket_bucket_fk'
  ) THEN
    ALTER TABLE cartera.asesor_bucket
      ADD CONSTRAINT asesor_bucket_bucket_fk
      FOREIGN KEY (bucket) REFERENCES cartera.buckets (numero);
  END IF;
END$$;
--> statement-breakpoint

-- FK: buckets_historial.bucket_nuevo → buckets.numero -------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'buckets_historial_bucket_nuevo_fk'
  ) THEN
    ALTER TABLE cartera.buckets_historial
      ADD CONSTRAINT buckets_historial_bucket_nuevo_fk
      FOREIGN KEY (bucket_nuevo) REFERENCES cartera.buckets (numero);
  END IF;
END$$;
--> statement-breakpoint

-- FK: buckets_historial.bucket_anterior → buckets.numero (nullable) -----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'buckets_historial_bucket_anterior_fk'
  ) THEN
    ALTER TABLE cartera.buckets_historial
      ADD CONSTRAINT buckets_historial_bucket_anterior_fk
      FOREIGN KEY (bucket_anterior) REFERENCES cartera.buckets (numero);
  END IF;
END$$;
