-- ============================================================================
-- COBROS-02 · Asignación crédito ↔ asesor — 0002_credito_asesor
-- ============================================================================
-- "Cartera" del asesor: dentro de un bucket hay VARIOS asesores (pool =
-- asesor_bucket), pero cada crédito lo lleva UN asesor. NO es cola compartida.
--
-- ⚠️ DECISIÓN DE RAÍZ (2026-07-07): la asignación vive en `creditos.asesor_id`.
-- NO se crea tabla de estado aparte. En ESTA base el asesor del crédito ES el
-- cobrador (el vendedor/originación vive en el CRM, no en cartera), así que los
-- reportes por asesor (paymentsByAdvisor, efectividad, embudo) DEBEN seguir al
-- dueño actual: mantener uno viejo acreditaría pagos a quien ya no cobra.
--
-- Cómo funcionará la reasignación (LÓGICA FUTURA, no implementada):
--   · crédito cambia de bucket  → UPDATE cartera.creditos SET asesor_id = <elegible
--     del bucket nuevo> — ÚNICAMENTE ese campo, NADA más del crédito se toca —
--     + INSERT en credito_asesor_historial (la bitácora es OBLIGATORIA).
--   · asesor sale de un bucket  → repartir su cartera (mismo par por crédito).
--   · manual (supervisor/gerente) → mismo par, origen=API_MANUAL + usuario_id + motivo.
-- "Elegibles" = asesor_bucket. Capacidad por asesor+bucket = pieza futura (0003).
--
-- Otras decisiones:
--   · SIN flag "principal" ni multiplicidad: 1 crédito → 1 asesor. El "asesor de
--     apoyo" (2º asesor) será un FILTRO futuro en el listado, no filas/columnas.
--   · El bucket NO se materializa (se deriva de buckets_historial); en la
--     bitácora va solo como SNAPSHOT del momento del cambio.
--
-- NOTA: Cartera aplica el SQL a mano (no drizzle-kit). Idempotente. Pendiente de
-- aplicar en dev/prod. Corresponde al schema en src/database/db/schema.ts.
-- Se aplica DESPUÉS de 0001_buckets_catalogo.sql.
-- ============================================================================

-- Enum: origen del cambio de asignación (automático vs manual del supervisor).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'credito_asesor_origen' AND n.nspname = 'cartera'
  ) THEN
    CREATE TYPE cartera.credito_asesor_origen AS ENUM ('PROCESO_AUTO', 'API_MANUAL');
  END IF;
END$$;
--> statement-breakpoint

-- Bitácora de reasignaciones (append-only) ------------------------------------
-- Auditoría del supervisor: quién llevaba, quién lleva, por qué, cuándo y quién
-- lo hizo. El ESTADO actual no vive aquí: es creditos.asesor_id (ver arriba).
-- usuario_id → platform_users (mismo patrón que moras_historial); NULL cuando
-- origen=PROCESO_AUTO — el caso "sistema" ya lo expresa el enum, no se duplica.
CREATE TABLE IF NOT EXISTS cartera.credito_asesor_historial (
  historial_id     serial PRIMARY KEY,
  credito_id       integer NOT NULL REFERENCES cartera.creditos (credito_id) ON DELETE CASCADE,
  asesor_anterior  integer REFERENCES cartera.asesores (asesor_id) ON DELETE SET NULL,  -- null = 1a asignación (siembra)
  asesor_nuevo     integer REFERENCES cartera.asesores (asesor_id) ON DELETE SET NULL,  -- hoy siempre hay dueño (creditos.asesor_id NOT NULL); nullable por si a futuro existe "desasignar"
  bucket           integer REFERENCES cartera.buckets (numero),                          -- snapshot del bucket al momento
  origen           cartera.credito_asesor_origen NOT NULL DEFAULT 'PROCESO_AUTO',
  motivo           text,
  usuario_id       integer REFERENCES cartera.platform_users (id) ON DELETE SET NULL,    -- quién hizo el cambio (solo API_MANUAL)
  fecha            timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS credito_asesor_hist_credito_idx
  ON cartera.credito_asesor_historial (credito_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS credito_asesor_hist_fecha_idx
  ON cartera.credito_asesor_historial (fecha);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS credito_asesor_hist_asesor_nuevo_idx
  ON cartera.credito_asesor_historial (asesor_nuevo);
