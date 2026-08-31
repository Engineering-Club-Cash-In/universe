import { sql } from "drizzle-orm";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA } from "../../database/db/schema";
import { STATUS_READER_FUERA } from "../../lib/buckets-classification";

export type GetSifcosPoolAutoritativosParams = {
	asesor_id: number;
	page?: number;
	perPage?: number;
};

export type SifcosPoolAutoritativosResultado = {
	success: true;
	data: string[];
	page: number;
	perPage: number;
	total: number;
	totalPages: number;
};

/**
 * Créditos que un asesor puede atender por su pool actual. La fuente es la
 * última fila de `buckets_historial`: sin fila del motor no existe acceso.
 */
export async function getSifcosPoolAutoritativos(
	params: GetSifcosPoolAutoritativosParams,
): Promise<SifcosPoolAutoritativosResultado> {
	const pageFloor = Math.floor(Number(params.page ?? 1));
	const page = Number.isFinite(pageFloor) && pageFloor > 0 ? pageFloor : 1;
	const perPageFloor = Math.floor(Number(params.perPage ?? 500));
	const perPage =
		Number.isFinite(perPageFloor) && perPageFloor > 0
			? Math.min(perPageFloor, 500)
			: 500;
	const offset = (page - 1) * perPage;
	const estadosFuera = sql.join(
		STATUS_READER_FUERA.map((estado) => sql`${estado}`),
		sql`, `,
	);

	const cte = sql`
		WITH ultima_entrada AS (
			SELECT DISTINCT ON (h.credito_id)
				h.credito_id, h.bucket_nuevo
			FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
			INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = h.credito_id
			WHERE (c."statusCredit" <> 'EN_CONVENIO' OR h.status_credito = 'EN_CONVENIO')
			ORDER BY h.credito_id, h.fecha DESC, h.historial_id DESC
		)
	`;
	const desdePool = sql`
		FROM ultima_entrada ue
		INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = ue.credito_id
		INNER JOIN ${SQL_CARTERA_SCHEMA}.asesor_bucket ab
			ON ab.bucket = ue.bucket_nuevo
			AND ab.asesor_id = ${params.asesor_id}
			AND ab.activo = true
		INNER JOIN ${SQL_CARTERA_SCHEMA}.asesores a
			ON a.asesor_id = ab.asesor_id
			AND a.activo = true
		WHERE c."statusCredit" NOT IN (${estadosFuera})
	`;

	const [conteo, filas] = await Promise.all([
		db.execute<{ total: string }>(sql`
			${cte}
			SELECT COUNT(DISTINCT ue.credito_id)::int AS total
			${desdePool}
		`),
		db.execute<{ numero_credito_sifco: string }>(sql`
			${cte}
			SELECT DISTINCT c.numero_credito_sifco
			${desdePool}
			ORDER BY c.numero_credito_sifco ASC
			LIMIT ${perPage} OFFSET ${offset}
		`),
	]);

	const total = Number(conteo.rows[0]?.total ?? 0);
	return {
		success: true,
		data: filas.rows.map((fila) => fila.numero_credito_sifco),
		page,
		perPage,
		total,
		totalPages: Math.ceil(total / perPage),
	};
}
