import {
	decimal,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { casosCobros, contactosCobros, recuperacionesVehiculo } from "./cobros";

/**
 * CB-037 / CB-038 — Visita de cobros a la residencia o al lugar de trabajo del
 * cliente (migración 0068).
 *
 * Es una tarea con dos momentos: `programada` (dirección, responsable, fecha)
 * y `realizada` (resultado, evidencia, próximo paso); también se puede
 * registrar directo, ya hecha. Las reglas viven en lib/visitas-cobros.ts.
 *
 * Los vínculos con la gestión, la promesa y la entrega voluntaria que salen de
 * la visita viven ACÁ y no en esas tablas: así ninguna de ellas cambia, y
 * este archivo importa de cobros.ts sin crear un ciclo.
 */
export const visitasCobros = pgTable(
	"visitas_cobros",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		casoCobroId: uuid("caso_cobro_id")
			.notNull()
			.references(() => casosCobros.id, { onDelete: "cascade" }),
		/** 'residencia' | 'trabajo' (CHECK en la DB). */
		tipo: text("tipo").notNull(),
		/** 'programada' | 'realizada' | 'cancelada' (CHECK en la DB). */
		estado: text("estado").notNull(),
		direccion: text("direccion").notNull(),
		referencia: text("referencia"),
		empresa: text("empresa"),
		responsableId: text("responsable_id")
			.notNull()
			.references(() => user.id),

		fechaProgramada: timestamp("fecha_programada"),
		notasProgramacion: text("notas_programacion"),
		programadaPor: text("programada_por").references(() => user.id, {
			onDelete: "set null",
		}),

		fechaVisita: timestamp("fecha_visita"),
		resultado: text("resultado"),
		motivoSinContacto: text("motivo_sin_contacto"),
		montoRecibido: decimal("monto_recibido", { precision: 12, scale: 2 }),
		comentarios: text("comentarios"),
		proximoPaso: text("proximo_paso"),
		fechaProximoPaso: timestamp("fecha_proximo_paso"),
		ubicacionLat: decimal("ubicacion_lat", { precision: 10, scale: 7 }),
		ubicacionLng: decimal("ubicacion_lng", { precision: 10, scale: 7 }),
		ubicacionPrecisionM: integer("ubicacion_precision_m"),
		lineamientosAceptadosAt: timestamp("lineamientos_aceptados_at"),
		registradaPor: text("registrada_por").references(() => user.id, {
			onDelete: "set null",
		}),

		motivoCancelacion: text("motivo_cancelacion"),
		canceladaPor: text("cancelada_por").references(() => user.id, {
			onDelete: "set null",
		}),
		canceladaAt: timestamp("cancelada_at"),

		contactoCobroId: uuid("contacto_cobro_id").references(
			() => contactosCobros.id,
			{ onDelete: "set null" },
		),
		promesaContactoId: uuid("promesa_contacto_id").references(
			() => contactosCobros.id,
			{ onDelete: "set null" },
		),
		recuperacionId: uuid("recuperacion_id").references(
			() => recuperacionesVehiculo.id,
			{ onDelete: "set null" },
		),

		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(t) => [
		index("visitas_cobros_caso_fecha_idx").on(
			t.casoCobroId,
			t.createdAt.desc(),
		),
	],
);

/** Fotos de la visita, en R2 (privadas: se sirven con URL firmada). */
export const visitasCobrosEvidencias = pgTable(
	"visitas_cobros_evidencias",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		visitaId: uuid("visita_id")
			.notNull()
			.references(() => visitasCobros.id, { onDelete: "cascade" }),
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
		unique("visitas_cobros_evidencias_r2_key_unique").on(t.r2Key),
		index("visitas_cobros_evidencias_visita_idx").on(t.visitaId),
	],
);
