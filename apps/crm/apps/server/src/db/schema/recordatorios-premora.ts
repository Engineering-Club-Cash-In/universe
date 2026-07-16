import {
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export const recordatorioPremoraTipoEnum = pgEnum("recordatorio_premora_tipo", [
	"premora_5",
	"premora_3",
	"premora_1",
	"premora_0",
]);

/**
 * Idempotencia de los recordatorios premora (CC2-11): cada cuota recibe COMO
 * MÁXIMO un D-5, un D-3, un D-1 y un D-0 — el UNIQUE (cuota, tipo) lo
 * garantiza aunque el job corra dos veces o el server se reinicie. La traza
 * completa del envío (mensaje, respuesta del proveedor) vive en
 * `cobros_send_logs` como todos los envíos; esta tabla solo responde
 * "¿ya se mandó este recordatorio para esta cuota?".
 *
 * `cuotaId`/`creditoId` son ids de cartera-back (sin FK dura, otra DB).
 */
export const recordatoriosPremora = pgTable(
	"recordatorios_premora",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		cuotaId: integer("cuota_id").notNull(),
		creditoId: integer("credito_id").notNull(),
		numeroCreditoSifco: text("numero_credito_sifco").notNull(),
		tipo: recordatorioPremoraTipoEnum("tipo").notNull(),

		// Traza mínima para auditar sin ir al send-log.
		telefono: text("telefono"),
		fechaVencimiento: text("fecha_vencimiento"), // YYYY-MM-DD de la cuota

		enviadoAt: timestamp("enviado_at").defaultNow().notNull(),
	},
	(t) => [
		uniqueIndex("uq_recordatorios_premora_cuota_tipo").on(t.cuotaId, t.tipo),
		index("idx_recordatorios_premora_sifco").on(t.numeroCreditoSifco),
		index("idx_recordatorios_premora_enviado").on(t.enviadoAt),
	],
);
