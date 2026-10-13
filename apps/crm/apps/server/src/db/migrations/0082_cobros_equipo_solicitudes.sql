-- COBROS-02 · Mi equipo y Solicitudes del supervisor, backend (issue #1895,
-- tareas M1 a M7), docs/features/cobros-02/24-plan-backend-equipo-solicitudes.md.
--
-- Una sola migración para toda la feature (M3, M4 y M5). Idempotente: se puede
-- correr más de una vez. Solo se corre en la BD local o en DEV, nunca en PROD
-- (COBROS-02 no va a PROD hasta el pase masivo).

-- ── M3 · nota del supervisor al aprobar un apagado o una reactivación ──────────
ALTER TABLE "public"."inmovilizaciones_unidad"
	ADD COLUMN IF NOT EXISTS "nota_decision" text;
--> statement-breakpoint
-- Los historiales filtran y ordenan por fecha de solicitud y de decisión.
CREATE INDEX IF NOT EXISTS "idx_inmovilizaciones_unidad_solicitado_at"
	ON "public"."inmovilizaciones_unidad" ("solicitado_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inmovilizaciones_unidad_decidido_at"
	ON "public"."inmovilizaciones_unidad" ("decidido_at" DESC)
	WHERE "decidido_at" IS NOT NULL;
