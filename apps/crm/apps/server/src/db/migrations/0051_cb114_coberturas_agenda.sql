-- CB-114. No ejecutar desde agente: aplicar con flujo normal de migraciones.
CREATE TABLE IF NOT EXISTS coberturas_agenda_cobros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titular_id text NOT NULL REFERENCES "user"(id),
  suplente_id text NOT NULL REFERENCES "user"(id),
  motivo text NOT NULL CHECK (motivo IN ('vacaciones', 'permiso')),
  desde date NOT NULL,
  hasta date NOT NULL,
  creada_por text NOT NULL REFERENCES "user"(id),
  cancelada_en timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CHECK (desde <= hasta),
  CHECK (titular_id <> suplente_id)
);

CREATE INDEX IF NOT EXISTS coberturas_agenda_cobros_titular_rango_idx
  ON coberturas_agenda_cobros(titular_id, desde, hasta)
  WHERE cancelada_en IS NULL;
