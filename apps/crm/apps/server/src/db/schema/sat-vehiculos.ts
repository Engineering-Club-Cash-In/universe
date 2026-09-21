import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	uniqueIndex,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { vehicles } from "./vehicles";
import { user } from "./auth";

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

export const satLoteEstadoEnum = pgEnum("sat_lote_estado", [
	"en_proceso",
	"ok",
	"parcial",
	"error",
]);

/** Una consulta manual completa que puede incluir varios titulares delegados. */
export const satVerificacionLotes = pgTable(
	"sat_verificacion_lotes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		usuarioId: text("usuario_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		usuarioNit: varchar("usuario_nit", { length: 20 }).notNull(),
		estado: satLoteEstadoEnum("estado").notNull().default("en_proceso"),
		intento: integer("intento").notNull().default(1),
		iniciadaAt: timestamp("iniciada_at").notNull().defaultNow(),
		finalizadaAt: timestamp("finalizada_at"),
	},
	(t) => [
		index("ix_sat_lotes_estado_fecha").on(t.estado, t.iniciadaAt),
		index("ix_sat_lotes_usuario_id").on(t.usuarioId),
		index("ix_sat_lotes_usuario").on(t.usuarioNit),
	],
);

/**
 * Una fila por titular consultado dentro del lote.
 * La fila se crea ANTES de empezar para conservar el estado del titular si
 * el proceso muere durante la navegación.
 */
export const satVerificacionCorridas = pgTable(
	"sat_verificacion_corridas",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		loteId: uuid("lote_id")
			.notNull()
			.references(() => satVerificacionLotes.id, { onDelete: "cascade" }),

		titularNit: varchar("titular_nit", { length: 20 }).notNull(),
		titularNombre: varchar("titular_nombre", { length: 200 }).notNull(),
		estado: satCorridaEstadoEnum("estado").notNull().default("en_proceso"),
		mensajeError: text("mensaje_error"),
	},
	(t) => [
		index("ix_sat_corridas_lote").on(t.loteId),
		index("ix_sat_corridas_estado").on(t.estado),
		index("ix_sat_corridas_titular").on(t.titularNit),
	],
);

/**
 * Estado actual por vehículo: una fila por vehicle_id interno o por placa
 * normalizada cuando SAT lo reporta pero no existe en el CRM.
 */
export const satVerificacionResultados = pgTable(
	"sat_verificacion_resultados",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		loteId: uuid("lote_id")
			.notNull()
			.references(() => satVerificacionLotes.id, { onDelete: "cascade" }),

		corridaId: uuid("corrida_id")
			.references(() => satVerificacionCorridas.id, { onDelete: "cascade" }),

		// Nulo cuando SAT reporta una placa que el CRM no tiene registrada.
		vehicleId: uuid("vehicle_id").references(() => vehicles.id, {
			onDelete: "set null",
		}),

		placa: varchar("placa", { length: 20 }).notNull(),
		resultado: satResultadoEnum("resultado").notNull(),

		// true = pertenece al universo actual de vehículos propios del CRM.
		eraEsperado: boolean("era_esperado").notNull(),

		// Datos crudos de SAT. Nulos si la placa no apareció en el listado.
		estadoSat: varchar("estado_sat", { length: 40 }),
		tipo: varchar("tipo", { length: 60 }),
		marca: varchar("marca", { length: 60 }),
		modelo: varchar("modelo", { length: 20 }),
		color: varchar("color", { length: 120 }),
		impuestoCirculacionPagado: boolean("impuesto_circulacion_pagado"),
		puedeAutorizarTraspaso: boolean("puede_autorizar_traspaso"),
		puedeImprimirTarjeta: boolean("puede_imprimir_tarjeta"),
		puedeImprimirCertificado: boolean("puede_imprimir_certificado"),

		mensajeError: text("mensaje_error"),

		consultadoAt: timestamp("consultado_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		index("ix_sat_resultados_lote").on(t.loteId),
		index("ix_sat_resultados_corrida").on(t.corridaId),
		index("ix_sat_resultados_placa").on(t.placa),
		index("ix_sat_resultados_veredicto").on(t.resultado),
		index("ix_sat_resultados_vehiculo").on(t.vehicleId),
		uniqueIndex("ux_sat_resultados_vehicle_actual")
			.on(t.vehicleId)
			.where(sql`${t.vehicleId} IS NOT NULL`),
		uniqueIndex("ux_sat_resultados_placa_sin_vehicle_actual")
			.on(sql`regexp_replace(upper(${t.placa}), '[^A-Z0-9]', '', 'g')`)
			.where(sql`${t.vehicleId} IS NULL`),
	],
);
