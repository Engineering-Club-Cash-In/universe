-- Verificacion manual de vehiculos en SAT (Agencia Virtual).
-- Aplicar manualmente en dev y prod.
-- No registrar en meta/_journal.json: drizzle-kit migrate no debe ejecutarla automaticamente.

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
  CREATE TYPE public.sat_lote_estado AS ENUM (
    'en_proceso', 'ok', 'parcial', 'error'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.sat_verificacion_lotes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id            text NOT NULL REFERENCES public."user"(id) ON DELETE RESTRICT,
  usuario_nit           varchar(20) NOT NULL,
  estado                public.sat_lote_estado NOT NULL DEFAULT 'en_proceso',
  intento               integer NOT NULL DEFAULT 1,
  iniciada_at           timestamp NOT NULL DEFAULT now(),
  finalizada_at         timestamp
);

CREATE INDEX IF NOT EXISTS ix_sat_lotes_estado_fecha
  ON public.sat_verificacion_lotes (estado, iniciada_at);
CREATE INDEX IF NOT EXISTS ix_sat_lotes_usuario_id
  ON public.sat_verificacion_lotes (usuario_id);
CREATE INDEX IF NOT EXISTS ix_sat_lotes_usuario
  ON public.sat_verificacion_lotes (usuario_nit);

CREATE TABLE IF NOT EXISTS public.sat_verificacion_corridas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id               uuid NOT NULL REFERENCES public.sat_verificacion_lotes(id) ON DELETE CASCADE,
  titular_nit           varchar(20) NOT NULL,
  titular_nombre        varchar(200) NOT NULL,
  estado                public.sat_corrida_estado NOT NULL DEFAULT 'en_proceso',
  mensaje_error         text
);

CREATE INDEX IF NOT EXISTS ix_sat_corridas_estado
  ON public.sat_verificacion_corridas (estado);
CREATE INDEX IF NOT EXISTS ix_sat_corridas_lote
  ON public.sat_verificacion_corridas (lote_id);
CREATE INDEX IF NOT EXISTS ix_sat_corridas_titular
  ON public.sat_verificacion_corridas (titular_nit);

CREATE TABLE IF NOT EXISTS public.sat_verificacion_resultados (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id        uuid NOT NULL REFERENCES public.sat_verificacion_lotes(id) ON DELETE CASCADE,
  corrida_id     uuid REFERENCES public.sat_verificacion_corridas(id) ON DELETE CASCADE,
  -- El estado actual del vehículo interno desaparece al borrar el vehículo.
  vehicle_id     uuid REFERENCES public.vehicles(id) ON DELETE CASCADE,
  placa          varchar(20) NOT NULL,
  resultado      public.sat_resultado_vehiculo NOT NULL,
  era_esperado   boolean NOT NULL,
  estado_sat     varchar(40),
  tipo           varchar(60),
  marca          varchar(60),
  modelo         varchar(20),
  color          varchar(120),
  impuesto_circulacion_pagado boolean,
  puede_autorizar_traspaso boolean,
  puede_imprimir_tarjeta boolean,
  puede_imprimir_certificado boolean,
  mensaje_error  text,
  consultado_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_sat_resultados_corrida
  ON public.sat_verificacion_resultados (corrida_id);
CREATE INDEX IF NOT EXISTS ix_sat_resultados_lote
  ON public.sat_verificacion_resultados (lote_id);
CREATE INDEX IF NOT EXISTS ix_sat_resultados_placa
  ON public.sat_verificacion_resultados (placa);
CREATE INDEX IF NOT EXISTS ix_sat_resultados_veredicto
  ON public.sat_verificacion_resultados (resultado);
CREATE INDEX IF NOT EXISTS ix_sat_resultados_vehiculo
  ON public.sat_verificacion_resultados (vehicle_id);

-- Una fila actual por vehiculo interno; las placas internas pueden repetirse.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sat_resultados_vehicle_actual
  ON public.sat_verificacion_resultados (vehicle_id)
  WHERE vehicle_id IS NOT NULL;

-- Para vehiculos sin registro interno, la placa normalizada es su identidad.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sat_resultados_placa_sin_vehicle_actual
  ON public.sat_verificacion_resultados
    ((regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g')))
  WHERE vehicle_id IS NULL;
