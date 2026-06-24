-- Catálogo de aseguradoras + enlace del crédito a su aseguradora.
-- El CRM manda siempre 'GyT' o 'Universales'; cartera hace match y, si no
-- existe, la crea (find-or-create). Columna nullable: créditos viejos quedan NULL.
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
