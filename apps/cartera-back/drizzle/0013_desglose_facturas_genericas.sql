-- Desglose para FACTURAS GENÉRICAS (las que pasan por /facturar-generico, sin pago),
-- para que el reporte diario capture lo facturado genérico (otros ingresos, royalty, etc.).
--   1) ROYALTY como rubro (el royalty REALMENTE facturado; el snapshot lo prioriza
--      sobre creditos.royalti, que queda solo de respaldo para días sin royalty facturado).
--   2) pago_id nullable: las genéricas no tienen pago → se anclan por factura_id.
--   3) categoria: se guarda la del receptor (resuelta por NIT) para poder ubicarlas en la
--      columna de producto del reporte (las genéricas no tienen crédito para derivarla por JOIN).
--   4) unicidad de genéricas por (factura_id, rubro) cuando pago_id IS NULL.
--
-- ADD VALUE IF NOT EXISTS es idempotente (PG10+). Correr/commitear ANTES de desplegar el código.
ALTER TYPE cartera.rubro_facturacion ADD VALUE IF NOT EXISTS 'ROYALTY';

ALTER TABLE cartera.facturacion_desglose ALTER COLUMN pago_id DROP NOT NULL;

ALTER TABLE cartera.facturacion_desglose ADD COLUMN IF NOT EXISTS categoria varchar(100);

CREATE UNIQUE INDEX IF NOT EXISTS uq_facturacion_desglose_factura_rubro
  ON cartera.facturacion_desglose (factura_id, rubro)
  WHERE pago_id IS NULL;
