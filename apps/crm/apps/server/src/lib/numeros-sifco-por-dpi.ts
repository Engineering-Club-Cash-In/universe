import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { leads, opportunities } from "../db/schema/crm";
import { eqDpi } from "./dpi-lookup";

/**
 * Los números de crédito que el CRM conoce para un DPI.
 *
 * 🔴 Por qué existe. Cartera resuelve un DPI preguntándole a SIFCO: DPI →
 * `CodigoCliente` → préstamos del core → cruce contra
 * `creditos.numero_credito_sifco`. Pero esa columna guarda también números que
 * SIFCO nunca emitió:
 *
 * - `CRM-<uuid>`, de los créditos creados al ganar una oportunidad acá
 *   (`services/close-opportunity.ts`);
 * - `insoluto-N`, de los insolutos (`createCredit.ts` en cartera-back).
 *
 * El core no los devuelve jamás, así que esos créditos no entraban al cruce y
 * el gate no los veía. Peor: el cliente cuyos créditos son TODOS de esos ni
 * siquiera tiene ficha en SIFCO, con lo que la consulta salía
 * `CLIENTE_NO_ENCONTRADO` → `puedeContinuar: true`. Un moroso pasaba limpio.
 *
 * El CRM es la única fuente posible para ese caso, porque es quien emitió esos
 * números. Del lado de cartera, además, un solo número que empate alcanza para
 * alcanzar al resto: la consulta expande por `usuario_id`.
 *
 * Se compara con `eqDpi` y no con `eq`: los DPI viejos quedaron guardados con
 * espacios ("3460 66638 0101") y un `=` crudo no reconoce a esa persona.
 *
 * Devuelve a lo sumo `TOPE_NUMEROS` (el contrato de cartera acota el arreglo).
 * Quedarse corto degrada la cobertura pero no la corrección: los que sí viajan
 * siguen alcanzando a sus hermanos por la expansión de dueño.
 */
export const TOPE_NUMEROS_CREDITO_CONOCIDOS = 50;

/**
 * La consulta, aparte para poder mirarle el SQL en los tests.
 *
 * 🔴 El DISTINCT y el `trim` van en SQL, ANTES del `limit`, no después en JS. El
 * tope corta filas, no números distintos: un lead con el mismo `numeroSifco`
 * repetido en varias oportunidades —o el mismo número guardado una vez con
 * espacios y otra sin— llenaba las 50 filas con duplicados y dejaba afuera el
 * crédito que sí importaba. Con el saneo adentro, el tope cuenta lo que de
 * verdad se va a mandar.
 *
 * El `trim` se repite en el `where`: un `"   "` no es NULL ni `''`, así que sin
 * recortarlo primero se colaba como número válido y gastaba un lugar del tope.
 */
export function consultaNumerosSifcoPorDpi(
	database: Pick<typeof db, "selectDistinct">,
	dpi: string,
) {
	const numeroLimpio = sql<string>`trim(${opportunities.numeroSifco})`;

	return database
		.selectDistinct({ numeroSifco: numeroLimpio })
		.from(opportunities)
		.innerJoin(leads, eq(opportunities.leadId, leads.id))
		.where(
			and(
				eqDpi(leads.dpi, dpi),
				isNotNull(opportunities.numeroSifco),
				ne(numeroLimpio, ""),
			),
		)
		.limit(TOPE_NUMEROS_CREDITO_CONOCIDOS);
}

export async function numerosSifcoConocidosPorDpi(
	dpi: string,
): Promise<string[]> {
	const filas = await consultaNumerosSifcoPorDpi(db, dpi);

	// Segunda línea: el SQL ya vino limpio y deduplicado, pero esto cuesta nada
	// y cubre cualquier motor o vista que devuelva algo inesperado.
	const vistos = new Set<string>();
	for (const fila of filas) {
		const numero = (fila.numeroSifco ?? "").trim();
		if (numero) vistos.add(numero);
	}

	return [...vistos];
}
