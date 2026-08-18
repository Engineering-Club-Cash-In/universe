-- 0036 · COBROS — Snapshot diario de cumplimiento de Agenda de Cobros
-- ============================================================================
--
-- OBJETIVO
-- Congelar agenda operativa que tenía cada asesor al iniciar día: vencimientos
-- D-0, SLA que vence hoy y promesas de pago para hoy; conservar
-- evidencia de cuáles créditos atendió durante ese mismo día Guatemala.
-- Responde preguntas históricas como: "José tenía 10 créditos planificados,
-- atendió 7 y dejó 3 pendientes" sin recalcular agenda contra estado actual de
-- cartera-back.
--
-- CICLO OPERATIVO
-- A las 00:05 GT, job `jobs/agenda-cobros-snapshots.ts`:
--   1. cierra snapshots del día anterior completo (06:00Z a 06:00Z siguiente);
--   2. busca primer contacto efectivo del asesor original por crédito;
--   3. recalcula atendidos/pendientes y marca snapshot como cerrado;
--   4. captura agenda operativa del día nuevo para asesores con agenda.
--
-- FUENTES Y REGLAS
-- - Agenda: D-0 desde cartera-back `/cuotas/proximas-vencer`; SLA hoy desde
--   `/buckets/cola-dia`; promesas hoy desde `contactos_cobros` mediante misma
--   clasificación compartida de Cola del Día.
-- - Asesor: `user.email` CRM ↔ `email_cash_in` de cartera-back.
-- - Evidencia: `contactos_cobros`, mismo asesor + caso/SIFCO.
-- - Cumplen: contactado, acuerdo_parcial, rechaza_pagar, promesa_pago.
-- - No cumplen: no_contesta, numero_equivocado y contactos automáticos.
-- - Si existen varios contactos efectivos, gana primero cronológicamente.
--
-- APLICACIÓN
-- Espejo manual exacto de `src/db/schema/cobros.ts`. Aplicar manualmente antes
-- de habilitar job. NO usar drizzle-kit push/migrate para esta entrega.
-- Este archivo NO se aplica solo y NO incluye backfill histórico.
--
-- IDEMPOTENCIA
-- DDL usa IF NOT EXISTS y bloque tolerante a enum existente. Runtime también
-- protege `(fecha_gt, asesor_id)` y `(snapshot_id, numero_credito_sifco)` con
-- índices únicos: reintentos no duplican ni reemplazan agenda ya congelada.
--
-- ROLLBACK MANUAL (DESTRUCTIVO; documentado, NO ejecutar automáticamente)
-- Verificar primero que job/API estén apagados y respaldar datos. Luego:
--   DROP TABLE public.agenda_cobros_snapshot_items;
--   DROP TABLE public.agenda_cobros_snapshots;
--   DROP TYPE public.agenda_cobros_snapshot_estado;

-- Estado de ciclo del snapshot: abierto durante día, cerrado después de evaluar
-- contactos del día Guatemala completo.

DO $$
BEGIN
  CREATE TYPE public.agenda_cobros_snapshot_estado AS ENUM ('abierto', 'cerrado');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Cabecera por asesor/día. Totales quedan materializados para reporte rápido;
-- cierre los recalcula desde detalle, nunca confía en valores incrementales.
CREATE TABLE IF NOT EXISTS public.agenda_cobros_snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_gt           date NOT NULL,
  asesor_id          text NOT NULL REFERENCES public."user"(id),
  capturado_en       timestamp NOT NULL DEFAULT now(),
  cerrado_en         timestamp,
  total_planificado  integer NOT NULL,
  total_atendidos    integer NOT NULL DEFAULT 0,
  total_pendientes   integer NOT NULL,
  estado             public.agenda_cobros_snapshot_estado NOT NULL DEFAULT 'abierto'
);

-- Este índice también implementa unicidad requerida por captura idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_snapshots_fecha_asesor_unico
  ON public.agenda_cobros_snapshots (fecha_gt, asesor_id);

-- Crédito planificado congelado. `bucket_snapshot` y `motivo_agenda` describen
-- foto inicial (`D-0`, `sla_hoy` o `promesa_hoy`); campos `atendido_*` guardan primera evidencia efectiva elegida
-- al cierre. `caso_cobro_id` puede ser NULL cuando SIFCO todavía no tiene caso
-- CRM, pero `numero_credito_sifco` siempre identifica crédito.
-- Una promesa pagada se conserva APARTE de `atendido`: es resultado del
-- cliente, no gestión del asesor. Sí cuenta para los totales de cumplimiento
-- (total_atendidos = atendido OR promesa_cumplida, ver cerrarSnapshotsAgenda)
-- — una cuota ya pagada no debe seguir marcada como pendiente aunque nadie
-- haya llamado.
CREATE TABLE IF NOT EXISTS public.agenda_cobros_snapshot_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id            uuid NOT NULL REFERENCES public.agenda_cobros_snapshots(id) ON DELETE CASCADE,
  caso_cobro_id           uuid REFERENCES public.casos_cobros(id),
  numero_credito_sifco    text NOT NULL,
  bucket_snapshot        integer,
  motivo_agenda          text,
  atendido                boolean NOT NULL DEFAULT false,
  contacto_cobro_id      uuid REFERENCES public.contactos_cobros(id) ON DELETE SET NULL,
  atendido_en             timestamp,
  resultado_contacto     public.estado_contacto,
  realizado_por          text REFERENCES public."user"(id),
  promesa_cumplida       boolean NOT NULL DEFAULT false,
  promesa_contacto_cobro_id uuid REFERENCES public.contactos_cobros(id) ON DELETE SET NULL,
  promesa_cumplida_en    timestamp
);

-- Un crédito aparece una sola vez por agenda del asesor, aunque califique por
-- varias fuentes; lógica de captura conserva D-0, luego SLA hoy, luego promesa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_snapshot_items_credito_unico
  ON public.agenda_cobros_snapshot_items (snapshot_id, numero_credito_sifco);

-- Drill-down rápido de atendidos/pendientes dentro de snapshot.
CREATE INDEX IF NOT EXISTS idx_agenda_snapshot_items_estado
  ON public.agenda_cobros_snapshot_items (snapshot_id, atendido);

-- Match y búsqueda transversal por número SIFCO.
CREATE INDEX IF NOT EXISTS idx_agenda_snapshot_items_sifco
  ON public.agenda_cobros_snapshot_items (numero_credito_sifco);

-- Consulta rápida para evidencia separada de promesas cumplidas por pago.
CREATE INDEX IF NOT EXISTS idx_agenda_snapshot_items_promesa_cumplida
  ON public.agenda_cobros_snapshot_items (snapshot_id, promesa_cumplida)
  WHERE promesa_cumplida;
