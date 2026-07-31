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

export const recordatorioConvenioTipoEnum = pgEnum(
	"recordatorio_convenio_tipo",
	["convenio_5", "convenio_3", "convenio_1", "convenio_0"],
);

/**
 * Idempotencia de los recordatorios de CONVENIO (COBROS-02): hermano de
 * `recordatorios_premora`, pero para créditos EN_CONVENIO (el funnel premora no
 * los toca). Cada cuota del convenio recibe COMO MÁXIMO un D-5, un D-3, un D-1 y
 * un D-0 — el UNIQUE (cuota, tipo) lo garantiza aunque el job corra dos veces.
 *
 * `cuotaId` es el `cuota_convenio_id` de cartera-back (sin FK dura, otra DB);
 * `creditoId` el credito_id. La traza completa del envío vive en
 * `cobros_send_logs` como todos los envíos.
 */
export const recordatoriosConvenio = pgTable(
	"recordatorios_convenio",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		cuotaId: integer("cuota_id").notNull(), // cuota_convenio_id de cartera-back
		creditoId: integer("credito_id").notNull(),
		numeroCreditoSifco: text("numero_credito_sifco").notNull(),
		tipo: recordatorioConvenioTipoEnum("tipo").notNull(),

		// Traza mínima para auditar sin ir al send-log.
		telefono: text("telefono"),
		fechaVencimiento: text("fecha_vencimiento"), // YYYY-MM-DD de la cuota

		enviadoAt: timestamp("enviado_at").defaultNow().notNull(),
	},
	(t) => [
		uniqueIndex("uq_recordatorios_convenio_cuota_tipo").on(t.cuotaId, t.tipo),
		index("idx_recordatorios_convenio_sifco").on(t.numeroCreditoSifco),
		index("idx_recordatorios_convenio_enviado").on(t.enviadoAt),
	],
);
