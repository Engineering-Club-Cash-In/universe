-- La batería de contratos que le queda pendiente a jurídico por un inversionista.
--
-- Nace cuando Pablo acepta la compra de cartera: hasta ahora eso sólo mandaba un
-- correo y jurídico se enteraba leyendo el hilo. La fila guarda una foto de los
-- datos del inversionista y de la compra, porque la ficha viva está en cartera
-- (otra base) y el contrato tiene que decir lo que era cierto el día que se
-- aceptó.
--
-- Idempotente: se puede correr más de una vez sin romper nada.

DO $$ BEGIN
  CREATE TYPE "public"."investor_contract_batch_status" AS ENUM ('pendiente', 'en_proceso', 'completada', 'descartada');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "public"."investor_contract_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- inversionista_id de cartera. Sin FK: vive en otra base.
  "investor_id" integer NOT NULL,
  "investor_name" text NOT NULL,
  "investor_dpi" text,
  "investor_email" text,
  "investor_phone" text,
  -- Los credito_id aceptados, ordenados y unidos con guiones. Cartera reintenta
  -- el aviso si el CRM no contesta, y sin esto cada reintento abría otra batería.
  "purchase_key" text NOT NULL,
  "creditos" jsonb NOT NULL,
  "monto_total" numeric(18, 2) NOT NULL,
  "modalidad" text,
  "facturacion" text,
  "status" "public"."investor_contract_batch_status" DEFAULT 'pendiente' NOT NULL,
  "accepted_at" timestamp NOT NULL,
  "accepted_by_email" text,
  "started_at" timestamp,
  "started_by" text REFERENCES "public"."user"("id"),
  "completed_at" timestamp,
  "completed_by" text REFERENCES "public"."user"("id"),
  "discarded_at" timestamp,
  "discarded_by" text REFERENCES "public"."user"("id"),
  "discard_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "investor_contract_batches_investor_idx" ON "public"."investor_contract_batches" ("investor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "investor_contract_batches_status_idx" ON "public"."investor_contract_batches" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "investor_contract_batches_purchase_unique" ON "public"."investor_contract_batches" ("investor_id", "purchase_key");
--> statement-breakpoint

-- La notificación que le llega a jurídico lo manda a su bandeja de baterías, que
-- no es ninguna de las páginas que el enum ya conocía.
ALTER TYPE "public"."notification_redirect_page" ADD VALUE IF NOT EXISTS 'investor_contracts';
