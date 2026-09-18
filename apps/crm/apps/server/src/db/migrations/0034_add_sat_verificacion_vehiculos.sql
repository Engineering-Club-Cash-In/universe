-- Verificacion automatica de vehiculos en SAT (Agencia Virtual).
-- Aplicar manualmente en dev y prod.

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
  nit                   varchar(20) NOT NULL,
  estado                public.sat_corrida_estado NOT NULL DEFAULT 'en_proceso',
  origen                public.sat_origen_ejecucion NOT NULL DEFAULT 'cron',
  intento               integer NOT NULL DEFAULT 1,
  corrida_original_id   uuid,
  total_esperados       integer NOT NULL DEFAULT 0,
  total_reportados_sat  integer NOT NULL DEFAULT 0,
  total_alertas         integer NOT NULL DEFAULT 0,
  mensaje_error         text,
  evidencia             text,
  iniciada_at           timestamp NOT NULL DEFAULT now(),
  finalizada_at         timestamp
);

CREATE INDEX IF NOT EXISTS ix_sat_corridas_estado_fecha
  ON public.sat_verificacion_corridas (estado, iniciada_at);
CREATE INDEX IF NOT EXISTS ix_sat_corridas_nit
  ON public.sat_verificacion_corridas (nit);

CREATE TABLE IF NOT EXISTS public.sat_verificacion_resultados (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corrida_id     uuid NOT NULL REFERENCES public.sat_verificacion_corridas(id) ON DELETE CASCADE,
  vehicle_id     uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
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
  created_at     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_sat_resultados_corrida
  ON public.sat_verificacion_resultados (corrida_id);
CREATE INDEX IF NOT EXISTS ix_sat_resultados_placa
  ON public.sat_verificacion_resultados (placa);
CREATE INDEX IF NOT EXISTS ix_sat_resultados_veredicto
  ON public.sat_verificacion_resultados (resultado);
CREATE INDEX IF NOT EXISTS ix_sat_resultados_vehiculo
  ON public.sat_verificacion_resultados (vehicle_id);
