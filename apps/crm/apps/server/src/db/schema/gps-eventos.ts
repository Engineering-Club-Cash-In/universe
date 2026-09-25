import {
	boolean,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { casosCobros } from "./cobros";
import { vehicles } from "./vehicles";

/**
 * Eventos de Wialon relevantes para cobros (CB-119): desconexión de
 * energía, ignición, GPS sin reportar y salida de la geocerca "Perimetro
 * cash" (Guatemala), para vehículos con caso de cobro activo EN B4
 * (mora exacta de 4 cuotas — ver `jobs/gps-eventos-poll.ts`, "Como Asesor
 * B4 y Supervisor..." del ticket CB-119). Los detecta un JOB de polling, no
 * un webhook: no depende de que La Legión configure nada de su lado.
 *
 * NO incluye "movimiento" a propósito: a diferencia de los otros cuatro, no
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
	"salida_geocerca",
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
 * Snapshot del ÚLTIMO estado que el job vio por unidad (CB-119). NO es
 * historial: una fila por unidad, se sobreescribe en cada corrida. Sin esto
 * el job no puede distinguir "la ignición YA estaba encendida" (no genera
 * evento de nuevo) de "la ignición ACABA de encenderse" (sí genera evento):
 * cada corrida repetiría la alerta mientras el estado se mantenga.
 */
export const gpsUnidadEstado = pgTable("gps_unidad_estado", {
	wialonUnitId: integer("wialon_unit_id").primaryKey(),

	// SIFCO B4 que originó la última corrida que actualizó esta fila. Si
	// cambia entre corridas (unidad reasignada a otro caso, D-10), el job
	// resetea el resto de las columnas en vez de heredar el estado del caso
	// viejo.
	numeroCreditoSifco: text("numero_credito_sifco"),

	// Voltaje crudo de energía externa (lmsg.p.pwr_ext) de la última corrida.
	pwrExt: doublePrecision("pwr_ext"),
	ignicionOn: boolean("ignicion_on"),
	ultimaSenalWialon: timestamp("ultima_señal_wialon"),

	// Desde cuándo la unidad dejó de reportar señal (null si está reportando
	// con normalidad). Se usa para no re-disparar "sin_reportar" en cada
	// corrida mientras la unidad se mantenga caída.
	sinReportarDesde: timestamp("sin_reportar_desde"),

	// Si la última posición conocida estaba DENTRO de "Perimetro cash". Null
	// = nunca se pudo evaluar (sin lat/lon, o la geocerca no se pudo leer de
	// Wialon esa corrida). Evita re-disparar "salida_geocerca" en cada
	// corrida mientras la unidad se mantenga fuera.
	dentroDeGeocerca: boolean("dentro_de_geocerca"),

	actualizadoAt: timestamp("actualizado_at").defaultNow().notNull(),
});
