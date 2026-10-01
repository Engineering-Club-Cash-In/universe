-- Los contratos de inversión emitidos desde el CRM viven en la MISMA tabla de
-- documentos del inversionista, con columnas propias.
--
-- Se hace así y no con una tabla nueva para no tocar lo que ya funciona: el
-- portal y la ficha leen `documentos_inversionista` y siguen leyéndola igual;
-- las columnas nuevas son nulas en toda la papelería que se sube a mano. La
-- pantalla de contratos filtra por `contrato_id`.
--
-- El índice único es parcial: sólo aplica a las filas que son contratos. El
-- espejo se vuelve a mandar cada vez que alguien firma, y sin él iría dejando
-- una copia por firma.
--
-- Idempotente: se puede correr más de una vez sin romper nada.

ALTER TABLE cartera.documentos_inversionista ADD COLUMN IF NOT EXISTS contrato_id varchar(64);
ALTER TABLE cartera.documentos_inversionista ADD COLUMN IF NOT EXISTS tipo_contrato varchar(120);
ALTER TABLE cartera.documentos_inversionista ADD COLUMN IF NOT EXISTS weetrust_document_id varchar(120);
ALTER TABLE cartera.documentos_inversionista ADD COLUMN IF NOT EXISTS observer_url text;
ALTER TABLE cartera.documentos_inversionista ADD COLUMN IF NOT EXISTS firmantes jsonb;
ALTER TABLE cartera.documentos_inversionista ADD COLUMN IF NOT EXISTS estado_firma varchar(20);
ALTER TABLE cartera.documentos_inversionista ADD COLUMN IF NOT EXISTS actualizado_at timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS ux_docs_inversionista_contrato
  ON cartera.documentos_inversionista (contrato_id)
  WHERE contrato_id IS NOT NULL;
