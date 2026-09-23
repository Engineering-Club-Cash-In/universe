import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Auditoría de consultas de ubicación GPS (CB-118).
 *
 * La historia exige explícitamente que "cada consulta quede auditada con
 * usuario, motivo y cuenta" — no basta con auditar quién generó un link de
 * Locator (eso ya existía, WIALON_LOCATOR_LINK_CREATED); hay que registrar
 * cada vez que alguien VE la ubicación de la unidad, con el motivo que dio.
 *
 * Un registro por cada vez que el asesor confirma el motivo y pide ver la
 * telemetría — no por cada render de la tarjeta ni por el refresco
 * automático (que se quitó a propósito: sin motivo nuevo no hay consulta).
 */
export const gpsConsultaLogs = pgTable(
	"gps_consulta_logs",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		vehicleId: uuid("vehicle_id").notNull(),
		// Denormalizado a propósito, igual que cobros_send_logs.numeroCreditoSifco:
		// el vínculo vehicleId→crédito puede cambiar de dueño con el tiempo, y la
		// auditoría tiene que seguir diciendo "para qué cuenta se consultó" tal
		// como era en el momento de la consulta, no lo que sea hoy.
		numeroCreditoSifco: text("numero_credito_sifco"),

		motivo: text("motivo").notNull(),

		// Qué unidad respondió, si hubo alguna (puede quedar null si en ese
		// momento no había vínculo resuelto — igual queda la intención auditada).
		unitId: text("unit_id"),
		unitName: text("unit_name"),

		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [
		index("idx_gps_consulta_logs_vehicle").on(t.vehicleId),
		index("idx_gps_consulta_logs_sifco").on(t.numeroCreditoSifco),
		index("idx_gps_consulta_logs_created_at").on(t.createdAt),
	],
);
