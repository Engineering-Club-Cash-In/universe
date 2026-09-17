import { sql } from "drizzle-orm";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA } from "../../database/db/schema";

export type GetAsesorPorSifcoParams = {
	sifcos: string[];
};

export type AsesorPorSifco = {
	numero_credito_sifco: string;
	asesor_id: number;
	nombre: string;
};

/**
 * EL asesor que tiene asignado cada crédito hoy (`creditos.asesor_id`), en
 * bulk. Distinto de getAsignacionesPoolPorSifco, que devuelve el POOL de
 * elegibles del bucket y puede traer varios asesores por crédito: eso sirve
 * para saber quién PUEDE atenderlo, no quién lo lleva.
 *
 * Un crédito tiene un solo dueño — lo elige `procesarMoras` entre el pool del
 * bucket destino (elegirAsesorParaBucket, latefee.ts) y lo escribe en
 * `creditos.asesor_id`. Mismo criterio que usa `resolverAsesorVigente` del
 * dispatcher de Págalo en el CRM para notificar a un único destinatario.
 */
export async function getAsesorPorSifco(
	params: GetAsesorPorSifcoParams,
): Promise<{ success: true; data: AsesorPorSifco[] }> {
	const sifcos = [...new Set(params.sifcos)];
	if (sifcos.length === 0) return { success: true, data: [] };

	const sifcosSql = sql.join(
		sifcos.map((sifco) => sql`${sifco}`),
		sql`, `,
	);
	const filas = await db.execute<AsesorPorSifco>(sql`
		SELECT c.numero_credito_sifco, c.asesor_id, a.nombre
		FROM ${SQL_CARTERA_SCHEMA}.creditos c
		INNER JOIN ${SQL_CARTERA_SCHEMA}.asesores a
			ON a.asesor_id = c.asesor_id
		WHERE c.numero_credito_sifco IN (${sifcosSql})
			AND c.asesor_id IS NOT NULL
		ORDER BY c.numero_credito_sifco ASC
	`);
	return { success: true, data: filas.rows };
}
