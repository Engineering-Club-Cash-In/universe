-- Buró de cofirmantes: las filas de `opportunity_validations` pasan a decir de
-- quién son. Las existentes quedan como `titular` por el DEFAULT.
--
-- Va ANTES que el código: el código nuevo filtra y escribe estas columnas. El
-- código anterior no las conoce y sigue funcionando con ellas presentes.
--
-- `co_debtor_id` usa ON DELETE SET NULL y no CASCADE: la bitácora no se borra
-- (los overrides apuntan a sus filas con FK NO ACTION). La fila huérfana sigue
-- siendo `cofirmante`, y el CHECK impide que un titular tenga co-deudor.
CREATE TYPE "public"."validation_sujeto" AS ENUM('titular', 'cofirmante');--> statement-breakpoint
ALTER TABLE "public"."opportunity_validations" ADD COLUMN "sujeto" "public"."validation_sujeto" DEFAULT 'titular' NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."opportunity_validations" ADD COLUMN "co_debtor_id" uuid;--> statement-breakpoint
ALTER TABLE "public"."opportunity_validations" ADD CONSTRAINT "opportunity_validations_co_debtor_id_co_debtors_id_fk" FOREIGN KEY ("co_debtor_id") REFERENCES "public"."co_debtors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."opportunity_validations" ADD CONSTRAINT "opportunity_validations_titular_sin_co_debtor" CHECK ("opportunity_validations"."sujeto" = 'cofirmante' OR "opportunity_validations"."co_debtor_id" IS NULL);--> statement-breakpoint
CREATE INDEX "opportunity_validations_co_debtor_idx" ON "public"."opportunity_validations" USING btree ("co_debtor_id","tipo","ejecutado_at" DESC);
