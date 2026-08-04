-- ============================================================================
-- COBROS-02 · CB-030 — 0007_promesas_pago_espejo
-- ============================================================================
-- Espejo LOCAL de promesas de pago vigentes, sincronizado desde crm-server
-- (la tabla real, `contactos_cobros`, vive en la base de datos del CRM —
-- cartera-back no puede leerla directo, son dos servicios/DBs separados).
--
-- Por qué existe: procesarMoras (latefee.ts) necesita saber, en su propio
-- proceso batch, si un crédito tiene una promesa de pago vigente cubriendo
-- una cuota específica, para congelar SOLO esa cuota (no generarle mora ni
-- subir el bucket) hasta que la promesa venza o se cumpla. Como cartera-back
-- y crm-server son bases de datos distintas, esta tabla es la copia local
-- que crm-server mantiene sincronizada vía push (al crear/resolver una
-- promesa) + un job de reconciliación diario que reenvía el set completo de
-- promesas vigentes antes de que corra procesarMoras.
--
-- Diseño (ver CB-030, apps/cartera-back/src/controllers/latefee.ts):
--   - El freeze es POR CUOTA (cuota_inicio..cuota_fin), nunca el crédito
--     completo — si vence una cuota NO cubierta por la promesa, esa sí
--     cuenta y el bucket puede subir con normalidad.
--   - Al vencer la promesa sin pago, el "salto directo" al bucket real
--     acumulado sale gratis: procesarMoras siempre recalcula cuotasAtrasadas
--     desde fechas reales (nunca incremental), así que basta con dejar de
--     considerar la promesa vigente.
--   - NO hay unique index parcial por credito_id (a diferencia de
--     moras_credito_uq_activa): un crédito puede tener 2+ promesas vigentes
--     cubriendo rangos de cuotas distintos. La unicidad es por
--     contacto_cobros_id (idempotencia del upsert de sync).
--
-- NOTA: Cartera aplica el SQL a mano (no drizzle-kit). Idempotente.
-- Se aplica DESPUÉS de 0000_motor_buckets.sql (requiere `creditos`).
-- ============================================================================

CREATE TABLE IF NOT EXISTS cartera.promesas_pago_espejo (
  promesa_espejo_id serial PRIMARY KEY,
  credito_id integer NOT NULL REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
  -- Id opaco de contactos_cobros (crm-server, otra DB) — sin FK real, solo
  -- clave de idempotencia para el upsert de sync.
  contacto_cobros_id varchar(36) NOT NULL,
  -- null = promesa sin rango de cuotas (ambos o ninguno; el CRM ya lo valida
  -- con un .refine() en el schema de contactos_cobros). Sin rango explícito
  -- no hay nada que congelar por cuota.
  cuota_inicio integer,
  cuota_fin integer,
  incluye_mora boolean NOT NULL DEFAULT false,
  fecha_promesa date NOT NULL,
  activa boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS promesas_pago_espejo_uq_contacto
  ON cartera.promesas_pago_espejo (contacto_cobros_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_promesas_espejo_credito_activa
  ON cartera.promesas_pago_espejo (credito_id, activa);
