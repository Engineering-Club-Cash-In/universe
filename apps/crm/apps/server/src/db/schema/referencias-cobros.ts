import {
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { casosCobros, metodoContactoEnum } from "./cobros";
import { leads } from "./crm";

/**
 * CB-036 · Gestión de referencias desde la Ficha 360 (cuando no se localiza al
 * cliente). Tres tablas, las tres del CRM: la información del cliente es del
 * CRM, cartera-back no se entera de nada de esto.
 *
 * Las referencias en sí NO se copian acá. Se leen al vuelo de sus fuentes
 * (referencias_lead, credit_applications, co_debtors) y se identifican por una
 * `referencia_key` estable (`lib/referencias-cobros.ts`), así ventas sigue
 * siendo dueño de lo que capturó y cobros no queda con una copia que se
 * desincroniza.
 *
 * Los catálogos (origen, resultado, tipo de hallazgo) son `text` validado en
 * TypeScript y no `pgEnum`, por la misma lección de `estadoContactoEnum`: son
 * catálogos provisionales, y quitar o renombrar un valor de un enum nativo
 * exige migrar la columna.
 */

/**
 * Teléfonos que cobros le agrega a una referencia, de cualquier origen. Es la
 * forma de completar una referencia de ventas o un cofirmante que vino sin
 * número sin tocar `credit_applications` ni `co_debtors`: lo que capturó
 * ventas se queda como lo dejó.
 *
 * Cuelga del LEAD (el cliente), no del caso: las referencias son de la
 * persona, igual que `referencias_lead`, y valen para todos sus créditos.
 */
export const referenciasTelefonosCobros = pgTable(
	"referencias_telefonos_cobros",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		leadId: uuid("lead_id")
			.notNull()
			.references(() => leads.id, { onDelete: "cascade" }),
		referenciaKey: text("referencia_key").notNull(),
		telefono: text("telefono").notNull(),
		notas: text("notas"),
		registradoPor: text("registrado_por")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		// Un doble clic no duplica el número en la misma referencia.
		uniqueIndex("uq_referencias_telefonos_cobros").on(
			table.leadId,
			table.referenciaKey,
			table.telefono,
		),
	],
);

/**
 * Bitácora de gestiones a referencias (llamada, WhatsApp, SMS, visita).
 * Append-only: no hay UPDATE ni DELETE en ningún camino del código, y por eso
 * no tiene `updated_at`. Es la trazabilidad que pide el ticket.
 *
 * Nombre, teléfono y origen se guardan COPIADOS al momento de la gestión: una
 * referencia de ventas no tiene id propio (vive en un jsonb) y una de cobros
 * se puede borrar, así que la bitácora no puede depender de que la fuente
 * siga existiendo.
 *
 * ⚠️ Tabla aparte de `contactos_cobros` A PROPÓSITO. Esa tabla la leen la cola
 * del día (sla_hoy, sin_contacto), la gestión temprana B1, el cierre diario,
 * las alertas de 3 días sin contacto, las agendas y las promesas: todo asume
 * que cada fila es un contacto CON EL CLIENTE. Decisión de negocio vigente
 * (2026-09-25): hablar con una referencia NO cuenta como contactar al
 * cliente. Si algún día se decide que sí cuente para alguna métrica, el
 * cambio es hacer que ESA métrica lea también esta tabla — no mezclar las
 * filas en `contactos_cobros`. Ver docs/features/cobros-02/06-ficha-360.md §6.
 */
export const contactosReferenciasCobros = pgTable(
	"contactos_referencias_cobros",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		casoCobroId: uuid("caso_cobro_id")
			.notNull()
			.references(() => casosCobros.id, { onDelete: "cascade" }),
		referenciaKey: text("referencia_key").notNull(),
		// Copias al momento de la gestión (ver arriba).
		referenciaOrigen: text("referencia_origen").notNull(),
		referenciaNombre: text("referencia_nombre").notNull(),
		// NULL en una visita, donde no se marcó ningún número.
		telefono: text("telefono"),
		// Se reusa el enum de canal de contactos_cobros; el router solo acepta
		// llamada / whatsapp / sms / visita_domicilio.
		metodoContacto: metodoContactoEnum("metodo_contacto").notNull(),
		resultado: text("resultado").notNull(),
		comentarios: text("comentarios"),
		realizadoPor: text("realizado_por")
			.notNull()
			.references(() => user.id),
		fechaContacto: timestamp("fecha_contacto").notNull().defaultNow(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		index("idx_contactos_referencias_cobros_caso_fecha").on(
			table.casoCobroId,
			table.fechaContacto.desc(),
		),
	],
);

/**
 * Información nueva del cliente (teléfono, dirección, ubicación) que el asesor
 * consigue mientras lo busca — normalmente de una referencia. Se guarda con su
 * procedencia (qué gestión la dio, quién la registró) y NO se aplica sola a
 * los datos del caso: un número que dio un tercero lo decide el asesor
 * (`agregado_al_caso_*`, solo para teléfonos).
 */
export const hallazgosLocalizacionCobros = pgTable(
	"hallazgos_localizacion_cobros",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		casoCobroId: uuid("caso_cobro_id")
			.notNull()
			.references(() => casosCobros.id, { onDelete: "cascade" }),
		// NULL = registrado sin una gestión a referencia de por medio.
		contactoReferenciaId: uuid("contacto_referencia_id").references(
			() => contactosReferenciasCobros.id,
			{ onDelete: "set null" },
		),
		tipo: text("tipo").notNull(), // telefono | direccion | ubicacion
		valor: text("valor").notNull(),
		enlaceMapa: text("enlace_mapa"),
		notas: text("notas"),
		registradoPor: text("registrado_por")
			.notNull()
			.references(() => user.id),
		agregadoAlCasoAt: timestamp("agregado_al_caso_at"),
		agregadoAlCasoPor: text("agregado_al_caso_por").references(() => user.id),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		index("idx_hallazgos_localizacion_cobros_caso").on(
			table.casoCobroId,
			table.createdAt.desc(),
		),
	],
);
