-- Snapshot diario tipo Excel "Reuniones diarias" -> hoja Facturación.
-- 1 fila por día (columnas A→BK), congeladas. Money = numeric(18,2).
CREATE TABLE IF NOT EXISTS cartera.facturacion_snapshot_diario (
  id                          serial PRIMARY KEY,
  fecha                       date NOT NULL,
  anio                        integer,
  mes                         integer,

  -- Capital (B–H)
  cap_autocompras             numeric(18,2) NOT NULL DEFAULT 0,
  cap_sobre_vehiculo          numeric(18,2) NOT NULL DEFAULT 0,
  nuevo_cap_autocompras       numeric(18,2) NOT NULL DEFAULT 0,
  cap_hipotecario             numeric(18,2) NOT NULL DEFAULT 0,
  cap_extra_financiamiento    numeric(18,2) NOT NULL DEFAULT 0,
  cap_reestructura            numeric(18,2) NOT NULL DEFAULT 0,
  capital_total               numeric(18,2) NOT NULL DEFAULT 0,

  -- Interés (I–O)
  int_autocompras             numeric(18,2) NOT NULL DEFAULT 0,
  int_sobre_vehiculo          numeric(18,2) NOT NULL DEFAULT 0,
  nuevo_int_autocompras       numeric(18,2) NOT NULL DEFAULT 0,
  int_hipotecario             numeric(18,2) NOT NULL DEFAULT 0,
  int_extra_financiamiento    numeric(18,2) NOT NULL DEFAULT 0,
  int_reestructura            numeric(18,2) NOT NULL DEFAULT 0,
  interes_cube                numeric(18,2) NOT NULL DEFAULT 0,

  -- Membresía (P–V)
  mem_autocompras             numeric(18,2) NOT NULL DEFAULT 0,
  mem_sobre_vehiculo          numeric(18,2) NOT NULL DEFAULT 0,
  nuevo_mem_autocompras       numeric(18,2) NOT NULL DEFAULT 0,
  mem_hipotecario             numeric(18,2) NOT NULL DEFAULT 0,
  mem_extra_financiamiento    numeric(18,2) NOT NULL DEFAULT 0,
  mem_reestructura            numeric(18,2) NOT NULL DEFAULT 0,
  membresia                   numeric(18,2) NOT NULL DEFAULT 0,

  -- Otros ingresos (W–AE)
  oi_autocompras              numeric(18,2) NOT NULL DEFAULT 0,
  oi_sobre_vehiculo           numeric(18,2) NOT NULL DEFAULT 0,
  nuevo_oi_autocompras        numeric(18,2) NOT NULL DEFAULT 0,
  oi_hipotecario              numeric(18,2) NOT NULL DEFAULT 0,
  oi_extra_financiamiento     numeric(18,2) NOT NULL DEFAULT 0,
  oi_reestructura             numeric(18,2) NOT NULL DEFAULT 0,
  otros_ingresos              numeric(18,2) NOT NULL DEFAULT 0,
  administrativos             numeric(18,2) NOT NULL DEFAULT 0,
  otros_cobros                numeric(18,2) NOT NULL DEFAULT 0,

  -- Mora (AF–AL)
  mora_autocompras            numeric(18,2) NOT NULL DEFAULT 0,
  mora_sobre_vehiculo         numeric(18,2) NOT NULL DEFAULT 0,
  nuevo_mora_autocompras      numeric(18,2) NOT NULL DEFAULT 0,
  mora_hipotecario            numeric(18,2) NOT NULL DEFAULT 0,
  mora_extra_financiamiento   numeric(18,2) NOT NULL DEFAULT 0,
  mora_reestructura           numeric(18,2) NOT NULL DEFAULT 0,
  mora_cube                   numeric(18,2) NOT NULL DEFAULT 0,

  -- Royalty (AM–AS)
  roy_autocompras             numeric(18,2) NOT NULL DEFAULT 0,
  roy_sobre_vehiculo          numeric(18,2) NOT NULL DEFAULT 0,
  nuevo_roy_autocompras       numeric(18,2) NOT NULL DEFAULT 0,
  roy_hipotecario             numeric(18,2) NOT NULL DEFAULT 0,
  roy_extra_financiamiento    numeric(18,2) NOT NULL DEFAULT 0,
  roy_reestructura            numeric(18,2) NOT NULL DEFAULT 0,
  royalty                     numeric(18,2) NOT NULL DEFAULT 0,

  -- Totales / acumulados (AT–BE)
  facturacion                 numeric(18,2) NOT NULL DEFAULT 0,
  facturacion_acumulado       numeric(18,2) NOT NULL DEFAULT 0,
  servicios_seguro_gps        numeric(18,2) NOT NULL DEFAULT 0,
  acum_servicios_seguro_gps   numeric(18,2) NOT NULL DEFAULT 0,
  facturacion_mas_servicios   numeric(18,2) NOT NULL DEFAULT 0,
  acumulado_total             numeric(18,2) NOT NULL DEFAULT 0,
  facturacion_inversionistas  numeric(18,2) NOT NULL DEFAULT 0,
  acumulado_inversionistas    numeric(18,2) NOT NULL DEFAULT 0,
  tendencia_fin_mes           numeric(18,2) NOT NULL DEFAULT 0,
  tendencia_semanal           numeric(18,2) NOT NULL DEFAULT 0,
  ingreso_carros              numeric(18,2) NOT NULL DEFAULT 0,
  reserva_acumulada           numeric(18,2) NOT NULL DEFAULT 0,
  semana                      integer,

  -- Metas (BG–BK)
  meta_facturacion_mensual    numeric(18,2) NOT NULL DEFAULT 0,
  meta_facturacion_semanal    numeric(18,2) NOT NULL DEFAULT 0,
  meta_facturacion_diaria     numeric(18,2) NOT NULL DEFAULT 0,
  porcentaje_meta_mensual     numeric(9,4)  NOT NULL DEFAULT 0,
  meta_diaria                 numeric(18,2) NOT NULL DEFAULT 0,

  created_at                  timestamp NOT NULL DEFAULT now(),
  updated_at                  timestamp NOT NULL DEFAULT now()
);

-- 1 fila por día -> permite upsert (regenerar el snapshot del día).
CREATE UNIQUE INDEX IF NOT EXISTS uq_facturacion_snapshot_diario_fecha
  ON cartera.facturacion_snapshot_diario (fecha);
