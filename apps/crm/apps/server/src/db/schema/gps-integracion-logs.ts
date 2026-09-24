import { sql } from "drizzle-orm";
import {
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
import { user } from "./auth";
import { gpsConsultaLogs } from "./gps-consulta-logs";

/**
 * Trazabilidad técnica de la integración GPS/Wialon (CB-121).
 *
 * `gps_consulta_logs` (CB-118) audita la INTENCIÓN de negocio: quién vio la
 * ubicación de un vehículo, por qué motivo y para qué crédito — una fila por
 * consulta del asesor, y bloquea la respuesta si no se pudo registrar.
 *
 * Esta tabla es otra cosa: registra qué pasó con CADA llamada HTTP a Wialon
 * (login, búsqueda de unidades, telemetría, links de Locator, diagnóstico),
 * con su duración, su error y si se reintentó. Una consulta de la ficha
 * puede generar varias filas acá (una por intento). Nunca bloquea nada: si
 * el insert falla, la operación contra Wialon sigue igual (a diferencia de
 * gps_consulta_logs, que es fail-closed a propósito).
 *
 * `gps_consulta_log_id` conecta ambas cuando el origen fue una consulta de
 * la ficha, para poder ver de una bitácora a la otra.
 */
export const gpsIntegracionResultadoEnum = pgEnum("gps_integracion_resultado", [
	"ok",
	"error",
	"reintentado",
	"incierto",
]);

export const gpsIntegracionSeveridadEnum = pgEnum("gps_integracion_severidad", [
	"info",
	"warning",
	"critical",
]);

export const gpsIntegracionLogs = pgTable(
	"gps_integracion_logs",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		// Agrupa los intentos de una misma operación lógica (ej. login +
		// reintento tras error de sesión, o los 3 intentos de un timeout).
		correlationId: uuid("correlation_id").notNull(),
		intento: integer("intento").notNull().default(1),

		// svc de Wialon (ej. "core/search_items", "token/login") y de dónde
		// vino la llamada dentro del CRM (ej. "getGpsVehiculo", "testWialonConnection").
		operacion: text("operacion").notNull(),
		origen: text("origen").notNull(),

		resultado: gpsIntegracionResultadoEnum("resultado").notNull(),
		errorCode: text("error_code"),
		wialonErrorCode: integer("wialon_error_code"),
		httpStatus: integer("http_status"),
		severidad: gpsIntegracionSeveridadEnum("severidad")
			.notNull()
			.default("info"),

		duracionMs: integer("duracion_ms").notNull(),

		// Resúmenes sanitizados (nunca token/sid) y truncados; solo para
		// diagnóstico en el panel admin, no para reproducir la llamada.
		requestResumen: jsonb("request_resumen"),
		responseResumen: jsonb("response_resumen"),

		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		vehicleId: uuid("vehicle_id"),
		numeroCreditoSifco: text("numero_credito_sifco"),
		gpsConsultaLogId: uuid("gps_consulta_log_id").references(
			() => gpsConsultaLogs.id,
			{ onDelete: "set null" },
		),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [
		index("idx_gps_integracion_logs_created_at").on(t.createdAt),
		index("idx_gps_integracion_logs_resultado_created_at").on(
			t.resultado,
			t.createdAt,
		),
		index("idx_gps_integracion_logs_correlation").on(t.correlationId),
		index("idx_gps_integracion_logs_sifco").on(t.numeroCreditoSifco),
	],
);

/**
 * Ciclo de vida de alertas de falla de la integración GPS (CB-121).
 *
 * Una fila por alerta ABIERTA por tipo+errorCode (índice único parcial):
 * el job de salud reutiliza la misma fila mientras el problema persiste
 * (incrementa `ocurrencias` y actualiza `ultima_vez`) en vez de crear una
 * notificación nueva cada 5 minutos. Al resolverse (automático para
 * umbrales, manual para errores críticos) queda cerrada con quién y cuándo.
 */
export const gpsAlertaTipoEnum = pgEnum("gps_alerta_tipo", [
	"error_critico",
	"tasa_error",
	"fallos_consecutivos",
	"latencia_sla",
]);

export const gpsAlertaEstadoEnum = pgEnum("gps_alerta_estado", [
	"abierta",
	"resuelta",
]);

export const gpsIntegracionAlertas = pgTable(
	"gps_integracion_alertas",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		tipo: gpsAlertaTipoEnum("tipo").notNull(),
		errorCode: text("error_code"),
		detalle: text("detalle").notNull(),

		estado: gpsAlertaEstadoEnum("estado").notNull().default("abierta"),

		primeraVez: timestamp("primera_vez").defaultNow().notNull(),
		ultimaVez: timestamp("ultima_vez").defaultNow().notNull(),
		ocurrencias: integer("ocurrencias").notNull().default(1),

		resueltaPor: text("resuelta_por").references(() => user.id, {
			onDelete: "set null",
		}),
		resueltaAt: timestamp("resuelta_at"),
		notaResolucion: text("nota_resolucion"),
	},
	(t) => [
		index("idx_gps_integracion_alertas_estado").on(t.estado),
		// Una alerta abierta por tipo+errorCode: el job hace upsert sobre esto
		// en vez de duplicar notificaciones para el mismo problema en curso.
		// COALESCE: sin él Postgres trata los NULL como distintos y las alertas
		// de umbral (error_code NULL) se duplicarían ante inserts simultáneos.
		uniqueIndex("idx_gps_integracion_alertas_abierta_unica")
			.on(t.tipo, sql`coalesce(${t.errorCode}, '')`)
			.where(sql`${t.estado} = 'abierta'`),
	],
);
