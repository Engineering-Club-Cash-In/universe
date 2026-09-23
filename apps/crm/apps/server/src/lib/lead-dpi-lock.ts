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
	 * El porcentaje MÁS ALTO por el que esta oportunidad pasó alguna vez, según
	 * `opportunityStageHistory`. `null` cuando no tiene historial: una
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
 * El máximo histórico, como subconsulta correlacionada y no como una consulta
 * por oportunidad: una oportunidad puede tener decenas de filas de historial y
 * traerlas aparte sería un N+1 en el camino caliente de cada edición.
 */
const MAX_HISTORICO = sql<number | null>`(
	select max(${salesStages.closurePercentage})
	from ${opportunityStageHistory}
	inner join ${salesStages} on ${salesStages.id} = ${opportunityStageHistory.toStageId}
	where ${opportunityStageHistory.opportunityId} = ${opportunities.id}
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
 * JS dentro del SQL, así que viven una al lado de la otra a propósito.
 */
function sqlCandanteDeLaOportunidad(): SQL {
	return sql`
		${opportunities.status} <> 'lost'
		and (
			${salesStages.closurePercentage} > ${PORCENTAJE_CANDADO_DPI}
			or exists (
				select 1
				from ${opportunityStageHistory} as h
				inner join ${salesStages} as hs on hs.id = h.to_stage_id
				where h.opportunity_id = ${opportunities.id}
					and hs.closure_percentage > ${PORCENTAJE_CANDADO_DPI}
			)
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

/** Lo mismo para UNA oportunidad: el caso del co-deudor. */
export function existeOportunidadCandantePorId(opportunityId: string): SQL {
	return sql`exists (
		select 1
		from ${opportunities}
		inner join ${salesStages} on ${salesStages.id} = ${opportunities.stageId}
		where ${opportunities.id} = ${opportunityId}
			and ${sqlCandanteDeLaOportunidad()}
	)`;
}

export function noExisteOportunidadCandanteDelLead(leadId: string): SQL {
	return sql`not ${existeOportunidadCandanteDelLead(leadId)}`;
}

export function noExisteOportunidadCandantePorId(opportunityId: string): SQL {
	return sql`not ${existeOportunidadCandantePorId(opportunityId)}`;
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
