import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
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
import { casosCobros, contactosCobros } from "./cobros";
import { vehicles } from "./vehicles";

/**
 * CB-041 — Solicitud de inmovilización (apagado) o reactivación de una
 * unidad, con aprobación del `cobros_supervisor` y llamada posterior al
 * cliente.
 *
 * Modo manual a propósito: la ejecución automática con LEGION
 * (`unit/exec_cmd`) no forma parte de este flujo (depende de que ellos
 * habiliten permisos/comandos). Por eso `modoEjecucion` default 'manual' — el
 * supervisor coordina con LEGION por fuera y marca acá cuando ya se ejecutó.
 * Si se integra el proveedor, solo cambia `ejecutarInmovilizacion()`
 * (services/inmovilizacion/ejecutor.ts).
 */
export const inmovilizacionAccionEnum = pgEnum("inmovilizacion_accion", [
	"apagado",
	"reactivacion",
]);

export const inmovilizacionEstadoEnum = pgEnum("inmovilizacion_estado", [
	"pendiente_aprobacion",
	"aprobada",
	"rechazada",
	"ejecutada",
	"cancelada",
]);

/**
 * Resultado de la llamada posterior al apagado. NULL mientras no se
 * registre la llamada, o si la fila es una `reactivacion` (no aplica).
 *
 * `no_pago_pendiente_recuperacion` (respuesta "no pagó" de la llamada) y
 * `enviada_recuperacion` (el crédito YA se mandó a recuperación de
 * vehículo, vía enviarCreditoARecuperacion en routers/cobros.ts) son
 * estados distintos a propósito — registrarResultadoLlamada solo conoce el
 * primero, nunca el segundo. Review de Codex, PR #1758.
 */
export const inmovilizacionResultadoEnum = pgEnum("inmovilizacion_resultado", [
	"reactivada",
	"enviada_recuperacion",
	"no_pago_pendiente_recuperacion",
]);

export const inmovilizacionesUnidad = pgTable(
	"inmovilizaciones_unidad",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		casoCobroId: uuid("caso_cobro_id")
			.notNull()
			.references(() => casosCobros.id),
		numeroCreditoSifco: text("numero_credito_sifco").notNull(),
		// SET NULL, no NO ACTION (default): es nullable y solo una foto del
		// vehículo al momento de solicitar — mismo criterio que la migración
		// 0061 (ubicaciones clave). Sin esto, borrar un vehículo de prueba
		// fallaría por esta FK. Review de Codex.
		vehicleId: uuid("vehicle_id").references(() => vehicles.id, {
			onDelete: "set null",
		}),
		// Foto del wialon_unit_id al momento de solicitar — igual que
		// bucketSnapshot en contactosCobros, no se re-resuelve después.
		wialonUnitId: integer("wialon_unit_id"),

		accion: inmovilizacionAccionEnum("accion").notNull(),
		estado: inmovilizacionEstadoEnum("estado")
			.notNull()
			.default("pendiente_aprobacion"),
		motivo: text("motivo").notNull(),
		// Bucket del crédito al momento de solicitar (congelado, mismo criterio
		// que bucketSnapshot en contactosCobros — CB-128).
		bucketSnapshot: integer("bucket_snapshot"),

		solicitadoPor: text("solicitado_por")
			.notNull()
			.references(() => user.id),
		solicitadoAt: timestamp("solicitado_at").notNull().defaultNow(),

		decididoPor: text("decidido_por").references(() => user.id),
		decididoAt: timestamp("decidido_at"),
		motivoRechazo: text("motivo_rechazo"),

		ejecutadoPor: text("ejecutado_por").references(() => user.id),
		ejecutadoAt: timestamp("ejecutado_at"),
		// 'manual' (default, CB-041) | 'proveedor' (integración futura, vía Wialon).
		modoEjecucion: text("modo_ejecucion").notNull().default("manual"),
		// Nota o ticket de LEGION que respalda la ejecución manual.
		referenciaEjecucion: text("referencia_ejecucion"),

		// La reactivación apunta al apagado que la originó — permite cerrar el
		// ciclo (marcar `resultado = 'reactivada'` en el apagado origen).
		// AnyPgColumn (no un import circular a la tabla misma): SET NULL
		// porque el origen es solo trazabilidad — perderla no debe bloquear
		// borrar la fila vieja. Review de Codex.
		inmovilizacionOrigenId: uuid("inmovilizacion_origen_id").references(
			(): AnyPgColumn => inmovilizacionesUnidad.id,
			{ onDelete: "set null" },
		),
		// Gestión (contactos_cobros) que registra la llamada posterior a la
		// ejecución — apagado (registrarResultadoLlamada) o reactivación
		// (registrarLlamadaReactivacion).
		llamadaContactoId: uuid("llamada_contacto_id").references(
			() => contactosCobros.id,
		),
		resultado: inmovilizacionResultadoEnum("resultado"),

		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		// Máximo una solicitud ABIERTA por caso — evita pedir apagado dos veces
		// o apagado+reactivación en simultáneo sobre el mismo crédito.
		uniqueIndex("uq_inmovilizaciones_unidad_caso_abierta")
			.on(table.casoCobroId)
			.where(sql`${table.estado} IN ('pendiente_aprobacion', 'aprobada')`),
		// wialon_unit_id no es UNIQUE en vehicles (D-10, gps-eventos-poll.ts):
		// una misma unidad física puede tener dos caso_cobro_id distintos. Sin
		// este índice, el guard de arriba (por caso) no evita que esos dos
		// casos tengan cada uno una solicitud abierta al mismo tiempo — el
		// supervisor podía terminar con un apagado y una reactivación
		// aprobados a la vez sobre el mismo vehículo real. Review de Codex.
		uniqueIndex("uq_inmovilizaciones_unidad_wialon_abierta")
			.on(table.wialonUnitId)
			.where(
				sql`${table.estado} IN ('pendiente_aprobacion', 'aprobada') AND ${table.wialonUnitId} IS NOT NULL`,
			),
		index("idx_inmovilizaciones_unidad_estado").on(table.estado),
		index("idx_inmovilizaciones_unidad_caso").on(table.casoCobroId),
	],
);

/**
 * Bitácora de cada cambio de estado — se escribe en la MISMA transacción
 * que el UPDATE/INSERT que la origina (mismo criterio que el audit de
 * CB-128 en contactosCobrosAudit): si el evento falla, la transición se
 * revierte entera.
 */
export const inmovilizacionesUnidadEventos = pgTable(
	"inmovilizaciones_unidad_eventos",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		inmovilizacionId: uuid("inmovilizacion_id")
			.notNull()
			.references(() => inmovilizacionesUnidad.id, { onDelete: "cascade" }),
		evento: text("evento").notNull(),
		estadoAnterior: inmovilizacionEstadoEnum("estado_anterior"),
		estadoNuevo: inmovilizacionEstadoEnum("estado_nuevo").notNull(),
		usuarioId: text("usuario_id")
			.notNull()
			.references(() => user.id),
		detalle: jsonb("detalle"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		index("idx_inmovilizaciones_unidad_eventos_inmovilizacion").on(
			table.inmovilizacionId,
		),
	],
);
