-- Modalidad de Facturación: 3 regímenes fiscales para compra de cartera
-- (P2P Directa / 1 Factura a Cube / 1 Factura a Cube - Pequeño Contribuyente).
-- Vive por OPERACIÓN (creditos_inversionistas_espejo + compras_credito_inversionista),
-- no como atributo global del inversionista: el mismo inversionista puede
-- comprar bajo distinta modalidad en compras distintas, según el monto.
-- Aditiva y retrocompatible: columnas nullable. Decisión de negocio: las
-- compras/participaciones existentes NO se migran, quedan en NULL.
-- NOTA: Cartera aplica el SQL a mano (no drizzle-kit) -- ver 0016/0017.

DO $$ BEGIN
  CREATE TYPE cartera.modalidad_facturacion AS ENUM (
    'p2p_directa',
    'factura_cube',
    'factura_cube_pequeno'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Catálogo fijo de "tasas promocionales" en formato LARGO: una fila por
-- (rango de monto, modalidad). `spread` es el % Inversionista de esa modalidad
-- y `tasa` es lo que ve el cliente. Ambos cambian según la modalidad.
-- Fuente: tabla de finanzas (Excel "Tablas Spread para Facturación
-- Inversionistas"). Si finanzas cambia las tasas, se actualiza a mano.
CREATE TABLE IF NOT EXISTS cartera.modalidad_facturacion_spread (
  id           serial PRIMARY KEY,
  monto_desde  numeric(18, 2) NOT NULL,
  monto_hasta  numeric(18, 2),  -- NULL = sin límite superior
  modalidad    cartera.modalidad_facturacion NOT NULL,
  spread       numeric(18, 10) NOT NULL,
  tasa         numeric(18, 10) NOT NULL,
  created_at   timestamp NOT NULL DEFAULT now(),
  UNIQUE (monto_desde, modalidad)
);

INSERT INTO cartera.modalidad_facturacion_spread
  (monto_desde, monto_hasta, modalidad, spread, tasa)
VALUES
  -- Bracket 1: Q25,000 - Q100,000
  (25000.00,    100000.00,  'p2p_directa',          44.9900793700,  9.0700000000),
  (25000.00,    100000.00,  'factura_cube',         41.8407738100,  8.4351000000),
  (25000.00,    100000.00,  'factura_cube_pequeno', 32.5374681100,  6.5595535710),
  -- Bracket 2: Q100,000.01 - Q250,000
  (100000.01,   250000.00,  'p2p_directa',          60.0198412700, 12.1000000000),
  (100000.01,   250000.00,  'factura_cube',         55.8184523800, 11.2530000000),
  (100000.01,   250000.00,  'factura_cube_pequeno', 43.4072066300,  8.7508928570),
  -- Bracket 3: Q250,000.01 - Q400,000
  (250000.01,   400000.00,  'p2p_directa',          69.9900793700, 14.1100000000),
  (250000.01,   400000.00,  'factura_cube',         65.0907738100, 13.1223000000),
  (250000.01,   400000.00,  'factura_cube_pequeno', 50.6178252600, 10.2045535700),
  -- Bracket 4: Q400,000.01 - Q550,000
  (400000.01,   550000.00,  'p2p_directa',          72.0238095200, 14.5200000000),
  (400000.01,   550000.00,  'factura_cube',         66.9821428600, 13.5036000000),
  (400000.01,   550000.00,  'factura_cube_pequeno', 52.0886479600, 10.5010714300),
  -- Bracket 5: Q550,000.01 - Q700,000
  (550000.01,   700000.00,  'p2p_directa',          75.0000000000, 15.1200000000),
  (550000.01,   700000.00,  'factura_cube',         69.7500000000, 14.0616000000),
  (550000.01,   700000.00,  'factura_cube_pequeno', 54.2410714300, 10.9350000000),
  -- Bracket 6: Q700,000.01 - Q850,000
  (700000.01,   850000.00,  'p2p_directa',          76.9841269800, 15.5200000000),
  (700000.01,   850000.00,  'factura_cube',         71.5952381000, 14.4336000000),
  (700000.01,   850000.00,  'factura_cube_pequeno', 55.6760204100, 11.2242857100),
  -- Bracket 7: Q850,000.01 - Q1,000,000
  (850000.01,  1000000.00,  'p2p_directa',          77.9761904800, 15.7200000000),
  (850000.01,  1000000.00,  'factura_cube',         72.5178571400, 14.6196000000),
  (850000.01,  1000000.00,  'factura_cube_pequeno', 56.3934949000, 11.3689285700),
  -- Bracket 8: Más de Q1,000,000
  (1000000.01,  NULL,       'p2p_directa',          80.0099206300, 16.1300000000),
  (1000000.01,  NULL,       'factura_cube',         74.4092261900, 15.0009000000),
  (1000000.01,  NULL,       'factura_cube_pequeno', 57.8643176000, 11.6654464300)
ON CONFLICT (monto_desde, modalidad) DO NOTHING;

ALTER TABLE cartera.creditos_inversionistas_espejo
  ADD COLUMN IF NOT EXISTS modalidad_facturacion cartera.modalidad_facturacion,
  ADD COLUMN IF NOT EXISTS modalidad_facturacion_spread_id integer
    REFERENCES cartera.modalidad_facturacion_spread(id);

ALTER TABLE cartera.compras_credito_inversionista
  ADD COLUMN IF NOT EXISTS modalidad_facturacion cartera.modalidad_facturacion,
  ADD COLUMN IF NOT EXISTS modalidad_facturacion_spread_id integer
    REFERENCES cartera.modalidad_facturacion_spread(id);
