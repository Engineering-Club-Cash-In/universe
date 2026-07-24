import { sql } from "drizzle-orm";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA } from "../../database/db/schema";

export type ConfigDiasSla = {
	bucket: number;
	dias_sla: number;
};

export async function actualizarDiasSlaBuckets(
	configs: ConfigDiasSla[],
): Promise<{ success: boolean; message?: string }> {
	if (!Array.isArray(configs) || configs.length === 0) {
		return { success: false, message: "Lista de configuraciones vacía" };
	}

	for (const config of configs) {
		if (
			typeof config.bucket !== "number" ||
			config.bucket < 1 ||
			config.bucket > 5 ||
			!Number.isInteger(config.bucket)
		) {
			return {
				success: false,
				message: `Bucket inválido: ${config.bucket}. Debe estar entre 1 y 5.`,
			};
		}

		if (
			typeof config.dias_sla !== "number" ||
			config.dias_sla < 1 ||
			config.dias_sla > 30 ||
			!Number.isInteger(config.dias_sla)
		) {
			return {
				success: false,
				message: `dias_sla inválido para bucket B${config.bucket}: ${config.dias_sla}. Debe estar entre 1 y 30.`,
			};
		}
	}

	for (const config of configs) {
		await db.execute(sql`
			UPDATE ${SQL_CARTERA_SCHEMA}.buckets
			SET dias_sla = ${config.dias_sla}
			WHERE numero = ${config.bucket}
		`);
	}

	return { success: true };
}
