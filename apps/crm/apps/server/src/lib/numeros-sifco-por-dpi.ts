import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { leads, opportunities } from "../db/schema/crm";
import { ConsultaMoraNoDisponibleError } from "../types/cartera-back";
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
 */
export const TOPE_NUMEROS_CREDITO_CONOCIDOS = 50;

/**
 * Se piden TOPE + 1 filas para poder DISTINGUIR "justo el tope" de "hay más".
 *
 * 🔴 Con `limit(50)` a secas, el recorte era invisible: la fila 51 se quedaba
 * en la base sin que nadie se enterara. Y "los que sí viajan alcanzan al resto
 * por la expansión de dueño" solo vale cuando el que viaja empata con ALGO: si
 * el único número que mapeaba al crédito moroso era justo el que quedó afuera
 * —y los 50 que entraron son de créditos cancelados, o de un `usuario_id`
 * distinto—, cartera contesta SIN_MORA y el moroso pasa. Una cobertura
 * incompleta que se ve idéntica a una completa es el falso negativo de siempre.
 */
export const SONDA_DESBORDE_NUMEROS = TOPE_NUMEROS_CREDITO_CONOCIDOS + 1;

/**
 * Fail-closed ante el desborde de UNA fuente.
 *
 * Si la consulta trajo la fila sonda, ese DPI tiene más créditos de los que el
 * contrato de cartera admite mandar y no hay forma de preguntar por todos: no
 * se sabe si debe. Se corta con el error que el gate ya traduce a
 * SERVICIO_NO_DISPONIBLE y se pide revisión manual, en vez de mandar una lista
 * recortada que se lee como cartera completa.
 *
 * ⚠️ Es distinto del tope de la UNIÓN (`unirNumerosSifco` en las ramas de
 * arriba): aquel recorta a propósito la suma de dos fuentes que ya vinieron
 * completas —ahí sí vale que un número que empate alcance al resto por la
 * expansión de dueño—. Esto detecta que una fuente NUNCA vino completa.
 */
export function exigirNumerosCompletos(
	filas: readonly unknown[],
	dpi: string,
): void {
	if (filas.length <= TOPE_NUMEROS_CREDITO_CONOCIDOS) return;

	throw new ConsultaMoraNoDisponibleError(
		`El DPI ${dpi} tiene más de ${TOPE_NUMEROS_CREDITO_CONOCIDOS} créditos asociados en el CRM: no se puede consultar la mora de todos y el caso requiere revisión manual.`,
		null,
		true, // definitivo: reintentar no lo arregla
	);
}

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
		.limit(SONDA_DESBORDE_NUMEROS);
}

export async function numerosSifcoConocidosPorDpi(
	dpi: string,
): Promise<string[]> {
	const filas = await consultaNumerosSifcoPorDpi(db, dpi);

	// Antes de mirar el contenido: si vino la fila sonda, esta lista JAMÁS va a
	// estar completa. Ver `exigirNumerosCompletos`.
	exigirNumerosCompletos(filas, dpi);

	// Segunda línea: el SQL ya vino limpio y deduplicado, pero esto cuesta nada
	// y cubre cualquier motor o vista que devuelva algo inesperado.
	const vistos = new Set<string>();
	for (const fila of filas) {
		const numero = (fila.numeroSifco ?? "").trim();
		if (numero) vistos.add(numero);
	}

	return [...vistos];
}
