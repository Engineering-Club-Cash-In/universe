import { eq, type SQL, sql } from "drizzle-orm";
import { db } from "../db";
import {
	opportunities,
	opportunityStageHistory,
	salesStages,
} from "../db/schema";
import { normalizarDpi } from "../utils/cui-validation";

/**
 * A partir del 40% el expediente ya tiene RENAP, buró y documentos atados a la
 * identidad, así que el DPI se congela apenas la solicitud pasa del 30%.
 */
export const PORCENTAJE_CANDADO_DPI = 30;

export const MENSAJE_CANDADO_DPI_PORTAL =
	"No es posible actualizar el DPI porque tu solicitud ya está en análisis. Comunicate con tu asesor.";

export type OportunidadParaCandadoDpi = {
	status: string;
	stageName: string;
	closurePercentage: number;
	/**
	 * El porcentaje MÁS ALTO que esta oportunidad tocó alguna vez, según
	 * `opportunityStageHistory`. Se mide sobre las DOS puntas de cada
	 * transición —origen y destino— porque el origen es la única prueba que
	 * queda de una etapa por la que pasó sin dejar fila propia (ver
	 * `ALTURA_DE_LA_TRANSICION`). `null` cuando no tiene historial: una
	 * oportunidad recién creada no registró ningún movimiento todavía, y por eso
	 * la etapa ACTUAL sigue contando aparte (ver `etapaQueCanda`).
	 */
	maxHistoricoClosurePercentage?: number | null;
	/** Presente cuando la oportunidad vino de la base; la regla no lo usa. */
	id?: string;
};

export type SujetoCandadoDpi = "lead" | "codeudor" | "portal";

export type ResultadoCandadoDpi = {
	bloqueado: boolean;
	message?: string;
	/**
	 * `true` cuando el candado HABRÍA bloqueado y lo abrió el rol admin.
	 *
	 * Distinguirlo de "pasó porque no candaba" es lo que permite cobrar el costo
	 * del override: tras usar la válvula, las oportunidades que estaban candando
	 * vuelven a análisis, porque la evidencia de identidad que tenían
	 * (RENAP/buró/documentos) se validó contra el DPI viejo.
	 */
	overrideAdmin?: boolean;
	/** Las oportunidades que candaban, para poder revalidarlas tras un override. */
	candantes?: OportunidadParaCandadoDpi[];
};

export function dpiCambia(
	dpiActual: string | null | undefined,
	dpiNuevo: string | null | undefined,
): boolean {
	if (dpiNuevo === null || dpiNuevo === undefined) {
		return false;
	}

	// El formulario del CRM manda `dpi` en todas las ediciones, también cuando el
	// usuario solo tocó el teléfono: sin comparar normalizado contra el valor
	// guardado, el candado rompería cualquier edición de un lead avanzado.
	const actual = dpiActual ? normalizarDpi(dpiActual) : "";
	if (actual === "") {
		return false;
	}

	// Un `dpi: ""` es un borrado, no "el campo no vino": destruye la identidad del
	// expediente y además dejaba el candado abierto para escribir cualquier DPI en
	// una segunda llamada, porque entonces el guardado ya estaba vacío.
	return actual !== normalizarDpi(dpiNuevo);
}

/**
 * 🔴 El candado pregunta si la oportunidad ALGUNA VEZ cruzó el 30%, no solo
 * dónde está parada hoy.
 *
 * Mirando únicamente la etapa actual, retroceder la oportunidad de 40% a 30 o
 * 20 —`updateOpportunity` lo permite por debajo del 90— descandaba el DPI con
 * RENAP, buró y documentos ya atados a la identidad vieja. La maniobra no
 * dejaba rastro: bajar, cambiar el DPI, volver a subir.
 *
 * Las dos señales van en OR y ninguna sobra: el historial cubre el retroceso,
 * y la etapa actual cubre a la oportunidad recién creada directamente al 40%,
 * que todavía no tiene ninguna fila en `opportunityStageHistory`.
 */
export function cruzoElCandado(o: {
	closurePercentage: number;
	maxHistoricoClosurePercentage?: number | null;
}): boolean {
	return (
		o.closurePercentage > PORCENTAJE_CANDADO_DPI ||
		(o.maxHistoricoClosurePercentage ?? 0) > PORCENTAJE_CANDADO_DPI
	);
}

export function etapaQueCanda(
	oportunidades: OportunidadParaCandadoDpi[],
): OportunidadParaCandadoDpi | null {
	// Las perdidas no candan: un crédito que no se dio no puede dejar al cliente
	// con el DPI fijo para siempre. (Decisión de producto vigente; el costo de
	// reabrir una perdida avanzada se cobra aparte, al reabrirla.)
	const bloqueantes = oportunidades.filter(
		(o) => o.status !== "lost" && cruzoElCandado(o),
	);

	if (bloqueantes.length === 0) {
		return null;
	}

	return bloqueantes.reduce((mayor, actual) =>
		alturaAlcanzada(actual) > alturaAlcanzada(mayor) ? actual : mayor,
	);
}

/** Lo más alto que llegó a estar: hoy o alguna vez. */
function alturaAlcanzada(o: OportunidadParaCandadoDpi): number {
	return Math.max(o.closurePercentage, o.maxHistoricoClosurePercentage ?? 0);
}

/**
 * 🔴 La oportunidad como QUEDARÍA si este request se aplicara: con la etapa a
 * la que la quiere mover, no sólo con la que tiene guardada.
 *
 * El candado del cambio de lead miraba nada más el estado persistido, y eso
 * dejaba pasar la maniobra entera en UN solo request. Una oportunidad en el 30%
 * con el análisis aprobado para el lead A todavía no canda; mandando
 * `{ leadId: B, stageId: <etapa 40%> }` el chequeo veía 30 —el que la sube por
 * encima del umbral es ese mismo UPDATE— y la sentencia reemplazaba al cliente
 * Y cruzaba el umbral de una, conservando la aprobación y la evidencia (RENAP,
 * buró, documentos) de A. Es la maniobra en dos pasos que este candado cerró,
 * comprimida en uno.
 *
 * `Math.max` y no reemplazo: la etapa de destino SUMA, nunca resta. Si pisara a
 * la actual, `{ leadId: B, stageId: <etapa 20%> }` descandaría a una
 * oportunidad parada hoy en el 40% sin historial —la que nació ahí—, que es
 * exactamente el agujero que `cruzoElCandado` ya existe para tapar.
 */
export function conLaEtapaDeDestino(
	oportunidad: OportunidadParaCandadoDpi,
	etapaDestino:
		| { name?: string | null; closurePercentage: number }
		| null
		| undefined,
): OportunidadParaCandadoDpi {
	if (
		!etapaDestino ||
		etapaDestino.closurePercentage <= oportunidad.closurePercentage
	) {
		return oportunidad;
	}

	return {
		...oportunidad,
		stageName: etapaDestino.name ?? oportunidad.stageName,
		closurePercentage: etapaDestino.closurePercentage,
	};
}

function mensajeCandado(
	sujeto: Exclude<SujetoCandadoDpi, "portal">,
	etapa: OportunidadParaCandadoDpi,
): string {
	const queDpi = sujeto === "codeudor" ? " del co-deudor" : "";

	// Cuando canda por el historial y no por la etapa de hoy, decir "ya avanzó a
	// Solución y propuesta (20%)" sería incomprensible: el 20% no canda nada. Se
	// nombra el punto por el que pasó, que es el que explica el bloqueo.
	const porElHistorial =
		etapa.closurePercentage <= PORCENTAJE_CANDADO_DPI &&
		(etapa.maxHistoricoClosurePercentage ?? 0) > PORCENTAJE_CANDADO_DPI;

	const donde = porElHistorial
		? `ya pasó por el ${etapa.maxHistoricoClosurePercentage}% (hoy está en ${etapa.stageName}, ${etapa.closurePercentage}%)`
		: `ya avanzó a ${etapa.stageName} (${etapa.closurePercentage}%)`;

	return `No se puede cambiar el DPI${queDpi}: la solicitud ${donde}. El DPI${queDpi} quedó fijo porque las validaciones de RENAP y buró y los documentos del expediente están atados a esa identidad. Si fue un error de captura, pedile a un administrador que lo corrija.`;
}

export function resolverCandadoDpi(input: {
	dpiActual: string | null | undefined;
	dpiNuevo: string | null | undefined;
	oportunidades: OportunidadParaCandadoDpi[];
	sujeto: SujetoCandadoDpi;
	esAdmin?: boolean;
}): ResultadoCandadoDpi {
	if (!dpiCambia(input.dpiActual, input.dpiNuevo)) {
		return { bloqueado: false };
	}

	const etapa = etapaQueCanda(input.oportunidades);
	if (!etapa) {
		return { bloqueado: false };
	}

	if (input.sujeto === "portal") {
		return { bloqueado: true, message: MENSAJE_CANDADO_DPI_PORTAL };
	}

	// Las que candan, para poder revalidarlas después de un override.
	const candantes = input.oportunidades.filter(
		(o) => o.status !== "lost" && cruzoElCandado(o),
	);

	// Válvula de escape para un DPI mal tipeado: solo dentro del CRM, nunca en el
	// portal público. No es gratis: sale marcada, y el llamador cobra el costo
	// mandando las candantes de vuelta a análisis (ver `overrideAdmin`).
	if (input.esAdmin) {
		return { bloqueado: false, overrideAdmin: true, candantes };
	}

	return {
		bloqueado: true,
		message: mensajeCandado(input.sujeto, etapa),
		candantes,
	};
}

/**
 * 🔴 El historial de UNA oportunidad con las DOS puntas de cada transición
 * resueltas: la etapa de destino (`hs`) y la de origen (`fs`).
 *
 * ⚠️ El origen va por `left join` y no por `inner join` a propósito.
 * `from_stage_id` es NULL en toda fila que no tenga origen registrado —la
 * primera transición de las oportunidades viejas, y cualquier hueco del
 * historial—; con un `inner join` esas filas desaparecerían y el máximo
 * histórico pasaría de un número a NULL justo donde hoy da un número.
 */
const HISTORIAL_CON_LAS_DOS_PUNTAS = sql`
	from ${opportunityStageHistory} as h
	inner join ${salesStages} as hs on hs.id = h.to_stage_id
	left join ${salesStages} as fs on fs.id = h.from_stage_id
`;

/**
 * 🔴 La ALTURA de una transición: lo más alto que la oportunidad tocó al
 * moverse. `greatest(destino, origen)`, NO solo el destino.
 *
 * Por qué mirar también el origen. El candado se abría con una maniobra que no
 * dejaba ninguna fila con `to` alto: crear la oportunidad directamente en una
 * etapa candante (40%), armar ahí todo el expediente, y bajarla al 30% —lo que
 * escribe UNA sola fila, `from=40, to=30`—. Con `max(to)` el máximo histórico
 * daba 30, el candado se abría y el `leadId` (o el DPI) se podía reemplazar con
 * RENAP, buró y documentos ya atados a la identidad vieja; después se volvía a
 * subir. El `from_stage_id` de esa fila es la ÚNICA prueba que queda de que la
 * oportunidad estuvo en el 40%, porque la subida no dejó fila propia.
 *
 * No congela de más: `from_stage_id` se escribe con la etapa en la que la
 * oportunidad estaba parada al momento del cambio, así que un origen > umbral
 * significa que de verdad estuvo ahí. Cuando la subida SÍ dejó fila (el caso
 * normal), esa fila ya tenía `to` alto y el resultado no cambia.
 *
 * `coalesce(fs.closure_percentage, 0)`: sin origen registrado, la transición
 * vale lo que vale su destino, que es exactamente lo que valía antes de este
 * cambio. (Postgres ya ignora los NULL en `greatest`, pero dejarlo explícito es
 * lo que hace evidente que las filas viejas no cambian de valor.)
 */
const ALTURA_DE_LA_TRANSICION = sql`greatest(hs.closure_percentage, coalesce(fs.closure_percentage, 0))`;

/**
 * El máximo histórico, como subconsulta correlacionada y no como una consulta
 * por oportunidad: una oportunidad puede tener decenas de filas de historial y
 * traerlas aparte sería un N+1 en el camino caliente de cada edición.
 *
 * ⚠️ Comparte `HISTORIAL_CON_LAS_DOS_PUNTAS` y `ALTURA_DE_LA_TRANSICION` con la
 * forma SQL de más abajo (`sqlCandanteDeLaOportunidad`) a propósito: son la
 * MISMA regla y así no hay dos textos que puedan separarse en silencio, que es
 * justo como se abrió este agujero.
 */
export const MAX_HISTORICO = sql<number | null>`(
	select max(${ALTURA_DE_LA_TRANSICION})
	${HISTORIAL_CON_LAS_DOS_PUNTAS}
	where h.opportunity_id = ${opportunities.id}
)`;

export async function obtenerOportunidadesParaCandadoDpi(filtro: {
	leadId?: string;
	opportunityId?: string;
}): Promise<OportunidadParaCandadoDpi[]> {
	if (!filtro.opportunityId && !filtro.leadId) {
		return [];
	}

	const where = filtro.opportunityId
		? eq(opportunities.id, filtro.opportunityId)
		: eq(opportunities.leadId, filtro.leadId as string);

	return await db
		.select({
			id: opportunities.id,
			status: opportunities.status,
			stageName: salesStages.name,
			closurePercentage: salesStages.closurePercentage,
			maxHistoricoClosurePercentage: MAX_HISTORICO,
		})
		.from(opportunities)
		.innerJoin(salesStages, eq(salesStages.id, opportunities.stageId))
		.where(where);
}

/**
 * 🔴 La MISMA señal de `cruzoElCandado`, pero escrita en SQL para meterla en el
 * WHERE del UPDATE que escribe el DPI.
 *
 * Por qué hacen falta las dos formas. El chequeo en memoria y el `UPDATE` no
 * son atómicos: entre que el candado dice "abierto" y la escritura ocurre, otra
 * transacción puede aprobar el análisis (30 → 40) y el DPI se escribe igual,
 * sobre un expediente que ya quedó atado a la identidad vieja. Postgres
 * re-evalúa el predicado después de esperar a la escritura rival, así que
 * poniendo la condición adentro la carrera se cierra. El repo ya usa
 * exactamente este patrón en `approveOpportunityAnalysis`.
 *
 * ⚠️ Las dos formas tienen que decir lo mismo. Si tocás una, tocá la otra: el
 * test "las dos formas de la señal dicen lo mismo" existe para que no se
 * separen en silencio. Drizzle no permite reusar literalmente el predicado de
 * JS dentro del SQL, así que viven una al lado de la otra a propósito. Lo que
 * SÍ se comparte —y por eso está factorizado arriba— es la lectura del
 * historial: `HISTORIAL_CON_LAS_DOS_PUNTAS` + `ALTURA_DE_LA_TRANSICION` son un
 * solo texto usado por las dos, porque ahí es donde ya se habían separado.
 */
function sqlCandanteDeLaOportunidad(etapaDestino?: string): SQL {
	// La contraparte SQL de `conLaEtapaDeDestino`: se SUMA a las otras dos
	// señales en el mismo OR, así que sólo puede candar de más, nunca de menos.
	// Va dentro de la sentencia y no como un `if` previo por lo mismo que el
	// resto del predicado: entre la lectura y la escritura la fila puede
	// moverse, y lo que decide es lo que la base ve al escribir.
	const porLaEtapaDestino = etapaDestino
		? sql`
			or exists (
				select 1
				from ${salesStages} as ed
				where ed.id = ${etapaDestino}
					and ed.closure_percentage > ${PORCENTAJE_CANDADO_DPI}
			)`
		: sql``;

	return sql`
		${opportunities.status} <> 'lost'
		and (
			${salesStages.closurePercentage} > ${PORCENTAJE_CANDADO_DPI}
			or exists (
				select 1
				${HISTORIAL_CON_LAS_DOS_PUNTAS}
				where h.opportunity_id = ${opportunities.id}
					and ${ALTURA_DE_LA_TRANSICION} > ${PORCENTAJE_CANDADO_DPI}
			)${porLaEtapaDestino}
		)
	`;
}

/** ¿Este lead tiene alguna oportunidad que cande? Para el WHERE de `leads`. */
export function existeOportunidadCandanteDelLead(leadId: string): SQL {
	return sql`exists (
		select 1
		from ${opportunities}
		inner join ${salesStages} on ${salesStages.id} = ${opportunities.stageId}
		where ${opportunities.leadId} = ${leadId}
			and ${sqlCandanteDeLaOportunidad()}
	)`;
}

/**
 * Lo mismo para UNA oportunidad: el caso del co-deudor.
 *
 * `etapaDestino` es opcional y sólo lo manda quien, en el MISMO UPDATE, también
 * mueve la etapa (hoy: el cambio de `leadId` en `updateOpportunity`). Sin él el
 * predicado sale idéntico a como estaba, que es lo que necesitan el borrado del
 * co-deudor y la escritura del DPI.
 */
export function existeOportunidadCandantePorId(
	opportunityId: string,
	etapaDestino?: string,
): SQL {
	return sql`exists (
		select 1
		from ${opportunities}
		inner join ${salesStages} on ${salesStages.id} = ${opportunities.stageId}
		where ${opportunities.id} = ${opportunityId}
			and ${sqlCandanteDeLaOportunidad(etapaDestino)}
	)`;
}

export function noExisteOportunidadCandanteDelLead(leadId: string): SQL {
	return sql`not ${existeOportunidadCandanteDelLead(leadId)}`;
}

export function noExisteOportunidadCandantePorId(
	opportunityId: string,
	etapaDestino?: string,
): SQL {
	return sql`not ${existeOportunidadCandantePorId(opportunityId, etapaDestino)}`;
}

/**
 * 🔴 Borrar el co-deudor es la otra forma de reemplazar una identidad candada.
 *
 * El candado de `updateCoDebtor` impide cambiarle el DPI a un co-deudor de una
 * oportunidad avanzada, pero no impedía BORRARLO y crear otro con otro DPI: dos
 * llamadas y el expediente queda respaldado por una persona distinta de la que
 * pasó por RENAP, buró y documentos. El resultado es el mismo que el candado
 * existe para evitar.
 *
 * Se cierra por el lado del borrado, no del alta. `createCoDebtor` NO lleva
 * candado a propósito: agregar un co-deudor tarde es un flujo legítimo y
 * frecuente —el analista pide refuerzo justo cuando la solicitud ya avanzó—.
 * El REEMPLAZO, en cambio, exige borrar primero, y con el borrado candado la
 * maniobra completa queda cerrada sin romper el flujo bueno.
 */
export function mensajeCandadoBorradoCoDeudor(
	etapa: OportunidadParaCandadoDpi,
): string {
	const altura = Math.max(
		etapa.closurePercentage,
		etapa.maxHistoricoClosurePercentage ?? 0,
	);
	return `No se puede eliminar al co-deudor: la solicitud ya pasó del ${PORCENTAJE_CANDADO_DPI}% (llegó al ${altura}%). Su identidad quedó fija porque las validaciones de RENAP y buró y los documentos del expediente están atadas a ella, y borrarlo para dar de alta a otro cambiaría al responsable del crédito por la puerta de atrás. Si de verdad hay que reemplazarlo, un administrador puede hacerlo.`;
}

/**
 * 🔴 Reasignar `leadId` es la tercera forma de cambiarle la identidad a un
 * expediente, y era la más barata de todas.
 *
 * El candado del DPI protege al lead: no deja cambiarle el número a la persona
 * que está colgada de una solicitud avanzada. Pero `updateOpportunity` acepta
 * `leadId`, y cambiarlo no toca ningún DPI: cuelga la solicitud de OTRA persona
 * entera, dejando pegados el `analysisStatus: "approved"`, el detalle de crédito
 * aprobado y toda la evidencia (RENAP, buró, documentos, `creditAnalysis`) del
 * lead anterior. Un moroso entraba así a una solicitud ya aprobada sin cruzarse
 * ni una vez con el gate de mora, que no se llama desde acá.
 *
 * Se resuelve como el borrado del co-deudor: a partir del umbral del candado, la
 * identidad del expediente deja de ser editable. Por debajo se sigue corrigiendo
 * libremente, que es donde de verdad hace falta.
 *
 * `reassignOpportunityAndLead` NO cubre esto, aunque se le parezca: lo que ese
 * procedure cambia es `assignedTo` —el asesor—, no el `leadId`, y su tope del
 * 30% mira solo la etapa de HOY (`current.closurePercentage`), sin histórico.
 *
 * Se usa la señal completa del candado —`etapaQueCanda`, o sea hoy O alguna
 * vez— y no el porcentaje de hoy: si mirara solo la etapa actual, bajar la
 * oportunidad a 20%, cambiar el lead y volver a subirla rearmaría el agujero,
 * que es el mismo motivo por el que existe `cruzoElCandado`.
 */
export function mensajeCandadoCambioDeLead(
	etapa: OportunidadParaCandadoDpi,
): string {
	const altura = Math.max(
		etapa.closurePercentage,
		etapa.maxHistoricoClosurePercentage ?? 0,
	);
	return `No se puede cambiar el cliente de esta oportunidad: la solicitud ya pasó del ${PORCENTAJE_CANDADO_DPI}% (llegó al ${altura}%). El expediente —RENAP, buró, documentos y análisis— está atado a la persona que hoy tiene asignada, y colgarlo de otra dejaría esas validaciones respaldando a alguien que nunca las pasó. Si el cliente está equivocado, creá la oportunidad con el cliente correcto.`;
}

export async function evaluarCandadoBorradoCoDeudor(input: {
	opportunityId: string;
	esAdmin?: boolean;
}): Promise<ResultadoCandadoDpi> {
	const oportunidades = await obtenerOportunidadesParaCandadoDpi({
		opportunityId: input.opportunityId,
	});

	const etapa = etapaQueCanda(oportunidades);
	if (!etapa) {
		return { bloqueado: false };
	}

	// Misma válvula que el candado del DPI y por la misma razón: un co-deudor
	// cargado por error tiene que poder salir. Sale marcada para que el llamador
	// la anote.
	if (input.esAdmin) {
		return { bloqueado: false, overrideAdmin: true, candantes: [etapa] };
	}

	return {
		bloqueado: true,
		message: mensajeCandadoBorradoCoDeudor(etapa),
		candantes: [etapa],
	};
}

export async function evaluarCandadoDpi(input: {
	dpiActual: string | null | undefined;
	dpiNuevo: string | null | undefined;
	sujeto: SujetoCandadoDpi;
	esAdmin?: boolean;
	leadId?: string;
	opportunityId?: string;
}): Promise<ResultadoCandadoDpi> {
	if (!dpiCambia(input.dpiActual, input.dpiNuevo)) {
		return { bloqueado: false };
	}

	const oportunidades = await obtenerOportunidadesParaCandadoDpi({
		leadId: input.leadId,
		opportunityId: input.opportunityId,
	});

	return resolverCandadoDpi({
		dpiActual: input.dpiActual,
		dpiNuevo: input.dpiNuevo,
		oportunidades,
		sujeto: input.sujeto,
		esAdmin: input.esAdmin,
	});
}
