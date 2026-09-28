-- CB-041 (review de Codex, PR #1755) — un mismo wialon_unit_id puede estar
-- vinculado a más de un vehicle_id (D-10, ver jobs/gps-eventos-poll.ts): dos
-- reasignaciones o dos créditos legítimos compartiendo GPS terminan cada uno
-- con su propio caso_cobro_id. El índice único parcial existente
-- (uq_inmovilizaciones_unidad_caso_abierta) solo protege por caso, así que
-- el Caso A podía tener un apagado aprobado mientras el Caso B —mismo
-- vehículo físico— tenía una reactivación aprobada al mismo tiempo: el
-- supervisor, en modo manual, recibía instrucciones contradictorias sobre
-- la misma unidad real.
--
-- wialon_unit_id IS NOT NULL en el WHERE: no restringe casos sin vehículo
-- vinculado (no hay unidad física que proteger todavía).

CREATE UNIQUE INDEX IF NOT EXISTS "uq_inmovilizaciones_unidad_wialon_abierta"
	ON "inmovilizaciones_unidad" ("wialon_unit_id")
	WHERE "estado" IN ('pendiente_aprobacion', 'aprobada') AND "wialon_unit_id" IS NOT NULL;
