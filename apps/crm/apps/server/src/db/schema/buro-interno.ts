import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { leads, opportunities } from "./crm";

/**
 * Buró interno: personas que la empresa marcó como mal pagadoras (o con otro
 * motivo de riesgo) para que el análisis de un crédito nuevo las detecte,
 * aunque la solicitud venga a nombre de un familiar.
 *
 * Es un catálogo aparte de la clasificación de clientes buenos y malos.
 */

/** Motivo de riesgo del registro. Es texto (no enum de Postgres) para poder ampliarlo sin migración. */
export const BURO_INTERNO_CATEGORIAS = [
	"mala_paga",
	"fraude",
	"vehiculo_recuperado",
	"incobrable",
	"otro",
] as const;
export type BuroInternoCategoria = (typeof BURO_INTERNO_CATEGORIAS)[number];

export const BURO_INTERNO_SEVERIDADES = ["alta", "media", "baja"] as const;
export type BuroInternoSeveridad = (typeof BURO_INTERNO_SEVERIDADES)[number];

export const buroInternoPersonas = pgTable(
	"buro_interno_personas",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		// Origen del registro: si se eligió un lead del CRM queda enlazado
		leadId: uuid("lead_id").references(() => leads.id, {
			onDelete: "set null",
		}),
		numeroCreditoSifco: text("numero_credito_sifco"),

		// Datos de la persona (copia al momento del registro)
		nombres: text("nombres").notNull(),
		apellidos: text("apellidos").notNull(),
		/** DPI sin espacios */
		dpi: text("dpi"),
		nit: text("nit"),
		telefono: text("telefono"),
		direccion: text("direccion"),

		categoria: text("categoria").$type<BuroInternoCategoria>().notNull(),
		motivo: text("motivo").notNull(),

		activo: boolean("activo").notNull().default(true),
		creadoPor: text("creado_por")
			.notNull()
			.references(() => user.id),
		desactivadoPor: text("desactivado_por").references(() => user.id),
		desactivadoAt: timestamp("desactivado_at", { withTimezone: true }),
		motivoDesactivacion: text("motivo_desactivacion"),

		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		// Una misma persona no puede estar dos veces activa
		uniqueIndex("buro_interno_personas_dpi_activo_uq")
			.on(table.dpi)
			.where(sql`${table.activo} AND ${table.dpi} IS NOT NULL`),
		uniqueIndex("buro_interno_personas_lead_activo_uq")
			.on(table.leadId)
			.where(sql`${table.activo} AND ${table.leadId} IS NOT NULL`),
		// Un cliente de cartera (sin lead ni DPI) solo se distingue por SIFCO +
		// nombre; misma expresión que `nombreComparableSql` en el servicio
		uniqueIndex("buro_interno_personas_sifco_nombre_activo_uq")
			.on(
				table.numeroCreditoSifco,
				sql`regexp_replace(translate(lower(${table.nombres} || ${table.apellidos}), 'áéíóúüñ', 'aeiouun'), '\\s', '', 'g')`,
			)
			.where(sql`${table.activo} AND ${table.numeroCreditoSifco} IS NOT NULL`),
		// Mismo NIT normalizado que `normalizarNitMatch`; "CF" no identifica a nadie
		uniqueIndex("buro_interno_personas_nit_activo_uq")
			.on(sql`upper(regexp_replace(${table.nit}, '[^0-9A-Za-z]', '', 'g'))`)
			.where(
				sql`${table.activo} AND ${table.nit} IS NOT NULL AND upper(regexp_replace(${table.nit}, '[^0-9A-Za-z]', '', 'g')) <> 'CF' AND length(regexp_replace(${table.nit}, '[^0-9A-Za-z]', '', 'g')) >= 3`,
			),
		index("buro_interno_personas_activo_idx").on(table.activo, table.createdAt),
	],
);

/**
 * Reglas de coincidencia. La lógica de cada regla vive en código
 * (`lib/buro-interno-match.ts`). En esta tabla se guarda qué reglas están
 * encendidas, con qué severidad y con qué parámetros.
 */
export const buroInternoReglas = pgTable(
	"buro_interno_reglas",
	{
		clave: text("clave").primaryKey(),
		activa: boolean("activa").notNull().default(true),
		severidad: text("severidad").$type<BuroInternoSeveridad>().notNull(),
		parametros: jsonb("parametros")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		orden: integer("orden").notNull().default(0),
		updatedBy: text("updated_by").references(() => user.id),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		check(
			"buro_interno_reglas_severidad_chk",
			sql`${table.severidad} IN ('alta', 'media', 'baja')`,
		),
	],
);

/**
 * Autorizaciones para aprobar un análisis pese al buró interno. Una coincidencia
 * de severidad alta frena la aprobación; el analista la levanta con un motivo,
 * y la autorización vale solo para esa oportunidad y esa persona: si después
 * aparece otra coincidencia alta, vuelve a frenar.
 */
export const buroInternoAutorizaciones = pgTable(
	"buro_interno_autorizaciones",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		opportunityId: uuid("opportunity_id")
			.notNull()
			.references(() => opportunities.id, { onDelete: "cascade" }),
		personaId: uuid("persona_id")
			.notNull()
			.references(() => buroInternoPersonas.id, { onDelete: "cascade" }),
		motivo: text("motivo").notNull(),
		autorizadoPor: text("autorizado_por")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("buro_interno_autorizaciones_uq").on(
			table.opportunityId,
			table.personaId,
		),
	],
);

/** Bitácora append-only: altas, bajas, ediciones, cambios de reglas y consultas */
export const buroInternoEventos = pgTable(
	"buro_interno_eventos",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		personaId: uuid("persona_id").references(() => buroInternoPersonas.id, {
			onDelete: "set null",
		}),
		reglaClave: text("regla_clave"),
		/** alta | edicion | baja | reactivacion | regla_actualizada | consulta */
		accion: text("accion").notNull(),
		detalle: jsonb("detalle").$type<Record<string, unknown>>(),
		realizadoPor: text("realizado_por").references(() => user.id),
		realizadoPorRol: text("realizado_por_rol"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("buro_interno_eventos_persona_idx").on(
			table.personaId,
			table.createdAt,
		),
		index("buro_interno_eventos_created_at_idx").on(table.createdAt),
	],
);

export type BuroInternoAutorizacion =
	typeof buroInternoAutorizaciones.$inferSelect;
export type BuroInternoPersona = typeof buroInternoPersonas.$inferSelect;
export type BuroInternoRegla = typeof buroInternoReglas.$inferSelect;
