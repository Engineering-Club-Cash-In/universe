-- Desactivar a un socio POR AGENCIA: la membresía queda inactiva y el alcance
-- del tracker la ignora, pero el usuario conserva sus otras agencias.
-- desactivado_at NULL = membresía activa. Sin índice nuevo y sin CONCURRENTLY.
--
-- Idempotente.

ALTER TABLE "public"."partner_members" ADD COLUMN IF NOT EXISTS "desactivado_at" timestamp;--> statement-breakpoint
ALTER TABLE "public"."partner_members" ADD COLUMN IF NOT EXISTS "desactivado_por" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."partner_members" ADD CONSTRAINT "partner_members_desactivado_por_user_id_fk" FOREIGN KEY ("desactivado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
