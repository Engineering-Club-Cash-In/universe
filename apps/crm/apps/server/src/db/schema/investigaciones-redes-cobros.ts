import {
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { casosCobros } from "./cobros";

/**
 * CB-039 — Investigación en redes sociales sobre el cliente (migración 0073).
 *
 * Bitácora append-only (sin `updated_at`): una fila por consulta, con la
 * fuente, lo encontrado, la fecha, quién y sus capturas. Las reglas y los
 * catálogos viven en lib/investigaciones-redes-cobros.ts.
 */
export const investigacionesRedesCobros = pgTable(
	"investigaciones_redes_cobros",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		casoCobroId: uuid("caso_cobro_id")
			.notNull()
			.references(() => casosCobros.id, { onDelete: "cascade" }),
		/** Clave del catálogo FUENTES_INVESTIGACION (text validado en TS). */
		fuente: text("fuente").notNull(),
		/** Solo cuando `fuente` = 'otra'. */
		fuenteOtra: text("fuente_otra"),
		enlacePerfil: text("enlace_perfil"),
		/** 'con_hallazgos' | 'sin_hallazgos' (CHECK en la DB). */
		resultado: text("resultado").notNull(),
		hallazgos: text("hallazgos").notNull(),
		fechaInvestigacion: timestamp("fecha_investigacion").notNull(),
		bucketSnapshot: integer("bucket_snapshot"),
		registradaPor: text("registrada_por")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("investigaciones_redes_cobros_caso_fecha_idx").on(
			t.casoCobroId,
			t.fechaInvestigacion.desc(),
			t.createdAt.desc(),
		),
	],
);

/** Capturas o PDF de la investigación, en R2 (privadas: URL firmada). */
export const investigacionesRedesCobrosEvidencias = pgTable(
	"investigaciones_redes_cobros_evidencias",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		investigacionId: uuid("investigacion_id")
			.notNull()
			.references(() => investigacionesRedesCobros.id, {
				onDelete: "cascade",
			}),
		r2Key: text("r2_key").notNull(),
		nombreArchivo: text("nombre_archivo").notNull(),
		mimeType: text("mime_type").notNull(),
		tamanoBytes: integer("tamano_bytes").notNull(),
		subidoPor: text("subido_por").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		unique("investigaciones_redes_cobros_evidencias_r2_key_unique").on(t.r2Key),
		index("investigaciones_redes_cobros_evidencias_investigacion_idx").on(
			t.investigacionId,
		),
	],
);
