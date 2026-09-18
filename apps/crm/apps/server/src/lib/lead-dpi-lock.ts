import { eq } from "drizzle-orm";
import { db } from "../db";
import { opportunities, salesStages } from "../db/schema";
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
};

export type SujetoCandadoDpi = "lead" | "codeudor" | "portal";

export type ResultadoCandadoDpi = {
	bloqueado: boolean;
	message?: string;
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

function etapaQueCanda(
	oportunidades: OportunidadParaCandadoDpi[],
): OportunidadParaCandadoDpi | null {
	// Las perdidas no candan: un crédito que no se dio no puede dejar al cliente
	// con el DPI fijo para siempre.
	const bloqueantes = oportunidades.filter(
		(o) => o.status !== "lost" && o.closurePercentage > PORCENTAJE_CANDADO_DPI,
	);

	if (bloqueantes.length === 0) {
		return null;
	}

	return bloqueantes.reduce((mayor, actual) =>
		actual.closurePercentage > mayor.closurePercentage ? actual : mayor,
	);
}

function mensajeCandado(
	sujeto: Exclude<SujetoCandadoDpi, "portal">,
	etapa: OportunidadParaCandadoDpi,
): string {
	const queDpi = sujeto === "codeudor" ? " del co-deudor" : "";
	return `No se puede cambiar el DPI${queDpi}: la solicitud ya avanzó a ${etapa.stageName} (${etapa.closurePercentage}%). El DPI${queDpi} quedó fijo porque las validaciones de RENAP y buró y los documentos del expediente están atados a esa identidad. Si fue un error de captura, pedile a un administrador que lo corrija.`;
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

	// Válvula de escape para un DPI mal tipeado: solo dentro del CRM, nunca en el
	// portal público.
	if (input.esAdmin) {
		return { bloqueado: false };
	}

	return { bloqueado: true, message: mensajeCandado(input.sujeto, etapa) };
}

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
			status: opportunities.status,
			stageName: salesStages.name,
			closurePercentage: salesStages.closurePercentage,
		})
		.from(opportunities)
		.innerJoin(salesStages, eq(salesStages.id, opportunities.stageId))
		.where(where);
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
