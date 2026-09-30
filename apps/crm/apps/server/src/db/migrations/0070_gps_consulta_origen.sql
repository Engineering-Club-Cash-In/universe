-- Historial de consultas GPS en la Ficha 360.
--
-- `gps_consulta_logs` ya guarda una fila por cada vez que un asesor confirma un
-- motivo (CB-118). La Ficha 360 ahora lista esas consultas por vehículo:
--
--  * `origen` distingue qué se consultó: las dos rutas que escriben en la
--    tabla (telemetría y ubicaciones clave) eran indistinguibles.
--  * `snapshot` guarda lo que respondió Wialon en esa consulta, para poder ver
--    la consulta anterior sin volver a pedirla (y sin auditar otra vista).
--
-- El índice compuesto sirve al historial (WHERE vehicle_id = ? ORDER BY
-- created_at DESC) sin ordenar en memoria.
--
-- Las columnas quedan NULL en las filas anteriores a esta migración.

ALTER TABLE "gps_consulta_logs" ADD COLUMN IF NOT EXISTS "origen" text;
--> statement-breakpoint
ALTER TABLE "gps_consulta_logs" ADD COLUMN IF NOT EXISTS "snapshot" jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_consulta_logs_vehicle_created"
	ON "gps_consulta_logs" ("vehicle_id", "created_at");
