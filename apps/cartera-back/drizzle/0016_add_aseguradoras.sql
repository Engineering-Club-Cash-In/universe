-- Catálogo de aseguradoras + enlace del crédito a su aseguradora.
-- Aditiva y retrocompatible: columna nullable, créditos viejos quedan NULL.
-- NOTA: ya aplicada manualmente en dev y prod (2026-06-24); este archivo la
-- documenta para entornos nuevos. Cartera aplica el SQL a mano (no drizzle-kit).
CREATE TABLE IF NOT EXISTS cartera.aseguradoras (
  id serial PRIMARY KEY,
  nombre varchar(100) NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE cartera.creditos
  ADD COLUMN IF NOT EXISTS aseguradora_id integer REFERENCES cartera.aseguradoras(id);

-- Aseguradoras conocidas (idempotente).
INSERT INTO cartera.aseguradoras (nombre)
VALUES ('Universales'), ('GyT')
ON CONFLICT (nombre) DO NOTHING;
