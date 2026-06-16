-- Lock por fila + auditoría para edición manual del snapshot diario.
ALTER TABLE cartera.facturacion_snapshot_diario
  ADD COLUMN IF NOT EXISTS bloqueado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bloqueado_por integer,
  ADD COLUMN IF NOT EXISTS bloqueado_at timestamp;

CREATE TABLE IF NOT EXISTS cartera.facturacion_snapshot_auditoria (
  id serial PRIMARY KEY,
  fecha date NOT NULL,
  columna varchar(100) NOT NULL,
  valor_anterior text,
  valor_nuevo text,
  accion varchar(20) NOT NULL,
  usuario_id integer,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshot_auditoria_fecha
  ON cartera.facturacion_snapshot_auditoria (fecha);
CREATE INDEX IF NOT EXISTS idx_snapshot_auditoria_created
  ON cartera.facturacion_snapshot_auditoria (created_at);
