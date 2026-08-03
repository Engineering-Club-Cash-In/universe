-- 0032: CB-029 — Alerta programada de promesas + tipo de notificación por vencer.
-- Espejo exacto del schema drizzle (`contactos_cobros.fecha_alerta` en
-- src/db/schema/cobros.ts y el enum `cobros_notif_tipo` en
-- src/db/schema/notifications.ts). Idempotente: seguro de re-correr. Aplicar A
-- MANO (no drizzle-kit push/migrate — mismo criterio que 0026..0031).
--
-- fecha_alerta: "avisarme el…" de la promesa (default D-1, editable). El job
-- check-promesas-pago crea la notificación promesa_por_vencer cuando cae hoy.
--
-- promesa_por_vencer: recordatorio proactivo al asesor ANTES de que la promesa
-- venza (solo asesor, no escala a supervisor).

ALTER TABLE public.contactos_cobros
  ADD COLUMN IF NOT EXISTS fecha_alerta timestamp;

-- ADD VALUE no corre dentro de una transacción en Postgres viejo — este archivo
-- se aplica suelto (autocommit), no dentro de un BEGIN…COMMIT.
ALTER TYPE public.cobros_notif_tipo ADD VALUE IF NOT EXISTS 'promesa_por_vencer';
