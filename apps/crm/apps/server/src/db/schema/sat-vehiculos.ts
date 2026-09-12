import {
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { vehicles } from "./vehicles";

// Estado de una corrida completa contra Agencia Virtual.
export const satCorridaEstadoEnum = pgEnum("sat_corrida_estado", [
	"en_proceso",
	"ok",
	"error", // fallo genérico
	"codigo_requerido", // SAT pidió código de verificación
	"bloqueado", // Cloudflare interceptó
]);

// Veredicto del cruce entre lo que reporta SAT y lo que el CRM da por propio.
export const satResultadoEnum = pgEnum("sat_resultado_vehiculo", [
	"activo_ok", // esperado, aparece en SAT y está Activo
	"inactivo", // esperado, aparece en SAT pero Inactivo
	"no_aparece_en_sat", // esperado, NO aparece: salió del nombre de Cash In
	"no_registrado_interno", // aparece en SAT pero no está marcado como propio
]);

export const satOrigenEjecucionEnum = pgEnum("sat_origen_ejecucion", [
	"cron",
	"manual",
]);

/**
 * Bitácora de ejecución. Una fila por intento de consulta a Agencia Virtual.
 * La fila se crea ANTES de empezar: si el proceso muere de golpe queda
 * constancia del intento en vez de no dejar rastro.
 */
export const satVerificacionCorridas = pgTable(
	"sat_verificacion_corridas",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		nit: varchar("nit", { length: 20 }).notNull(),
		estado: satCorridaEstadoEnum("estado").notNull().default("en_proceso"),
		origen: satOrigenEjecucionEnum("origen").notNull().default("cron"),

		// Reintentos: número de intento e hilo que los agrupa. Un reintento es de
		// la corrida completa, no por vehículo: un solo login trae todo el listado.
		intento: integer("intento").notNull().default(1),
		corridaOriginalId: uuid("corrida_original_id"),

		// Universo esperado vs lo que SAT devolvió.
		totalEsperados: integer("total_esperados").notNull().default(0),
		totalReportadosSat: integer("total_reportados_sat").notNull().default(0),
		totalAlertas: integer("total_alertas").notNull().default(0),

		mensajeError: text("mensaje_error"),
		// Evidencia: HTML recortado de la página al fallar. Va en base de datos y
		// nunca a disco, porque el contenedor es efímero.
		evidencia: text("evidencia"),

		iniciadaAt: timestamp("iniciada_at").notNull().defaultNow(),
		finalizadaAt: timestamp("finalizada_at"),
	},
	(t) => [
		index("ix_sat_corridas_estado_fecha").on(t.estado, t.iniciadaAt),
		index("ix_sat_corridas_nit").on(t.nit),
	],
);

/**
 * Resultado por vehículo. Incluye tanto los que esperábamos encontrar
 * (eraEsperado = true, que es el universo consultado en esa corrida) como los
 * que SAT reportó y no teníamos registrados.
 */
export const satVerificacionResultados = pgTable(
	"sat_verificacion_resultados",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		corridaId: uuid("corrida_id")
			.notNull()
			.references(() => satVerificacionCorridas.id, { onDelete: "cascade" }),

		// Nulo cuando SAT reporta una placa que el CRM no tiene registrada.
		vehicleId: uuid("vehicle_id").references(() => vehicles.id, {
			onDelete: "set null",
		}),

		placa: varchar("placa", { length: 20 }).notNull(),
		resultado: satResultadoEnum("resultado").notNull(),

		// true = estaba en el universo de vehículos propios al momento de correr.
		// El conjunto de filas con true ES la foto del universo de esa corrida.
		eraEsperado: boolean("era_esperado").notNull(),

		// Datos crudos de SAT. Nulos si la placa no apareció en el listado.
		estadoSat: varchar("estado_sat", { length: 40 }),
		tipo: varchar("tipo", { length: 60 }),
		marca: varchar("marca", { length: 60 }),
		modelo: varchar("modelo", { length: 20 }),
		color: varchar("color", { length: 120 }),

		mensajeError: text("mensaje_error"),

		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("ix_sat_resultados_corrida").on(t.corridaId),
		index("ix_sat_resultados_placa").on(t.placa),
		index("ix_sat_resultados_veredicto").on(t.resultado),
		index("ix_sat_resultados_vehiculo").on(t.vehicleId),
	],
);
