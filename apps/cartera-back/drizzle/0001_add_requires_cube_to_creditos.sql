ALTER TABLE cartera.creditos
ADD COLUMN IF NOT EXISTS devolucion_cube boolean NOT NULL DEFAULT false;

-- Compatibilidad temporal si ya existía el nombre anterior
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'cartera'
      AND table_name = 'creditos'
      AND column_name = 'requires_cube'
  ) THEN
    ALTER TABLE cartera.creditos RENAME COLUMN requires_cube TO devolucion_cube;
  END IF;
EXCEPTION
  WHEN duplicate_column THEN
    -- Si ya existe devolucion_cube, solo ignora
    NULL;
END $$;
