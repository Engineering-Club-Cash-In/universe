import {
	boolean,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { casosCobros } from "./cobros";
import { vehicles } from "./vehicles";

/**
 * Eventos de Wialon relevantes para cobros (CB-119): desconexión de
 * energía, ignición y GPS sin reportar, para vehículos con caso de cobro
 * activo EN B4 (mora exacta de 4 cuotas — ver `jobs/gps-eventos-poll.ts`,
 * "Como Asesor B4 y Supervisor..." del ticket CB-119). Los detecta un JOB de
 * polling, no un webhook: no depende de que La Legión configure nada de su
 * lado.
 *
 * NO incluye "movimiento" a propósito: a diferencia de los otros dos, no
 * hay un momento único de transición ("empezó a moverse") tan limpio como
 * encendido/apagado — un vehículo manejando genera el evento en CADA
 * corrida del job mientras esté en movimiento, y aunque la notificación se
 * dedupe, igual llenaría la tabla de filas repetidas sin aportar nada que
 * "ignición" no cubra ya para el caso de uso de cobros.
 *
 * Distinta de `gps_integracion_logs` (CB-121, D-13): esa tabla audita cada
 * LLAMADA HTTP que el CRM hace hacia Wialon (una fila por intento, purgada a
 * los 90 días). Esta tabla registra eventos de NEGOCIO detectados por
 * comparación de estado (una fila por evento, retenida 180 días porque
 * además alimenta el historial de la Ficha 360).
 */
export const gpsEventoTipoEnum = pgEnum("gps_evento_tipo", [
	"desconexion_energia",
	"ignicion",
	"sin_reportar",
]);

export const gpsEventos = pgTable(
	"gps_eventos",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		tipo: gpsEventoTipoEnum("tipo").notNull(),

		wialonUnitId: integer("wialon_unit_id").notNull(),

		// Nullable: se resuelve al detectar el evento y puede no encontrarse
		// (unidad sin vincular, o el vínculo se deshizo después).
		vehicleId: uuid("vehicle_id").references(() => vehicles.id, {
			onDelete: "set null",
		}),
		// Nullable: solo se llena si la unidad tiene un caso de cobro ACTIVO al
		// momento del evento — el job solo consulta unidades de casos activos,
		// así que en la práctica esto siempre viene lleno; queda nullable por
		// si la vinculación cambia entre que se detecta y se guarda.
		casoCobroId: uuid("caso_cobro_id").references(() => casosCobros.id, {
			onDelete: "set null",
		}),

		ocurridoAt: timestamp("ocurrido_at").notNull(),
		recibidoAt: timestamp("recibido_at").defaultNow().notNull(),

		lat: doublePrecision("lat"),
		lon: doublePrecision("lon"),
		velocidadKmh: doublePrecision("velocidad_kmh"),

		// Snapshot sanitizado y truncado del estado que disparó el evento, solo
		// para diagnóstico — mismo criterio que gps_integracion_logs.
		payload: jsonb("payload"),

		// Si generó (al menos una) notificación de cobros. Un evento sin caso
		// activo se guarda igual (historial) pero notificado queda en false.
		notificado: boolean("notificado").notNull().default(false),

		// Idempotencia del evento: "<wialonUnitId>:<tipo>:<ocurridoAt ISO>". El
		// job puede volver a ver la misma transición si se reinicia a mitad de
		// una corrida; sin esto se duplicaría la fila y la notificación.
		dedupKey: text("dedup_key").notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [
		uniqueIndex("uq_gps_eventos_dedup_key").on(t.dedupKey),
		// .desc() en ocurridoAt: coincide con el orden real de la migración SQL
		// (0059, `ocurrido_at DESC`). Sin esto, `db:push`/`drizzle-kit generate`
		// ve un índice "distinto" al que ya existe y propone recrearlo.
		index("idx_gps_eventos_caso_ocurrido").on(
			t.casoCobroId,
			t.ocurridoAt.desc(),
		),
		index("idx_gps_eventos_unidad_ocurrido").on(
			t.wialonUnitId,
			t.ocurridoAt.desc(),
		),
		index("idx_gps_eventos_recibido_at").on(t.recibidoAt),
	],
);

/**
 * Snapshot del ÚLTIMO estado que el job vio por (unidad, caso B4) (CB-119).
 * NO es historial: una fila por (unidad, caso), se sobreescribe en cada
 * corrida. Sin esto el job no puede distinguir "la ignición YA estaba
 * encendida" (no genera evento de nuevo) de "la ignición ACABA de
 * encenderse" (sí genera evento): cada corrida repetiría la alerta mientras
 * el estado se mantenga.
 *
 * PK compuesta (wialonUnitId, numeroCreditoSifco), NO solo wialonUnitId:
 * `wialonUnitId` no es UNIQUE en `vehicles` (D-10) — una misma unidad Wialon
 * puede estar vinculada a más de un vehículo con caso B4 activo a la vez
 * (reasignación en curso, o dos créditos legítimos compartiendo GPS). Con PK
 * solo por unidad, el segundo caso pisaba el snapshot del primero (o
 * viceversa, según el orden del batch) y su asesor dejaba de recibir
 * alertas para esa unidad.
 */
export const gpsUnidadEstado = pgTable(
	"gps_unidad_estado",
	{
		wialonUnitId: integer("wialon_unit_id").notNull(),

		// SIFCO B4 que originó la última corrida que actualizó esta fila. Parte
		// de la PK: nunca cambia sin cambiar de fila (una reasignación crea una
		// fila nueva bajo el SIFCO nuevo, no reescribe la vieja).
		numeroCreditoSifco: text("numero_credito_sifco").notNull(),

		// Voltaje crudo de energía externa (lmsg.p.pwr_ext) de la última corrida.
		pwrExt: doublePrecision("pwr_ext"),
		ignicionOn: boolean("ignicion_on"),
		ultimaSenalWialon: timestamp("ultima_señal_wialon"),

		// Desde cuándo la unidad dejó de reportar señal (null si está reportando
		// con normalidad). Se usa para no re-disparar "sin_reportar" en cada
		// corrida mientras la unidad se mantenga caída.
		sinReportarDesde: timestamp("sin_reportar_desde"),

		actualizadoAt: timestamp("actualizado_at").defaultNow().notNull(),
	},
	(t) => [primaryKey({ columns: [t.wialonUnitId, t.numeroCreditoSifco] })],
);

/**
 * Ubicaciones donde un vehículo en B4 pasa más tiempo (CB-119, D-15):
 * reemplaza el enfoque de "salida de geocerca" (cruce de país) — el alcance
 * real del ticket es identificar dónde suele estar el vehículo (casa,
 * trabajo, lugares recurrentes) para orientar al equipo de recuperación.
 *
 * Snapshot, no historial: un job nocturno recalcula sobre los últimos 60
 * días de posiciones de Wialon (`messages/load_interval`, que el CRM no
 * guarda — la fuente de verdad del historial crudo es Wialon) y REEMPLAZA
 * las filas de cada (unidad, SIFCO) en una transacción. No se acumulan
 * corridas viejas: la última corrida es siempre la vigente.
 */
export const gpsUbicacionClaveTipoEnum = pgEnum("gps_ubicacion_clave_tipo", [
	"probable_casa",
	"probable_trabajo",
	"recurrente",
	"frecuente",
]);

export const gpsUbicacionesClave = pgTable(
	"gps_ubicaciones_clave",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		wialonUnitId: integer("wialon_unit_id").notNull(),
		// Mismo criterio que gps_unidad_estado: el SIFCO que originó el cálculo,
		// para que una unidad compartida por dos casos B4 tenga ubicaciones
		// clave separadas por caso.
		numeroCreditoSifco: text("numero_credito_sifco").notNull(),

		// Nullable por el mismo motivo que en gps_eventos: se resuelven al
		// calcular y pueden no encontrarse si el vínculo cambió después.
		vehicleId: uuid("vehicle_id").references(() => vehicles.id, {
			onDelete: "set null",
		}),
		casoCobroId: uuid("caso_cobro_id").references(() => casosCobros.id, {
			onDelete: "set null",
		}),

		lat: doublePrecision("lat").notNull(),
		lon: doublePrecision("lon").notNull(),
		// Radio del cluster en metros — el conjunto de estadías que se
		// agruparon en este punto no cayeron todas en el mismo lat/lon exacto.
		radioM: doublePrecision("radio_m").notNull(),

		tipo: gpsUbicacionClaveTipoEnum("tipo").notNull(),

		horasTotales: doublePrecision("horas_totales").notNull(),
		diasDistintos: integer("dias_distintos").notNull(),
		visitas: integer("visitas").notNull(),

		// Distribución de horas por franja horaria (noche/laboral/fin de
		// semana) y día de la semana — lo que permite mostrar "sábados ~3h" en
		// vez de solo un total. Estructura libre a propósito: es 100% derivado,
		// nunca se consulta por columna, así que no necesita su propia tabla.
		patron: jsonb("patron").notNull(),

		primeraVisita: timestamp("primera_visita").notNull(),
		ultimaVisita: timestamp("ultima_visita").notNull(),

		// Ventana de historial que se analizó para llegar a este resultado —
		// para saber, al ver el dato, sobre qué rango de tiempo se calculó.
		ventanaDesde: timestamp("ventana_desde").notNull(),
		ventanaHasta: timestamp("ventana_hasta").notNull(),

		calculadoAt: timestamp("calculado_at").defaultNow().notNull(),
	},
	(t) => [
		index("idx_gps_ubicaciones_clave_unidad_sifco").on(
			t.wialonUnitId,
			t.numeroCreditoSifco,
		),
		index("idx_gps_ubicaciones_clave_caso").on(t.casoCobroId),
	],
);
