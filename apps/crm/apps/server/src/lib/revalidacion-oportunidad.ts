import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { opportunities, salesStages } from "../db/schema";
import type { AuditEntry } from "./audit";
import { cruzoElCandado, PORCENTAJE_CANDADO_DPI } from "./lead-dpi-lock";

/**
 * Cuándo una oportunidad tiene que volver a validarse, y qué se le toca.
 *
 * 🔴 El problema que resuelve. La evidencia de identidad de un expediente
 * —RENAP, buró, los documentos— se produjo contra UN DPI, en un momento dado.
 * Hay dos maniobras que dejan esa evidencia pegada a una identidad que ya no es
 * la vigente, y las dos existen a propósito:
 *
 * 1. **Reabrir una perdida.** Las oportunidades `lost` NO candan —decisión de
 *    producto: un crédito que no se dio no puede dejar al cliente con el DPI
 *    fijo para siempre—, así que mientras está perdida el DPI se puede cambiar.
 *    Reabrirla con la etapa avanzada intacta dejaba el expediente afirmando
 *    cosas sobre una persona que quizá ya no es la del DPI. La escapatoria
 *    completa era: perder la oportunidad, cambiar el DPI, reabrirla.
 * 2. **El override del admin sobre el candado.** La válvula existe para
 *    corregir un DPI mal tecleado, pero cuando se usa, la validación que había
 *    quedó hecha contra el DPI viejo.
 *
 * En ninguno de los dos casos se prohíbe la maniobra: se le pone precio.
 * Reabrir, o corregir el DPI siendo admin, ahora cuesta re-validar.
 *
 * ⚠️ La asimetría de las salvaguardas. Hay dos clases de oportunidad a las que
 * este reset NO se les aplica, y por razones distintas:
 *
 * - **`won`**: tiene campos congelados porque los contratos se firmaron con
 *   esos datos (ver `getWonOpportunityFrozenFieldChanges`). Mandarla a
 *   análisis contradiría documentos ya firmados.
 * - **≥ 90% ("Formalización Final" y más allá)**: el repo prohíbe retroceder
 *   desde ahí; el crédito ya está en cartera o en camino. Un reset sería una
 *   escritura que el resto del sistema no admite.
 *
 * En los dos casos la maniobra igual queda registrada: se anota la fila de
 * bitácora con el aviso de que la validación quedó vieja y nadie la rehizo.
 * Preferimos un aviso auditable a una escritura que rompa invariantes de
 * contratos firmados.
 */
export const PORCENTAJE_ETAPA_ANALISIS = PORCENTAJE_CANDADO_DPI;

/**
 * Desde el 90% el repo no deja retroceder: "Formalización Final" en adelante el
 * crédito ya está en cartera o en camino.
 */
export const PORCENTAJE_SIN_RETROCESO = 90;

export type OportunidadParaRevalidar = {
	id?: string;
	status: string;
	closurePercentage: number;
	maxHistoricoClosurePercentage?: number | null;
};

export type DecisionRevalidacion =
	/** Vuelve a análisis: etapa 30%, `analysisStatus: pending`, detalle sin aprobar. */
	| { tipo: "resetear" }
	/** No se toca, pero la maniobra se anota: la validación quedó vieja. */
	| { tipo: "solo_aviso"; razon: "won" | "formalizacion_final" }
	/** Nunca cruzó el 30%: no hay validación que invalidar. */
	| { tipo: "nada" };

export function decidirRevalidacion(
	oportunidad: OportunidadParaRevalidar,
): DecisionRevalidacion {
	// Sin haber cruzado el 30% no hubo análisis, así que no hay nada que rehacer
	// ni de qué avisar. Es la misma señal del candado: hoy o alguna vez.
	if (!cruzoElCandado(oportunidad)) {
		return { tipo: "nada" };
	}

	// El orden importa solo para el `razon` del aviso: una won al 100% cae por
	// las dos, y "won" es la razón más informativa —habla de contratos firmados,
	// no de una regla de etapas—.
	if (oportunidad.status === "won") {
		return { tipo: "solo_aviso", razon: "won" };
	}

	if (oportunidad.closurePercentage >= PORCENTAJE_SIN_RETROCESO) {
		return { tipo: "solo_aviso", razon: "formalizacion_final" };
	}

	return { tipo: "resetear" };
}

export const MOTIVO_AVISO: Record<"won" | "formalizacion_final", string> = {
	won: "la oportunidad está ganada y sus datos quedaron congelados con los contratos firmados; NO se revalidó y la evidencia de identidad puede ser de un DPI anterior",
	formalizacion_final:
		"la oportunidad está en Formalización Final o más allá (≥90%), desde donde el sistema no permite retroceder; NO se revalidó y la evidencia de identidad puede ser de un DPI anterior",
};

/**
 * Los campos que devuelven una oportunidad a análisis. Se expone como parche y
 * no como UPDATE propio porque `updateOpportunity` lo necesita DENTRO de su
 * propia sentencia: el reset y el cambio de status tienen que viajar juntos o
 * queda una ventana con la oportunidad reabierta y todavía validada.
 */
export function parcheDeRevalidacion(etapaDeAnalisisId: string) {
	return {
		stageId: etapaDeAnalisisId,
		analysisStatus: "pending" as const,
		creditDetailApproved: false,
	};
}

/**
 * La etapa de análisis, resuelta POR PORCENTAJE y no por nombre.
 *
 * `approveOpportunityAnalysis` la busca por su nombre literal ("Recepción de
 * documentación y traslado a análisis"); repetir ese string acá sumaría un
 * segundo lugar que hay que recordar el día que Marketing renombre la etapa. El
 * porcentaje es el dato que la regla de verdad usa.
 */
export async function obtenerEtapaDeAnalisis(
	database: Pick<typeof db, "select"> = db,
): Promise<{ id: string } | null> {
	const [etapa] = await database
		.select({ id: salesStages.id })
		.from(salesStages)
		.where(eq(salesStages.closurePercentage, PORCENTAJE_ETAPA_ANALISIS))
		.limit(1);

	return etapa ?? null;
}

export type ResultadoRevalidacion = {
	reseteadas: string[];
	avisadas: Array<{ id: string; razon: "won" | "formalizacion_final" }>;
};

/**
 * Aplica el reset a un conjunto de oportunidades y deja la bitácora.
 *
 * Lo usa el override del candado (`updateLead` / `updateCoDebtor`), que sí
 * puede escribir por su cuenta. `updateOpportunity` NO lo usa: necesita el
 * parche dentro de su propio UPDATE (ver `parcheDeRevalidacion`).
 */
export async function revalidarOportunidades(params: {
	oportunidades: OportunidadParaRevalidar[];
	accion: string;
	detalle: string;
	datosExtra?: Record<string, unknown>;
	anotar: (entrada: AuditEntry) => void;
	database?: Pick<typeof db, "select" | "update">;
}): Promise<ResultadoRevalidacion> {
	const database = params.database ?? db;
	const resultado: ResultadoRevalidacion = { reseteadas: [], avisadas: [] };

	for (const oportunidad of params.oportunidades) {
		if (!oportunidad.id) continue;
		const decision = decidirRevalidacion(oportunidad);

		if (decision.tipo === "resetear") {
			resultado.reseteadas.push(oportunidad.id);
		} else if (decision.tipo === "solo_aviso") {
			resultado.avisadas.push({ id: oportunidad.id, razon: decision.razon });
		}
	}

	if (resultado.reseteadas.length > 0) {
		const etapa = await obtenerEtapaDeAnalisis(database);

		// Sin la etapa de análisis no hay a dónde mandarlas. Se avisa y no se
		// escribe a medias: dejar `analysisStatus: pending` con la etapa al 40%
		// sería un estado que ninguna pantalla sabe leer.
		if (!etapa) {
			console.error(
				`[revalidarOportunidades] no existe etapa con closurePercentage=${PORCENTAJE_ETAPA_ANALISIS}; no se revalidó nada`,
			);
			for (const id of resultado.reseteadas) {
				params.anotar({
					entity: "opportunity",
					id,
					action: params.accion,
					data: {
						...params.datosExtra,
						detalle: params.detalle,
						resultado:
							"NO se pudo revalidar: no existe la etapa de análisis (30%)",
					},
					ok: false,
				});
			}
			return { reseteadas: [], avisadas: resultado.avisadas };
		}

		await database
			.update(opportunities)
			.set({ ...parcheDeRevalidacion(etapa.id), updatedAt: new Date() })
			.where(inArray(opportunities.id, resultado.reseteadas));

		for (const id of resultado.reseteadas) {
			params.anotar({
				entity: "opportunity",
				id,
				action: params.accion,
				data: {
					...params.datosExtra,
					detalle: params.detalle,
					resultado:
						"vuelve a la etapa de análisis (30%), analysisStatus pending y detalle de crédito sin aprobar",
				},
			});
		}
	}

	for (const { id, razon } of resultado.avisadas) {
		params.anotar({
			entity: "opportunity",
			id,
			action: params.accion,
			data: {
				...params.datosExtra,
				detalle: params.detalle,
				resultado: `NO se revalidó: ${MOTIVO_AVISO[razon]}`,
			},
			ok: false,
		});
	}

	return resultado;
}
