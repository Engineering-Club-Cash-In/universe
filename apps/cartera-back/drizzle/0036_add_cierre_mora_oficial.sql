CREATE TABLE IF NOT EXISTS cartera.cierre_mora_oficial (
  id serial PRIMARY KEY,
  periodo date NOT NULL,
  asesor_id integer NOT NULL REFERENCES cartera.asesores(asesor_id),
  asesor_nombre text NOT NULL,
  capital_cierre numeric(18, 2) NOT NULL CHECK (capital_cierre >= 0),
  capital_mora_30 numeric(18, 2) NOT NULL DEFAULT 0 CHECK (capital_mora_30 >= 0),
  capital_mora_60 numeric(18, 2) NOT NULL DEFAULT 0 CHECK (capital_mora_60 >= 0),
  capital_mora_90 numeric(18, 2) NOT NULL DEFAULT 0 CHECK (capital_mora_90 >= 0),
  capital_mora_120 numeric(18, 2) NOT NULL DEFAULT 0 CHECK (capital_mora_120 >= 0),
  cantidad_mora_30 integer NOT NULL DEFAULT 0 CHECK (cantidad_mora_30 >= 0),
  cantidad_mora_60 integer NOT NULL DEFAULT 0 CHECK (cantidad_mora_60 >= 0),
  cantidad_mora_90 integer NOT NULL DEFAULT 0 CHECK (cantidad_mora_90 >= 0),
  cantidad_mora_120 integer NOT NULL DEFAULT 0 CHECK (cantidad_mora_120 >= 0),
  fecha_corte timestamp with time zone NOT NULL,
  regla_version text NOT NULL,
  fuente text NOT NULL,
  fuente_hash text NOT NULL CHECK (fuente_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT cierre_mora_oficial_periodo_asesor_unique UNIQUE (periodo, asesor_id),
  CONSTRAINT cierre_mora_oficial_periodo_primer_dia CHECK (periodo = date_trunc('month', periodo)::date),
  CONSTRAINT cierre_mora_oficial_mora_dentro_capital CHECK (
    capital_mora_30 + capital_mora_60 + capital_mora_90 + capital_mora_120 <= capital_cierre
  ),
  CONSTRAINT cierre_mora_oficial_corte_en_periodo_gt CHECK (
    date_trunc('month', fecha_corte AT TIME ZONE 'America/Guatemala')::date = periodo
  )
);

CREATE OR REPLACE FUNCTION cartera.prevent_cierre_mora_oficial_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'cierre_mora_oficial es inmutable';
END;
$$;

DROP TRIGGER IF EXISTS cierre_mora_oficial_inmutable
  ON cartera.cierre_mora_oficial;
CREATE TRIGGER cierre_mora_oficial_inmutable
  BEFORE UPDATE OR DELETE ON cartera.cierre_mora_oficial
  FOR EACH ROW
  EXECUTE FUNCTION cartera.prevent_cierre_mora_oficial_mutation();
