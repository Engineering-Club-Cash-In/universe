import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
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

		// Qué se consultó: 'telemetria' (ubicación actual) o 'ubicaciones_clave'.
		// Null en filas anteriores a la 0070, que no distinguían el origen.
		origen: text("origen"),

		// Lo que Wialon devolvió en esa consulta (ya mapeado: unidad, telemetría,
		// fechas en ISO). Permite ver la consulta anterior en la Ficha 360 sin
		// volver a pedirla. La fila se inserta ANTES de llamar a Wialon (auditoría
		// fail-closed), así que se llena después; NULL si la consulta no llegó a
		// responder o es anterior a la 0070.
		snapshot: jsonb("snapshot"),

		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [
		index("idx_gps_consulta_logs_vehicle").on(t.vehicleId),
		index("idx_gps_consulta_logs_sifco").on(t.numeroCreditoSifco),
		index("idx_gps_consulta_logs_created_at").on(t.createdAt),
		// Historial de la ficha: WHERE vehicle_id = ? ORDER BY created_at DESC.
		index("idx_gps_consulta_logs_vehicle_created").on(t.vehicleId, t.createdAt),
	],
);
