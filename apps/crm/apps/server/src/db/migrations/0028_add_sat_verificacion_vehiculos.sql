-- Verificación automática de vehículos en SAT (Agencia Virtual).
--
-- El scraper vive en cartera-back (ahí está Chromium configurado); los
-- resultados viven acá porque es donde está `vehicles` y el cruce se resuelve
-- con un JOIN local en vez de una llamada de red.
--
-- Dos tablas:
--   sat_verificacion_corridas   -> bitácora de ejecución, una fila por intento
--   sat_verificacion_resultados -> una fila por vehículo por corrida
--
-- Las filas con era_esperado = true SON la foto del universo consultado en esa
-- corrida: no hace falta una tabla aparte para el universo.
--
-- NOTA: aplicar a mano en dev y prod.
-- El esquema va explícito: el search_path de estas conexiones es
-- `cartera, buro, neondb_owner` y sin prefijo las tablas caen en `buro`.

DO $$ BEGIN
  CREATE TYPE public.sat_corrida_estado AS ENUM (
    'en_proceso', 'ok', 'error', 'codigo_requerido', 'bloqueado'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sat_resultado_vehiculo AS ENUM (
    'activo_ok', 'inactivo', 'no_aparece_en_sat', 'no_registrado_interno'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sat_origen_ejecucion AS ENUM ('cron', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.sat_verificacion_corridas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nit                   varchar(20)          NOT NULL,
  estado                public.sat_corrida_estado   NOT NULL DEFAULT 'en_proceso',
  origen                public.sat_origen_ejecucion NOT NULL DEFAULT 'cron',
  intento               integer              NOT NULL DEFAULT 1,
  corrida_original_id   uuid,
  total_esperados       integer              NOT NULL DEFAULT 0,
  total_reportados_sat  integer              NOT NULL DEFAULT 0,
  total_alertas         integer              NOT NULL DEFAULT 0,
  mensaje_error         text,
  evidencia             text,
  iniciada_at           timestamp            NOT NULL DEFAULT now(),
  finalizada_at         timestamp
);

-- Soporta la consulta anti-duplicados: "hubo una corrida ok reciente?"
CREATE INDEX IF NOT EXISTS ix_sat_corridas_estado_fecha
  ON public.sat_verificacion_corridas (estado, iniciada_at);
CREATE INDEX IF NOT EXISTS ix_sat_corridas_nit
  ON public.sat_verificacion_corridas (nit);

CREATE TABLE IF NOT EXISTS public.sat_verificacion_resultados (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corrida_id     uuid                   NOT NULL REFERENCES public.sat_verificacion_corridas(id) ON DELETE CASCADE,
  -- Nulo cuando SAT reporta una placa que el CRM no tiene registrada.
  vehicle_id     uuid                   REFERENCES public.vehicles(id) ON DELETE SET NULL,
  placa          varchar(20)            NOT NULL,
  resultado      public.sat_resultado_vehiculo NOT NULL,
  era_esperado   boolean                NOT NULL,
  estado_sat     varchar(40),
  tipo           varchar(60),
  marca          varchar(60),
  modelo         varchar(20),
  color          varchar(120),
  mensaje_error  text,
  created_at     timestamp              NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_sat_resultados_corrida
  ON public.sat_verificacion_resultados (corrida_id);
CREATE INDEX IF NOT EXISTS ix_sat_resultados_placa
  ON public.sat_verificacion_resultados (placa);
CREATE INDEX IF NOT EXISTS ix_sat_resultados_veredicto
  ON public.sat_verificacion_resultados (resultado);
CREATE INDEX IF NOT EXISTS ix_sat_resultados_vehiculo
  ON public.sat_verificacion_resultados (vehicle_id);
