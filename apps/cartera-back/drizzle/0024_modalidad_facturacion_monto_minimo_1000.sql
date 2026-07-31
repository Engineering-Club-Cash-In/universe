-- Modalidad de Facturación: se amplía el bracket 1 del catálogo de spreads
-- para permitir compras de cartera desde Q1,000 (antes Q25,000). Solo cambia
-- el monto_desde de las 3 filas del bracket 1 (una por modalidad); spread y
-- tasa quedan iguales. Idempotente: tras aplicarse, el WHERE ya no matchea.
-- NOTA: Cartera aplica el SQL a mano (no drizzle-kit) -- ver 0016/0017.

UPDATE cartera.modalidad_facturacion_spread
SET monto_desde = 1000.00
WHERE monto_desde = 25000.00;
