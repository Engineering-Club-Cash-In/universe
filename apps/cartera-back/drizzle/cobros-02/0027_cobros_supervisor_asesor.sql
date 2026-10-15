-- COBROS-02 · Alta y baja de asesor desde «Mi equipo» (Figma «05 · Alta y Baja
-- de Asesor»). El supervisor de cada asesor de cobros: el correo de su usuario
-- del CRM, el mismo puente que `email_cash_in`. Lo escribe el alta
-- (POST /buckets/asesores/alta) y lo lee el pool (GET /buckets/pool-por-asesor).
-- NULL = sin supervisor asignado (todos los asesores que ya existían).
--
-- Se aplica a mano ANTES de desplegar el cartera-back que la usa (el esquema de
-- Drizzle ya lista la columna: sin ella, los SELECT de `asesores` fallan).
-- Idempotente: se puede correr más de una vez. Solo en la BD local o en DEV,
-- nunca en PROD (COBROS-02 no va a PROD hasta el pase masivo).

ALTER TABLE cartera.asesores
  ADD COLUMN IF NOT EXISTS supervisor_email varchar(150);
--> statement-breakpoint

-- Normalizado como email_cash_in (trim + minúsculas): el CRM cruza por igualdad.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asesores_supervisor_email_normalizado'
      AND conrelid = 'cartera.asesores'::regclass
  ) THEN
    ALTER TABLE cartera.asesores
      ADD CONSTRAINT asesores_supervisor_email_normalizado
      CHECK (supervisor_email IS NULL OR supervisor_email = lower(trim(supervisor_email)));
  END IF;
END $$;
