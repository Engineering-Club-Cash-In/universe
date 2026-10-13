-- 🔴 ORDEN DE DESPLIEGUE — esta migración va a producción ANTES que el código.
-- El código lee y escribe estas columnas en `nexa_credit_bindings` (y drizzle
-- las pide en cada SELECT de la tabla, incluido el que valida cada pago de
-- Nexa). Si el código sale primero, los pagos de Nexa fallan con
-- "column ... does not exist" hasta que corra la migración.
--
-- Cuenta Nexa del cliente, guardada en cartera como parte del crédito
--
-- ── CONTEXTO ────────────────────────────────────────────────────────────────
-- La "cuenta Nexa" de un cliente es un token de pago de Banco Nexa ligado a UN
-- crédito: nexa-server lo crea (POST /admin/token-users) y devuelve el token,
-- que es el número que el cliente usa como cuenta destino en su banco
-- (prefijo de Club Cash-In + identificador de 9 dígitos). Hasta hoy nadie lo
-- pedía en código y `nexa_credit_bindings` solo decía "este crédito acepta
-- pagos de Nexa", sin ningún dato del token.
--
-- ── QUÉ AGREGA ──────────────────────────────────────────────────────────────
-- • Los datos del token (`nexa_user_id`, `nexa_identifier`, `nexa_token`) y el
--   DPI con el que se creó (`nexa_national_id`, para poder reintentar sin el
--   CRM).
-- • El seguimiento de la creación automática: `cuenta_solicitada_at` marca las
--   filas que maneja la automatización (las del piloto, insertadas a mano,
--   quedan en NULL y nadie las toca), `cuenta_intentos` y `cuenta_error`.
-- • `cuenta_notificada_at`: cuándo se le avisó al cliente su cuenta, en la
--   bienvenida o en el mensaje aparte. Evita mandarle el aviso dos veces.
--
-- Todas son anulables o con default: las filas existentes no cambian.

ALTER TABLE cartera.nexa_credit_bindings
  ADD COLUMN IF NOT EXISTS nexa_user_id integer,
  ADD COLUMN IF NOT EXISTS nexa_identifier text,
  ADD COLUMN IF NOT EXISTS nexa_token text,
  ADD COLUMN IF NOT EXISTS nexa_national_id text,
  ADD COLUMN IF NOT EXISTS cuenta_solicitada_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS cuenta_intentos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cuenta_error text,
  ADD COLUMN IF NOT EXISTS cuenta_notificada_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- Un token es de un solo crédito.
CREATE UNIQUE INDEX IF NOT EXISTS nexa_credit_bindings_uq_token
  ON cartera.nexa_credit_bindings (nexa_token)
  WHERE nexa_token IS NOT NULL;

-- El barrido de reintentos solo mira las filas de la automatización que aún
-- no tienen token o no se han avisado.
CREATE INDEX IF NOT EXISTS nexa_credit_bindings_idx_cuenta_pendiente
  ON cartera.nexa_credit_bindings (cuenta_solicitada_at)
  WHERE cuenta_solicitada_at IS NOT NULL
    AND (nexa_token IS NULL OR cuenta_notificada_at IS NULL);
