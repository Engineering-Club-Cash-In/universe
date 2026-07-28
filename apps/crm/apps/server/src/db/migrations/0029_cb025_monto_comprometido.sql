-- 0029: CB-025 — Monto comprometido y Próximo Paso en el historial de contactos.
-- Espejo exacto del schema drizzle `src/db/schema/cobros.ts` (contactosCobros).
-- Idempotente: seguro de re-correr. Aplicar A MANO (no drizzle-kit push/migrate
-- corrido desde este trabajo — mismo criterio que 0026_cb020_promesa_pago_cuotas.sql).
--
-- monto_comprometido: campo puramente informativo. NO participa en
-- evaluarPromesa (lib/promesa-pago.ts) — cumplida/incumplida sigue
-- derivándose solo de cuota_inicio/cuota_fin/incluye_mora contra
-- cartera-back. Opcional: las promesas ya existentes (sin monto) siguen
-- siendo válidas.
--
-- proximo_paso: qué hacer en el próximo contacto (fecha_proximo_contacto solo
-- dice CUÁNDO, no QUÉ). Texto libre a propósito — el AC de CB-025 pide
-- "próximo paso" sin catálogo cerrado, y ya hay un catálogo pendiente de
-- negocio (estado_contacto, ver nota en el schema) — no sumar un segundo
-- enum sin decisión de negocio detrás.

ALTER TABLE public.contactos_cobros
  ADD COLUMN IF NOT EXISTS monto_comprometido numeric(12,2);

ALTER TABLE public.contactos_cobros
  ADD COLUMN IF NOT EXISTS proximo_paso text;
