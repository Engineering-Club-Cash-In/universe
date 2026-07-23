-- 0027: COBROS-02 — Enum específico de notificaciones de cobros + columna.
-- Espejo exacto del schema drizzle `src/db/schema/notifications.ts`.
-- Idempotente: seguro de re-correr. Aplicar A MANO (no drizzle-kit push/migrate
-- corrido desde este trabajo — mismo criterio que 0026_cb020_promesa_pago_cuotas.sql).
--
-- Los jobs de cobros clasifican sus notificaciones en `cobros_tipo` (columna
-- propia, NO en `type`, que es general del CRM). Toda otra notificación la deja
-- NULL. La web pinta cada tarjeta de un color distinto según este valor:
--   promesa_incumplida → una promesa venció con la(s) cuota(s) aún pendiente(s)
--   cliente_subido     → el crédito acaba de subir de bucket (aviso al asesor)
--   sin_contacto_3d    → 3 días hábiles en el bucket sin registro de contacto

DO $$ BEGIN
  CREATE TYPE public.cobros_notif_tipo AS ENUM ('promesa_incumplida', 'cliente_subido', 'sin_contacto_3d');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS cobros_tipo public.cobros_notif_tipo;
