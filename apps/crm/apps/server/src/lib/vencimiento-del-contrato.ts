import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { opportunities } from "../db/schema/crm";
import { contractGenerationSnapshots } from "../db/schema/legal-contracts";

/**
 * La fecha de vencimiento que dice el contrato del crédito, no la que calcula
 * cartera.
 *
 * Cartera arma el calendario desde la formalización y su última cuota cae un
 * mes antes (y a veces otro día) que lo que jurídico puso en el contrato: de
 * 766 créditos con datos del contrato, 689 vencen un mes después en el
 * contrato (01-oct-2026). Los contratos de inversión citan el vencimiento del
 * crédito, así que tiene que ser el del contrato.
 *
 * Sale de `contract_generation_snapshots`: lo que se mandó a generar,
 * con `diaVencimiento`, `mesVencimiento` y `anoVencimiento`.
 */

/** "AAAA-MM-DD" a partir de lo que guardó el wizard, o null si no sirve. */
export function vencimientoDelSnapshot(data: unknown): string | null {
	const entradas = Array.isArray(data) ? data : [data];
	for (const entrada of entradas) {
		const campos = (entrada as { data?: Record<string, unknown> } | null)?.data;
		if (!campos || typeof campos !== "object") continue;

		const dia = Number(campos.diaVencimiento);
		const mes = Number(campos.mesVencimiento);
		let anio = Number(campos.anoVencimiento);
		if (!dia || !mes || !anio) continue;
		// El wizard lo guarda con dos cifras ("29" es 2029).
		if (anio < 100) anio += 2000;

		// Que la fecha exista: un 31 de un mes de 30 días no es una fecha.
		const fecha = new Date(Date.UTC(anio, mes - 1, dia));
		if (
			fecha.getUTCFullYear() !== anio ||
			fecha.getUTCMonth() !== mes - 1 ||
			fecha.getUTCDate() !== dia
		) {
			continue;
		}
		return fecha.toISOString().slice(0, 10);
	}
	return null;
}

/**
 * Número de crédito (el de cartera, `CRM-…`) → vencimiento del contrato.
 *
 * Usa el snapshot más reciente de la oportunidad de cada crédito: si los
 * contratos se regeneraron, vale lo último que se generó. Los créditos sin
 * snapshot (o con uno sin fecha) no aparecen, y quien llame se queda con lo de
 * cartera.
 */
export async function vencimientosDeContrato(
	numerosDeCredito: string[],
): Promise<Map<string, string>> {
	const vencimientos = new Map<string, string>();
	const numeros = [...new Set(numerosDeCredito.filter(Boolean))];
	if (numeros.length === 0) return vencimientos;

	const filas = await db
		.select({
			numeroSifco: opportunities.numeroSifco,
			data: contractGenerationSnapshots.data,
		})
		.from(contractGenerationSnapshots)
		.innerJoin(
			opportunities,
			eq(contractGenerationSnapshots.opportunityId, opportunities.id),
		)
		.where(inArray(opportunities.numeroSifco, numeros))
		.orderBy(desc(contractGenerationSnapshots.createdAt));

	for (const fila of filas) {
		if (!fila.numeroSifco || vencimientos.has(fila.numeroSifco)) continue;
		const fecha = vencimientoDelSnapshot(fila.data);
		if (fecha) vencimientos.set(fila.numeroSifco, fecha);
	}
	return vencimientos;
}
