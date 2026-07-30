-- 0030: CB-026 — Canal SMS en `metodo_contacto`.
-- Espejo exacto del schema drizzle `src/db/schema/cobros.ts`
-- (metodoContactoEnum). Idempotente: seguro de re-correr. Aplicar A MANO (no
-- drizzle-kit push/migrate corrido desde este trabajo — mismo criterio que
-- 0026_cb020_promesa_pago_cuotas.sql / 0028 / 0029; el journal de drizzle-kit
-- está congelado en 0018 y este linaje de migraciones de cobros no pasa por el
-- runner. NO regenerar snapshots con `db:generate`).
--
-- CB-026 pide 3 intentos en 3 canales distintos (WhatsApp, llamada, SMS) para
-- agotar la gestión temprana de una cuenta B1. Los intentos se cuentan desde
-- `contactos_cobros`, registrados A MANO por el asesor — el botón "SMS" del
-- modal (enviarSmsCobros) solo envía y hace toast, no crea fila. Sin este
-- valor no había forma de REGISTRAR un intento por SMS y el canal quedaba
-- permanentemente en cero, haciendo imposible el "3 de 3" del ticket.
--
-- El tipo `public.metodo_contacto` es la columna de CUATRO lugares:
--   contactos_cobros.metodo_contacto
--   notificaciones_cobros.canal
--   seguimientos_programados.metodo_contacto
--   casos_cobros.metodo_contacto_proximo
-- Agregar un valor es ADITIVO para las cuatro: no reescribe tablas, no toma
-- lock exclusivo, no invalida filas existentes, y ninguna tiene CHECK ni
-- índice parcial que enumere los valores. Ningún consumidor hace un switch
-- exhaustivo sin default sobre este enum (getMetodoIcon en web cae a Phone).
--
-- IRREVERSIBLE en la práctica: Postgres no permite quitar un valor de un enum
-- nativo. Revertir exigiría crear un tipo nuevo, migrar las 4 columnas con
-- ALTER TABLE ... TYPE ... USING y reasignar defaults.
--
-- ORDEN DE DESPLIEGUE: aplicar este SQL ANTES de desplegar el web que ofrece
-- la opción SMS en el modal, o el insert revienta con
-- "invalid input value for enum metodo_contacto".

DO $$ BEGIN
  ALTER TYPE "public"."metodo_contacto" ADD VALUE IF NOT EXISTS 'sms';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
