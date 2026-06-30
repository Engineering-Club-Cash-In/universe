-- Flag para excluir asesores del balanceo de carga al crear créditos.
-- Reemplaza el hardcode `nombre != 'Gerencia'` de getAsesorConMenorCarga por un
-- booleano configurable por asesor. Aditiva y retrocompatible (default true).
-- NOTA: ya aplicada manualmente en dev y prod (2026-06-30); este archivo la
-- documenta para entornos nuevos. Cartera aplica el SQL a mano (no drizzle-kit).

ALTER TABLE cartera.asesores
  ADD COLUMN IF NOT EXISTS activo_para_creditos boolean NOT NULL DEFAULT true;

-- Gerencia es el asesor "bucket" (créditos CRM sin asignar): NO recibe créditos por
-- balanceo. Sin este backfill la columna quedaría en true para todos y Gerencia
-- volvería a entrar al balanceo (regresión del viejo `!= 'Gerencia'`).
UPDATE cartera.asesores SET activo_para_creditos = false WHERE nombre = 'Gerencia';

-- Espejo en public (si existe en este entorno): mismo cambio, idempotente.
DO $$
BEGIN
  IF to_regclass('public.asesores') IS NOT NULL THEN
    ALTER TABLE public.asesores
      ADD COLUMN IF NOT EXISTS activo_para_creditos boolean NOT NULL DEFAULT true;
    UPDATE public.asesores SET activo_para_creditos = false WHERE nombre = 'Gerencia';
  END IF;
END$$;
