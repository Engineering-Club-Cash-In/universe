import { sql } from "drizzle-orm";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA } from "../../database/db/schema";
import { STATUS_READER_FUERA } from "../../lib/buckets-classification";

export type GetAsignacionesPoolPorSifcoParams = {
	sifcos: string[];
};

export type AsignacionPoolPorSifco = {
	numero_credito_sifco: string;
	asesor_id: number;
};

/**
 * Asesores activos que pueden atender SIFCOs puntuales por su pool actual.
 * Restringe el CTE de historial a la página solicitada; no expande el pool
 * completo de cada asesor para dibujar una tabla paginada del CRM.
 */
export async function getAsignacionesPoolPorSifco(
	params: GetAsignacionesPoolPorSifcoParams,
): Promise<{ success: true; data: AsignacionPoolPorSifco[] }> {
	const sifcos = [...new Set(params.sifcos)];
	if (sifcos.length === 0) return { success: true, data: [] };

	const estadosFuera = sql.join(
		STATUS_READER_FUERA.map((estado) => sql`${estado}`),
		sql`, `,
	);
	const sifcosSql = sql.join(
		sifcos.map((sifco) => sql`${sifco}`),
		sql`, `,
	);
	const filas = await db.execute<AsignacionPoolPorSifco>(sql`
		WITH ultima_entrada AS (
			SELECT DISTINCT ON (h.credito_id)
				h.credito_id, h.bucket_nuevo
			FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
			INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = h.credito_id
			WHERE (c."statusCredit" <> 'EN_CONVENIO' OR h.status_credito = 'EN_CONVENIO')
				AND c.numero_credito_sifco IN (${sifcosSql})
			ORDER BY h.credito_id, h.fecha DESC, h.historial_id DESC
		)
		SELECT DISTINCT c.numero_credito_sifco, ab.asesor_id
		FROM ultima_entrada ue
		INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = ue.credito_id
		INNER JOIN ${SQL_CARTERA_SCHEMA}.asesor_bucket ab
			ON ab.bucket = ue.bucket_nuevo
			AND ab.activo = true
		INNER JOIN ${SQL_CARTERA_SCHEMA}.asesores a
			ON a.asesor_id = ab.asesor_id
			AND a.activo = true
		WHERE c."statusCredit" NOT IN (${estadosFuera})
		ORDER BY c.numero_credito_sifco ASC, ab.asesor_id ASC
	`);
	return { success: true, data: filas.rows };
}
