import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { coDebtors, leads, opportunities } from "../db/schema/crm";
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

/**
 * La otra puerta al mismo DPI: las oportunidades donde esa persona figura como
 * CO-DEUDOR.
 *
 * 🔴 `consultaNumerosSifcoPorDpi` llega a las oportunidades SOLO por
 * `leads.dpi`. Quien nunca fue lead pero sí co-deudor de una oportunidad
 * morosa nacida en el CRM —crédito `CRM-<uuid>`, que SIFCO jamás devuelve— era
 * invisible para el gate: cartera contestaba `CLIENTE_NO_ENCONTRADO` y esa
 * persona volvía a entrar como titular de una solicitud nueva.
 *
 * Mismo saneo y misma sonda de desborde que su hermana.
 */
export function consultaNumerosSifcoPorDpiDeCoDeudor(
	database: Pick<typeof db, "selectDistinct">,
	dpi: string,
) {
	const numeroLimpio = sql<string>`trim(${opportunities.numeroSifco})`;

	return database
		.selectDistinct({ numeroSifco: numeroLimpio })
		.from(opportunities)
		.innerJoin(coDebtors, eq(coDebtors.opportunityId, opportunities.id))
		.where(
			and(
				eqDpi(coDebtors.dpi, dpi),
				isNotNull(opportunities.numeroSifco),
				ne(numeroLimpio, ""),
			),
		)
		.limit(SONDA_DESBORDE_NUMEROS);
}

export async function numerosSifcoConocidosPorDpi(
	dpi: string,
): Promise<string[]> {
	// Las DOS puertas: titular de un lead y co-deudor de una oportunidad —
	// quien entró por una sola seguía invisible por la otra.
	const [comoTitular, comoCoDeudor] = await Promise.all([
		consultaNumerosSifcoPorDpi(db, dpi),
		consultaNumerosSifcoPorDpiDeCoDeudor(db, dpi),
	]);

	// Antes de mirar el contenido: si vino la fila sonda, esta lista JAMÁS va a
	// estar completa. Ver `exigirNumerosCompletos`.
	exigirNumerosCompletos(comoTitular, dpi);
	exigirNumerosCompletos(comoCoDeudor, dpi);

	return unirNumerosSifco(sanear(comoTitular), sanear(comoCoDeudor));
}

/**
 * La consulta hermana: los números que el CRM conoce para UN LEAD, por su id.
 *
 * 🔴 Por qué no alcanza con la de arriba en las EDICIONES de DPI. Cuando se
 * cambia el DPI de un lead, lo único que se busca es el DPI NUEVO. Si el lead
 * que se está editando tiene su propio crédito moroso —un `CRM-<uuid>` o un
 * `insoluto-N`, que SIFCO nunca devuelve— y el DPI nuevo no registra nada en
 * ningún lado, cartera contesta `CLIENTE_NO_ENCONTRADO` → `puedeContinuar` y el
 * cambio pasa para cualquiera. La deuda del propio editado queda fuera de su
 * propia evaluación: basta con teclear un DPI virgen para salir del gate.
 *
 * Por eso el gate de las ediciones pregunta por la UNIÓN: los números del DPI
 * nuevo MÁS los del lead que se está editando. Se busca por `leadId` y no por
 * dpi justamente porque el dpi es el dato que está cambiando.
 *
 * Mismo saneo que la otra: DISTINCT y `trim` en SQL, ANTES del `limit`, por la
 * razón explicada en `consultaNumerosSifcoPorDpi`.
 */
export function consultaNumerosSifcoDeLead(
	database: Pick<typeof db, "selectDistinct">,
	leadId: string,
) {
	const numeroLimpio = sql<string>`trim(${opportunities.numeroSifco})`;

	return database
		.selectDistinct({ numeroSifco: numeroLimpio })
		.from(opportunities)
		.where(
			and(
				eq(opportunities.leadId, leadId),
				isNotNull(opportunities.numeroSifco),
				ne(numeroLimpio, ""),
			),
		)
		.limit(TOPE_NUMEROS_CREDITO_CONOCIDOS);
}

export async function numerosSifcoDeLead(
	database: Pick<typeof db, "selectDistinct">,
	leadId: string,
): Promise<string[]> {
	return sanear(await consultaNumerosSifcoDeLead(database, leadId));
}

/**
 * El equivalente del co-deudor. Un co-deudor no cuelga de un lead sino de UNA
 * oportunidad (`opportunityId`), así que su "cartera propia" es a lo sumo un
 * número: el `numeroSifco` de esa oportunidad. Se incluye por la misma razón —
 * si la oportunidad que respalda ya parió un crédito moroso, cambiarle el DPI al
 * co-deudor no puede evaluarse ignorándolo.
 */
export async function numeroSifcoDeOportunidad(
	database: Pick<typeof db, "select">,
	opportunityId: string,
): Promise<string[]> {
	const filas = await database
		.select({ numeroSifco: opportunities.numeroSifco })
		.from(opportunities)
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	return sanear(filas);
}

/**
 * La unión, aparte y pura: los números de las dos fuentes, saneados y sin
 * repetir. El tope de cada consulta ya acotó cada lado; acá solo se juntan.
 */
export function unirNumerosSifco(
	...grupos: ReadonlyArray<readonly string[]>
): string[] {
	const vistos = new Set<string>();
	for (const grupo of grupos) {
		for (const numero of grupo) {
			const limpio = numero.trim();
			if (limpio) vistos.add(limpio);
		}
	}

	return [...vistos];
}

/**
 * Los números del DPI nuevo MÁS los del lead editado, deduplicados. Es lo que
 * el gate necesita en una EDICIÓN de DPI; ver `consultaNumerosSifcoDeLead`.
 */
export async function numerosSifcoDelDpiYDelLead(
	dpi: string,
	leadId: string,
): Promise<string[]> {
	const [porDpi, delLead] = await Promise.all([
		numerosSifcoConocidosPorDpi(dpi),
		numerosSifcoDeLead(db, leadId),
	]);

	return unirNumerosSifco(porDpi, delLead);
}

/** La misma unión para el co-deudor: su oportunidad en vez de su lead. */
export async function numerosSifcoDelDpiYDeLaOportunidad(
	dpi: string,
	opportunityId: string,
): Promise<string[]> {
	const [porDpi, deLaOportunidad] = await Promise.all([
		numerosSifcoConocidosPorDpi(dpi),
		numeroSifcoDeOportunidad(db, opportunityId),
	]);

	return unirNumerosSifco(porDpi, deLaOportunidad);
}

/**
 * Segunda línea: el SQL ya vino limpio y deduplicado, pero esto cuesta nada y
 * cubre cualquier motor o vista que devuelva algo inesperado.
 */
function sanear(filas: Array<{ numeroSifco: string | null }>): string[] {
	const vistos = new Set<string>();
	for (const fila of filas) {
		const numero = (fila.numeroSifco ?? "").trim();
		if (numero) vistos.add(numero);
	}

	return [...vistos];
}
