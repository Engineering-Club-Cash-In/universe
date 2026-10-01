-- CB-119 (D-15) — Cálculo incremental de ubicaciones clave.
--
-- El job nocturno bajaba 60 días de mensajes crudos de Wialon por unidad
-- (9 tramos de 7 días, load + unload cada uno) y recalculaba todo. Con todos
-- los vehículos, no cabe en una noche. Ahora se guardan las ESTANCIAS ("estuvo
-- quieto en este punto de X a Y": el resultado de `detectarEstancias`) y cada
-- noche se pide a Wialon solo lo posterior al último punto procesado; el
-- agrupado y la clasificación corren sobre las estancias guardadas.
--
-- Las dos tablas van por unidad física (`wialon_unit_id`), no por crédito:
-- una unidad compartida por dos créditos se baja una sola vez. Se retienen 60
-- días y solo de unidades con caso de cobro activo (el job las purga, igual
-- que a `gps_ubicaciones_clave`). Sin FK a `vehicles`: `wialon_unit_id` no es
-- UNIQUE ahí (D-10).
--
-- Idempotente: se puede correr más de una vez.

CREATE TABLE IF NOT EXISTS "gps_estancias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wialon_unit_id" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"desde" timestamp NOT NULL,
	"hasta" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_estancias_unidad_desde"
	ON "gps_estancias" ("wialon_unit_id", "desde");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gps_estancias_cursor" (
	"wialon_unit_id" integer PRIMARY KEY NOT NULL,
	"procesado_hasta" timestamp NOT NULL,
	-- Último mensaje de posición leído de Wialon. Si la última estancia guardada
	-- termina exactamente ahí, quedó abierta (el carro sigue en ese lugar); si
	-- no, ya se cerró y no hay que fusionarla con lo nuevo. Null = no se sabe.
	"ultimo_mensaje_at" timestamp,
	-- Tramo en curso al terminar la última corrida cuando aún no llegaba a 20 min
	-- (por eso no es una estancia guardada). Se siembra en la siguiente: sin
	-- esto, una parada que cruza el cursor con dos mitades <20 min se perdía.
	"pendiente_lat" double precision,
	"pendiente_lon" double precision,
	"pendiente_desde" timestamp,
	"pendiente_hasta" timestamp,
	"actualizado_at" timestamp DEFAULT now() NOT NULL
);
