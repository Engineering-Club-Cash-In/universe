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

-- 1) La clave vive TAMBIÉN en la factura, escrita en el mismo INSERT que la
--    certificación. Es la fuente de verdad de "esta factura lógica ya se
--    emitió": si el UPDATE de confirmación de abajo fallara (timeout, deadlock),
--    la clave igual quedó pegada a la factura y la siguiente request la
--    encuentra en vez de emitir otra.
--    SIN unique a propósito: si alguna vez se colara un duplicado, preferimos
--    tenerlo en la BD (visible y anulable) antes que un INSERT rechazado que
--    deje la factura "en SAT pero no en la BD".
ALTER TABLE cartera.facturas_electronicas
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(160);

CREATE INDEX IF NOT EXISTS idx_facturas_electronicas_idempotency_key
  ON cartera.facturas_electronicas (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 2) Tabla de reservas: resuelve la carrera entre dos requests concurrentes que
--    todavía no insertaron nada (el candado de arriba solo existe una vez que
--    la factura está en la BD).
CREATE TABLE IF NOT EXISTS cartera.facturas_idempotencia (
  idempotency_key varchar(160) PRIMARY KEY,
  factura_id      integer REFERENCES cartera.facturas_electronicas(factura_id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 3) Reservas EN DUDA: el DTE se certificó en SAT pero la request murió antes de
--    guardar la factura (parseo del XML, caída de la BD). No hay fila en
--    facturas_electronicas, así que el candado de arriba no la puede encontrar.
--    Estas reservas NO se pueden retomar por antigüedad: hacerlo dejaría que un
--    reintento emitiera una segunda factura en SAT. Quedan trabadas hasta
--    conciliación manual.
--
--    Para destrabar una:
--      * si SAT SÍ la emitió -> reconstruir la factura con el script
--        backfill-facturas-faltantes y dejarle su idempotency_key (con eso el
--        lookup la encuentra y ya no hace falta tocar esta tabla);
--      * si SAT NO la emitió -> borrar la fila:
--        DELETE FROM cartera.facturas_idempotencia WHERE idempotency_key = '...';
ALTER TABLE cartera.facturas_idempotencia
  ADD COLUMN IF NOT EXISTS en_duda_sat boolean NOT NULL DEFAULT false;

ALTER TABLE cartera.facturas_idempotencia
  ADD COLUMN IF NOT EXISTS detalle text;

-- Para ubicar la clave desde la factura (auditoría/soporte).
CREATE INDEX IF NOT EXISTS idx_facturas_idempotencia_factura
  ON cartera.facturas_idempotencia (factura_id);
