import { sql } from "drizzle-orm";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA } from "../../database/db/schema";
import {
	bucketActualSql,
	STATUS_READER_FUERA,
} from "../../lib/buckets-classification";

export type GetBucketPorSifcoParams = {
	sifcos: string[];
};

export type BucketPorSifco = {
	numero_credito_sifco: string;
	/** Bucket actual (0-5). null = fuera del funnel o sin bucket resoluble. */
	bucket: number | null;
	prefijo: string | null;
	nombre: string | null;
	estado_mora: string | null;
	/** true = statusCredit en STATUS_READER_FUERA: sin bucket POR DISEÑO. */
	fuera_funnel: boolean;
};

/**
 * Bucket ACTUAL de varios créditos por número SIFCO, en bulk (una sola
 * consulta). Misma derivación que `getBucketActualPorSifco` (un crédito) y que
 * el listado /buckets/creditos — `bucketActualSql`: piso por estado, última
 * fila de historial, estado que fuerza bucket y rango de cuotas — así que lo
 * que ve el CRM en una lista coincide con el badge de la Ficha 360.
 *
 * Contraparte en bulk de `/buckets/credito/:sifco`: pensado para listas largas
 * (catálogo de unidades GPS) donde pedir los créditos de a uno no escala. Los
 * SIFCOs que no existen en cartera simplemente no vienen en la respuesta.
 */
export async function getBucketPorSifco(
	params: GetBucketPorSifcoParams,
): Promise<{ success: true; data: BucketPorSifco[] }> {
	const sifcos = [...new Set(params.sifcos)];
	if (sifcos.length === 0) return { success: true, data: [] };

	const sifcosSql = sql.join(
		sifcos.map((sifco) => sql`${sifco}`),
		sql`, `,
	);
	const fueraSql = sql.join(
		STATUS_READER_FUERA.map((s) => sql`${s}`),
		sql`, `,
	);

	const filas = await db.execute<{
		numero_credito_sifco: string;
		fuera: boolean;
		bucket: number | null;
		prefijo: string | null;
		nombre: string | null;
		estado_mora: string | null;
	}>(sql`
		WITH actual AS (
			SELECT
				c.numero_credito_sifco,
				(c."statusCredit" IN (${fueraSql})) AS fuera,
				${bucketActualSql("c", "m")} AS bucket
			FROM ${SQL_CARTERA_SCHEMA}.creditos c
			LEFT JOIN ${SQL_CARTERA_SCHEMA}.moras_credito m
				ON m.credito_id = c.credito_id AND m.activa = true
			WHERE c.numero_credito_sifco IN (${sifcosSql})
		)
		SELECT
			a.numero_credito_sifco,
			a.fuera,
			CASE WHEN a.fuera THEN NULL ELSE a.bucket END AS bucket,
			b.prefijo, b.nombre, b.estado_mora
		FROM actual a
		LEFT JOIN ${SQL_CARTERA_SCHEMA}.buckets b
			ON b.numero = a.bucket AND b.activo = true AND a.fuera = false
		ORDER BY a.numero_credito_sifco ASC
	`);

	return {
		success: true,
		data: filas.rows.map((r) => ({
			numero_credito_sifco: r.numero_credito_sifco,
			bucket: r.fuera || r.bucket == null ? null : Number(r.bucket),
			prefijo: r.prefijo ?? null,
			nombre: r.nombre ?? null,
			estado_mora: r.estado_mora ?? null,
			fuera_funnel: Boolean(r.fuera),
		})),
	};
}
