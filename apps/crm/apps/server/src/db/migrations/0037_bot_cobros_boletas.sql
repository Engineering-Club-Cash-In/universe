-- 0037 · BOT DE COBROS — Boletas de pago que suben los clientes por WhatsApp
-- ============================================================================
--
-- OBJETIVO
-- Guardar el borrador de cada boleta que un cliente sube por el bot, y dejar
-- amarrado ese borrador con los pagos que cartera crea al confirmarlo. Cuando
-- contabilidad valide o revierta el pago 48213, cartera nos avisa con ese
-- número y nada más: sin estas tablas no habría forma de saber de qué cliente
-- era, a qué teléfono escribirle, ni siquiera que el pago vino del bot.
--
-- CONTRATO
-- docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§10)
--
-- POR QUÉ `otp_id` VA CON SET NULL Y NO CON CASCADE
-- Con CASCADE, purgar un OTP vencido —o borrar el lead, que ya cascadea hacia
-- `otps`— se llevaría también la boleta CONFIRMADA. Y ahí se rompe el resto:
-- el aviso de contabilidad llegaría con un pago_id que ya no tiene fila, el
-- CRM lo leería como "no es del bot" y el cliente nunca sabría que su pago se
-- acreditó, aunque el pago exista y esté bien en cartera. Por eso la boleta
-- guarda además su propia identidad (lead_id / co_debtor_id).
--
-- POR QUÉ boleta → pagos ES 1:N
-- `newPayment` recorre las cuotas pendientes mientras le quede dinero y crea o
-- actualiza UNA fila de pagos_credito POR CUOTA. Una boleta que cubre tres
-- cuotas atrasadas son tres pagos, cada uno con su pago_id.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "bot_cobros_boletas" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "otp_id"                uuid REFERENCES "otps"("id") ON DELETE SET NULL,
  "lead_id"               uuid REFERENCES "leads"("id") ON DELETE SET NULL,
  "co_debtor_id"          uuid REFERENCES "co_debtors"("id") ON DELETE SET NULL,
  "numero_sifco"          text NOT NULL,
  "credito_id"            integer,
  "intento"               integer NOT NULL,
  "imagen_origen_url"     text NOT NULL,
  "r2_key"                text,
  "hash_imagen"           text,
  "lectura"               jsonb NOT NULL,
  "banco_id"              integer,
  "monto"                 numeric(12, 2),
  "fecha_boleta"          date,
  "numero_autorizacion"   text,
  "cuenta_destino"        text,
  "confianza"             text,
  "estado"                text NOT NULL,
  "motivo_fallo"          text,
  "confirmando_desde"     timestamp with time zone,
  "notificado_cliente_at" timestamp with time zone,
  "expira_en"             timestamp with time zone NOT NULL,
  "created_at"            timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"            timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "bot_cobros_boletas_otp_idx"    ON "bot_cobros_boletas" ("otp_id");
CREATE INDEX IF NOT EXISTS "bot_cobros_boletas_estado_idx" ON "bot_cobros_boletas" ("estado");
-- Para el control de duplicados por foto (§9): la misma imagen mandada dos veces.
CREATE INDEX IF NOT EXISTS "bot_cobros_boletas_hash_idx"   ON "bot_cobros_boletas" ("hash_imagen");

CREATE TABLE IF NOT EXISTS "bot_cobros_boleta_pagos" (
  "boleta_id"    uuid NOT NULL REFERENCES "bot_cobros_boletas"("id") ON DELETE CASCADE,
  "pago_id"      integer NOT NULL,
  "numero_cuota" integer,
  "resuelto_en"  timestamp with time zone,
  CONSTRAINT "bot_cobros_boleta_pagos_pkey" PRIMARY KEY ("boleta_id", "pago_id"),
  -- Este unique es lo que permite que un evento entrante encuentre SU boleta.
  CONSTRAINT "bot_cobros_boleta_pagos_pago_unico" UNIQUE ("pago_id")
);

CREATE TABLE IF NOT EXISTS "bot_cobros_pago_eventos" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "boleta_id"             uuid REFERENCES "bot_cobros_boletas"("id") ON DELETE SET NULL,
  "pago_id"               integer NOT NULL,
  "evento"                text NOT NULL,
  "ocurrido_en"           timestamp with time zone NOT NULL,
  "payload"               jsonb,
  "notificado_cliente_at" timestamp with time zone,
  "notificado_asesor_at"  timestamp with time zone,
  "error"                 text,
  "created_at"            timestamp with time zone DEFAULT now() NOT NULL,
  -- Un pago se puede revertir y volver a validar, y conta puede repetir una
  -- acción: esto evita que el cliente reciba dos WhatsApp por lo mismo.
  CONSTRAINT "bot_cobros_pago_eventos_unico" UNIQUE ("pago_id", "evento", "ocurrido_en")
);

CREATE INDEX IF NOT EXISTS "bot_cobros_pago_eventos_boleta_idx" ON "bot_cobros_pago_eventos" ("boleta_id");
