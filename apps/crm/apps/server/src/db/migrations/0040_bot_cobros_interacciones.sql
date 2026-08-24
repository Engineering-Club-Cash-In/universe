-- Historial de interacciones del bot de cobros (CB-110 / CC2-46).
-- Contrato: docs/features/bot-whatsapp-cobros/06-historial-interacciones.md
--
-- Una fila por petición del bot a nuestros servicios; la "sesión" es la
-- referencia del paso 1 (la fila de otps). Sin PII (D-42): el detalle lo arma
-- una allowlist por acción, así que la tabla no necesita retención.
--
-- Los FK van con SET NULL, nunca CASCADE: purgar un OTP vencido o borrar un
-- lead no puede llevarse el historial (mismo criterio que bot_cobros_boletas).

CREATE TABLE IF NOT EXISTS "bot_cobros_interacciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"otp_id" uuid,
	"lead_id" uuid,
	"co_debtor_id" uuid,
	"accion" text NOT NULL,
	"exito" boolean NOT NULL,
	"codigo" text,
	"numero_sifco" text,
	"detalle" jsonb,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "bot_cobros_interacciones"
	ADD CONSTRAINT "bot_cobros_interacciones_otp_id_otps_id_fk"
	FOREIGN KEY ("otp_id") REFERENCES "public"."otps"("id")
	ON DELETE set null ON UPDATE no action;

ALTER TABLE "bot_cobros_interacciones"
	ADD CONSTRAINT "bot_cobros_interacciones_lead_id_leads_id_fk"
	FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
	ON DELETE set null ON UPDATE no action;

ALTER TABLE "bot_cobros_interacciones"
	ADD CONSTRAINT "bot_cobros_interacciones_co_debtor_id_co_debtors_id_fk"
	FOREIGN KEY ("co_debtor_id") REFERENCES "public"."co_debtors"("id")
	ON DELETE set null ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "bot_cobros_interacciones_lead_idx"
	ON "bot_cobros_interacciones" ("lead_id", "creado_en");
CREATE INDEX IF NOT EXISTS "bot_cobros_interacciones_otp_idx"
	ON "bot_cobros_interacciones" ("otp_id");
CREATE INDEX IF NOT EXISTS "bot_cobros_interacciones_codebtor_idx"
	ON "bot_cobros_interacciones" ("co_debtor_id");
