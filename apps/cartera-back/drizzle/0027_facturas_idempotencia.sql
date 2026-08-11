-- Idempotencia de facturación electrónica.
--
-- Motivo (incidente 2026-08-07): el CRM abortó por timeout un POST a
-- /facturar-generico que YA había certificado en SAT y reintentó el mismo POST,
-- así que se emitieron dos facturas idénticas de Q150 al NIT 43254667
-- (99606D3F-2565358216 y 2FCBE7E1-2214019772). Certificar es irreversible:
-- deshacerlo cuesta una anulación en SAT.
--
-- Con esta tabla, /facturar-generico acepta un `idempotency_key` estable por
-- factura lógica (ej. "<opportunityId>-Copia de Llave"):
--   * clave libre         -> se reserva (factura_id NULL) y se certifica;
--   * clave ya con factura -> se devuelve ESA factura, no se emite otra;
--   * clave reservada viva -> 409 (hay otra request facturando lo mismo);
--   * reserva sin factura de más de 10 min -> se considera abandonada
--     (proceso caído a mitad) y la siguiente request la retoma.
--
-- Aditiva: sin `idempotency_key` el endpoint se comporta igual que siempre.
-- NOTA: aplicar a mano en dev y prod (Cartera aplica el SQL a mano, no drizzle-kit).

CREATE TABLE IF NOT EXISTS cartera.facturas_idempotencia (
  idempotency_key varchar(160) PRIMARY KEY,
  factura_id      integer REFERENCES cartera.facturas_electronicas(factura_id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Para ubicar la clave desde la factura (auditoría/soporte).
CREATE INDEX IF NOT EXISTS idx_facturas_idempotencia_factura
  ON cartera.facturas_idempotencia (factura_id);
