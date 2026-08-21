-- El acta del intento de registro de un pago del bot (paso 4, capa B).
--
-- `insertPayment` NO es transaccional y escribe cosas ANTES de la primera fila
-- de `pagos_credito`: la mora (updateMora) y el pago de convenio. Si revienta
-- en esa ventana responde 500 sin que exista pago, boleta ni reversión que lo
-- delate; la reconciliación del bot leería "acá no pasó nada", devolvería el
-- borrador a `leida`, y el reintento aplicaría la boleta completa sobre una
-- mora ya descontada.
--
-- Se escribe `iniciado` antes de la primera mutación (SOLO para pagos del bot:
-- register_by = 'bot-cobros@clubcashin.com') y `completado` al final. Un
-- `iniciado` sin completar es un registro muerto a medias: esa boleta va a
-- revisión manual, nunca a reintento automático.
--
-- Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§4.1)

CREATE TABLE IF NOT EXISTS cartera.pagos_intentos_boleta (
  intento_id     serial PRIMARY KEY,
  estado         text NOT NULL DEFAULT 'iniciado',
  credito_id     integer NOT NULL,
  register_by    text NOT NULL,
  monto_boleta   numeric(18,2),
  urls_boletas   text[] NOT NULL,
  creado_en      timestamp NOT NULL DEFAULT now(),
  completado_en  timestamp
);

CREATE INDEX IF NOT EXISTS idx_pagos_intentos_credito_estado
  ON cartera.pagos_intentos_boleta (credito_id, estado);

-- La reconciliación busca por URL, igual que en boletas y reversiones.
CREATE INDEX IF NOT EXISTS idx_pagos_intentos_urls
  ON cartera.pagos_intentos_boleta USING gin (urls_boletas);
