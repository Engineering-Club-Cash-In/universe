-- Datos nuevos solamente: no inferimos hechos históricos desde el estado actual.
DO $$ BEGIN
  CREATE TYPE cartera.tipo_compra AS ENUM (
    'nueva_posicion', 'ampliacion_posicion', 'sin_clasificar'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE cartera.compras_credito_inversionista
  ADD COLUMN IF NOT EXISTS tipo_compra cartera.tipo_compra
  NOT NULL DEFAULT 'sin_clasificar';

CREATE OR REPLACE FUNCTION cartera.proteger_tipo_compra()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tipo_compra IS DISTINCT FROM OLD.tipo_compra THEN
    RAISE EXCEPTION 'tipo_compra es inmutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_tipo_compra
  ON cartera.compras_credito_inversionista;
CREATE TRIGGER trg_proteger_tipo_compra
BEFORE UPDATE ON cartera.compras_credito_inversionista
FOR EACH ROW EXECUTE FUNCTION cartera.proteger_tipo_compra();

ALTER TABLE cartera.liquidaciones
  ADD COLUMN IF NOT EXISTS tipo_reinversion_snapshot cartera.tipo_reinversion,
  ADD COLUMN IF NOT EXISTS modalidad_facturacion_snapshot cartera.modalidad_facturacion;

ALTER TABLE cartera.historico_liquidaciones_espejo
  ADD COLUMN IF NOT EXISTS tipo_reinversion_snapshot cartera.tipo_reinversion,
  ADD COLUMN IF NOT EXISTS modalidad_facturacion_snapshot cartera.modalidad_facturacion,
  ADD COLUMN IF NOT EXISTS capital_liquidado NUMERIC(18, 8),
  ADD COLUMN IF NOT EXISTS capital_restante NUMERIC(18, 8);
