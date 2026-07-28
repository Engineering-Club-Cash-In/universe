-- 0028: CB-024 — Cierre diario de cobros (snapshot 22:00 GT), detalle por crédito.
-- Espejo exacto del schema drizzle `src/db/schema/cobros.ts`
-- (cierreCreditoTipoEnum, cierreDiarioCreditoCobros).
-- Aplicar A MANO (mismo criterio que 0026_cb020_promesa_pago_cuotas.sql /
-- 0027_cobros_notif_tipo.sql).
--
-- Tabla de DETALLE: una fila por cada contacto real del día (tipo='contacto')
-- MÁS una fila por cada crédito que SALIÓ del bucket del pool del asesor
-- (tipo='subida'/'bajada'), con su ruta bucket_anterior → bucket. Los
-- agregados (efectivos, promesas, subieron, bajaron) se calculan agrupando
-- esta misma tabla — no se guardan aparte.
--
-- El job `generarCierreDiario`:
--   - Paso A (contactos): INSERT ... ON CONFLICT (contacto_id) DO NOTHING
--     — un contacto ya registrado es histórico inmutable, nunca se duplica.
--     `es_efectivo_manual` = el cliente CONTESTÓ (contactado / acuerdo_parcial
--     / rechaza_pagar) y el contacto fue manual del asesor. Categorías
--     EXCLUYENTES: 'promesa_pago' se reporta aparte, no suma como efectivo.
--   - Paso B (movimientos): DELETE + INSERT del día — el bucket de un crédito
--     puede cambiar entre corridas, no hay "contacto" que lo ancle.

DO $$ BEGIN
  CREATE TYPE public.cierre_credito_tipo AS ENUM ('contacto', 'subida', 'bajada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.cierre_diario_credito_cobros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL,
  asesor_id text NOT NULL REFERENCES public."user"(id),
  tipo public.cierre_credito_tipo NOT NULL,

  caso_cobro_id uuid REFERENCES public.casos_cobros(id),
  numero_credito_sifco text,

  -- Solo aplica cuando tipo='contacto'
  contacto_id uuid REFERENCES public.contactos_cobros(id),
  estado_contacto public.estado_contacto,
  es_efectivo_manual boolean NOT NULL DEFAULT false,
  fecha_contacto timestamp,

  -- Solo aplican cuando tipo='subida'/'bajada' — la ruta del movimiento.
  bucket_anterior integer, -- de dónde salió (bucket del pool del asesor)
  bucket integer,          -- a dónde fue

  generado_en timestamp NOT NULL DEFAULT now()
);

-- Idempotencia del Paso A: un mismo contacto nunca se inserta dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cierre_detalle_contacto_unico
  ON public.cierre_diario_credito_cobros (contacto_id)
  WHERE contacto_id IS NOT NULL;

-- Lectura del acordeón (detalle por asesor+rango) y de los agregados por rango.
CREATE INDEX IF NOT EXISTS idx_cierre_detalle_fecha_asesor
  ON public.cierre_diario_credito_cobros (fecha, asesor_id);
