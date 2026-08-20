-- ============================================================================
-- D-36 · Registro de reversiones de pago
-- ============================================================================
-- Hoy, en producción, NADIE puede saber qué pagos se revirtieron ni quién lo
-- hizo: `reversePayment` borra las boletas y, si el pago era un parcial con
-- hermanos, la fila entera de `pagos_credito`. No hay log ni tabla. La pregunta
-- "¿qué pasó con este pago que estaba y ya no está?" hoy no tiene respuesta.
--
-- El bot de cobros solo fue la excusa para verlo: necesita distinguir "no se
-- registró" de "se registró y ya lo rechazaron", y sin esta tabla las dos cosas
-- se ven igual — una fila ausente.
--
-- Contrato: docs/features/bot-whatsapp-cobros/DECISIONES.md (D-36)
-- NOTA: se aplica a mano (Cartera no usa drizzle-kit). Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cartera.pagos_reversiones (
  reversion_id             serial PRIMARY KEY,

  -- Las DOS marcas. No es un detalle de implementación, es el diseño:
  --   iniciada   → se empezó a revertir. Se escribe FUERA de la transacción,
  --                así que SOBREVIVE al rollback — a propósito.
  --   completada → se revirtió de verdad. Se escribe DENTRO, al final.
  --   superada   → intento fallido que un reintento posterior ya resolvió.
  --
  -- Una fila que se queda en `iniciada` para siempre ES la alarma: significa
  -- que la mora, el convenio o el inversionista ya se movieron (esos tres
  -- escriben fuera de la transacción) pero el pago no quedó revertido.
  estado                   text NOT NULL DEFAULT 'iniciada',

  -- Sin FK a propósito: la fila de pagos_credito puede desaparecer y este
  -- registro tiene que sobrevivirla. Ese es todo el punto.
  pago_id                  integer NOT NULL,
  credito_id               integer NOT NULL,
  cuota_id                 integer,
  numero_cuota             integer,

  monto                    numeric(18,2),
  mora_devuelta            numeric(18,2),
  validation_status_previo text,
  numero_autorizacion      text,
  banco_id                 integer,

  -- Las boletas que la reversión está por borrar. Es lo que permite buscar
  -- después por la r2_key y saber que ese comprobante existió.
  urls_boletas             text[],

  -- Opcional en v1: la pantalla de conta todavía no pide una razón, así que
  -- la tabla responde "quién y cuándo", no "por qué".
  motivo                   text,

  -- Sale del token, NUNCA del body: un campo de auditoría que llena quien
  -- ejecuta la acción no audita nada.
  usuario_email            text NOT NULL,

  revertido_en             timestamp NOT NULL DEFAULT now(),
  snapshot                 jsonb
);
--> statement-breakpoint

-- No lleva unique por pago_id: varios intentos sobre el mismo pago son
-- legítimos, y el historial de los intentos es parte de lo que se quiere ver.
CREATE INDEX IF NOT EXISTS idx_pagos_reversiones_pago_estado
  ON cartera.pagos_reversiones (pago_id, estado);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_pagos_reversiones_credito
  ON cartera.pagos_reversiones (credito_id);
--> statement-breakpoint

-- El bot busca sus boletas por la r2_key dentro del arreglo de URLs.
CREATE INDEX IF NOT EXISTS idx_pagos_reversiones_urls
  ON cartera.pagos_reversiones USING gin (urls_boletas);
