import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { db } from "../db";
import {
	opportunities,
	opportunityStageHistory,
	salesStages,
} from "../db/schema";
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

/**
 * La revalidación no se pudo completar, así que el cambio de identidad que la
 * disparó tampoco vale.
 *
 * 🔴 Es un error y no un valor de retorno a propósito: el llamador corre dentro
 * de una transacción y lo que tiene que pasar es un ROLLBACK. Devolver "no se
 * pudo" dejaba que el DPI nuevo se commiteara igual con la oportunidad todavía
 * aprobada contra la identidad vieja, que es el estado que todo esto existe
 * para que no exista.
 */
export class ErrorRevalidacionIncompleta extends Error {
	constructor(mensaje: string) {
		super(mensaje);
		this.name = "ErrorRevalidacionIncompleta";
	}
}

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

/**
 * ¿Esta edición SACA a la oportunidad de `lost`?
 *
 * 🔴 Antes se miraba solo `lost → open`, y el schema admite `on_hold`: la
 * escapatoria se rearmaba en dos saltos —perder, cambiar el DPI, pasar a
 * `on_hold`, y de ahí a `open`—, porque el segundo salto ya no sale de `lost` y
 * el primero no era "open". Con dos llamadas la revalidación no se disparaba
 * nunca y el expediente volvía a estar vivo con la evidencia de la identidad
 * vieja, que es justo lo que el reset existe para impedir.
 *
 * La pregunta correcta es la salida, no el destino: `lost` es el único estado
 * donde el DPI se puede cambiar (las perdidas no candan, por decisión de
 * producto), así que cualquier estado que no sea `lost` devuelve la oportunidad
 * a la vida y tiene que pagar la revalidación. `lost → won` incluido: ahí las
 * salvaguardas de `decidirRevalidacion` deciden que no se toca y solo se avisa,
 * pero el aviso queda.
 *
 * Una edición que no manda `status` no saca a nadie de ningún lado.
 */
export function saleDeLaPerdida(
	statusActual: string | null | undefined,
	statusNuevo: string | null | undefined,
): boolean {
	if (statusActual !== "lost") return false;
	if (statusNuevo === null || statusNuevo === undefined) return false;

	return statusNuevo !== "lost";
}

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
export function parcheDeRevalidacion(
	etapaDeAnalisisId: string,
	// 🔴 Por omisión la estampa el SERVIDOR al ejecutar el UPDATE, no nosotros
	// antes de entrar a la transacción. Con una fecha tomada de este lado, un
	// documento de identidad subido entre ese instante y el UPDATE —sobre todo
	// si el reset quedó esperando el candado de otra fila— tenía `uploadedAt`
	// POSTERIOR a la marca y pasaba por evidencia de la identidad nueva siendo
	// de la vieja. `clock_timestamp()` y no `now()`: `now()` devuelve el inicio
	// de la transacción, que es justo el borde que hay que dejar afuera.
	revalidadaEn: Date | SQL = sql`clock_timestamp()`,
) {
	return {
		...parcheDeIdentidadInvalidada(revalidadaEn),
		stageId: etapaDeAnalisisId,
		// ⚠️ Va DESPUÉS del spread a propósito, y es literal y no la degradación
		// condicional de `parcheDeIdentidadInvalidada`: este camino SÍ retrocede la
		// etapa a análisis, así que el análisis se rehace desde cero y el estado
		// con el que la oportunidad tiene que quedar es `pending`, venga de donde
		// venga.
		analysisStatus: "pending" as const,
	};
}

/**
 * 🔴 La mitad del parche que INVALIDA lo que se había validado, sin el retroceso
 * de etapa.
 *
 * Es la misma pieza de `parcheDeRevalidacion` —de hecho `parcheDeRevalidacion`
 * está escrito encima de esta, para que no puedan separarse—, expuesta aparte
 * porque hay un camino donde el retroceso NO corresponde: el cambio de `leadId`
 * por debajo o EN el umbral del candado (ver `updateOpportunity`). Ahí la
 * oportunidad está en 30% o menos —más arriba el candado ya bloqueó—, así que
 * mandarla a la etapa de análisis no la haría retroceder sino AVANZAR: una
 * oportunidad en 10% terminaría en la cola del analista sin haber pasado por
 * ventas. Lo que sí hay que cobrar es la invalidación, que es esto.
 *
 * ⚠️ `analysisStatus` sale como un `case` y no como `'pending'` literal por la
 * misma razón. `pending` significa "en el 30%, esperando revisión" y es lo que
 * habilita a `reviewOpportunityAnalysis`; escribirlo sobre una oportunidad en
 * `not_applicable` (nunca llegó a análisis) o `rejected` (rechazada, esperando
 * corrección) inventaría un estado que no ocurrió y borraría el rastro del
 * rechazo. La degradación solo tiene sentido sobre lo que de verdad estaba
 * aprobado, y va DENTRO de la sentencia —no en un `if` sobre la foto leída
 * antes— para que la decida la fila viva al momento de escribir: el mismo
 * patrón que el resto del candado. Con un `if` de este lado, una aprobación que
 * entrara entre la lectura y el UPDATE sobreviviría al cambio de lead.
 *
 * `creditDetailApproved` va incondicional: `false` es lo mismo que el `NULL` de
 * las filas viejas ("no aprobado"), así que escribirlo siempre no cambia nada
 * donde no había nada, y evita el predicado `= false` que dejaría fuera justo a
 * esas filas.
 */
export function parcheDeIdentidadInvalidada(
	// 🔴 Por omisión la estampa el SERVIDOR al ejecutar el UPDATE, no nosotros
	// antes de entrar a la transacción. Con una fecha tomada de este lado, un
	// documento de identidad subido entre ese instante y el UPDATE —sobre todo
	// si el reset quedó esperando el candado de otra fila— tenía `uploadedAt`
	// POSTERIOR a la marca y pasaba por evidencia de la identidad nueva siendo
	// de la vieja. `clock_timestamp()` y no `now()`: `now()` devuelve el inicio
	// de la transacción, que es justo el borde que hay que dejar afuera.
	revalidadaEn: Date | SQL = sql`clock_timestamp()`,
) {
	return {
		analysisStatus: sql`case when ${opportunities.analysisStatus} = 'approved' then 'pending' else ${opportunities.analysisStatus} end`,
		creditDetailApproved: false,
		// 🔴 La marca viaja en el MISMO UPDATE que el reset y solo alcanza a las
		// oportunidades que de verdad se resetearon. Es la mitad que le faltaba al
		// reset: mandar el expediente de vuelta a análisis no servía de nada
		// mientras el DPI escaneado de la identidad VIEJA siguiera satisfaciendo el
		// requisito. `approveOpportunityAnalysis` lee esta marca y deja de contar
		// los documentos de identidad anteriores a ella (ver
		// `documentosDeIdentidadVigentes`).
		identityRevalidatedAt: revalidadaEn,
	};
}

/**
 * Los tipos de documento que acreditan la identidad del TITULAR.
 *
 * `dpi` es el del flujo vigente; `identification` es la categoría general
 * heredada que sigue viva en expedientes viejos. Los demás documentos —recibos,
 * estados de cuenta, papeles del vehículo— no dicen quién es el solicitante y
 * no tienen por qué re-subirse porque el DPI haya cambiado.
 */
export const TIPOS_DOCUMENTO_IDENTIDAD = ["dpi", "identification"] as const;

export const MENSAJE_DPI_DESACTUALIZADO =
	"La identidad de esta solicitud fue revalidada (se corrigió o cambió el DPI), así que el documento de identidad que hay en el expediente es de la identidad anterior y ya no sirve para aprobar. Subí el DPI actualizado del solicitante y volvé a intentarlo.";

/**
 * Los documentos que todavía acreditan la identidad VIGENTE.
 *
 * Un documento de identidad subido ANTES de la revalidación es del DPI anterior:
 * sigue en el expediente —el historial no se toca— pero deja de satisfacer el
 * requisito. Sin esta regla, el reset se podía deshacer aprobando de nuevo con
 * el DPI escaneado de otra persona, que es justo lo que el reset existe para
 * impedir.
 *
 * Sin marca (`null`) no hay nada que comparar y pasa todo, como siempre.
 */
export function documentosDeIdentidadVigentes<
	T extends { documentType: string; uploadedAt: Date },
>(documentos: readonly T[], revalidadaEn: Date | null | undefined): T[] {
	if (!revalidadaEn) return [...documentos];

	const esIdentidad = new Set<string>(TIPOS_DOCUMENTO_IDENTIDAD);

	return documentos.filter(
		(documento) =>
			!esIdentidad.has(documento.documentType) ||
			documento.uploadedAt.getTime() >= revalidadaEn.getTime(),
	);
}

/**
 * ¿Lo que falta es el DPI, y falta porque quedó viejo y no porque nunca se
 * subió? Decide cuál de los dos mensajes leerá el analista.
 */
export function faltaPorIdentidadRevalidada(
	tiposFaltantes: readonly string[],
	tiposSubidos: readonly string[],
): boolean {
	const subidos = new Set(tiposSubidos);

	return tiposFaltantes.some(
		(tipo) =>
			(TIPOS_DOCUMENTO_IDENTIDAD as readonly string[]).includes(tipo) &&
			subidos.has(tipo),
	);
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
	/**
	 * Las que el snapshot daba por reseteables y el predicado del UPDATE dejó
	 * fuera: entre la lectura y la escritura alguien las ganó o las subió del
	 * 90%. Ver `sqlResetPermitido`.
	 */
	bloqueadasPorSalvaguarda: string[];
};

/**
 * 🔴 Las MISMAS salvaguardas de `decidirRevalidacion`, pero escritas en SQL para
 * meterlas en el WHERE del UPDATE.
 *
 * El snapshot y la escritura no son atómicos: entre que se leyó la oportunidad y
 * el UPDATE corre, otra transacción puede ganarla o subirla a Formalización
 * Final, y el reset la devolvía igual al 30% —una won en análisis, o un
 * retroceso desde el 90% que el resto del repo no admite—. Postgres re-evalúa el
 * predicado después de esperar a la escritura rival, así que con la condición
 * adentro la carrera se cierra. Es el mismo patrón que ya usan el candado del
 * DPI (`sqlCandanteDeLaOportunidad`) y `approveOpportunityAnalysis`.
 *
 * ⚠️ Las dos formas tienen que decir lo mismo: si tocás una, tocá la otra.
 *
 * La oportunidad cuya etapa no existe NO se resetea: sin porcentaje no se puede
 * afirmar que esté por debajo del 90, y ante la duda no se escribe.
 */
export function sqlResetPermitido(): SQL {
	return sql`
		${opportunities.status} <> 'won'
		and exists (
			select 1
			from ${salesStages} as s
			where s.id = ${opportunities.stageId}
				and s.closure_percentage < ${PORCENTAJE_SIN_RETROCESO}
		)
	`;
}

/**
 * Qué se escribió de verdad, contra lo que el snapshot esperaba escribir.
 *
 * Lo que el predicado excluyó no desaparece: se anota como no-reseteada, porque
 * una revalidación que no ocurrió es exactamente lo que alguien va a querer
 * buscar después.
 */
export function separarPorSalvaguarda(
	esperadas: readonly string[],
	devueltas: readonly string[],
): { aplicadas: string[]; bloqueadas: string[] } {
	const escritas = new Set(devueltas);

	return {
		aplicadas: esperadas.filter((id) => escritas.has(id)),
		bloqueadas: esperadas.filter((id) => !escritas.has(id)),
	};
}

/**
 * El `reason` de la fila de `opportunityStageHistory`. Es lo que va a leer
 * quien mire el timeline y encuentre a la solicitud de vuelta en análisis: sin
 * esto, el retroceso aparece sin causa y parece un error de alguien.
 */
export const RAZON_TRANSICION_REVALIDACION =
	"Revalidación de identidad (retroceso a análisis)";

export const MOTIVO_SALVAGUARDA =
	"NO se revalidó: entre la lectura y la escritura la oportunidad quedó ganada o en Formalización Final (≥90%), donde el reset no se aplica; la evidencia de identidad puede ser de un DPI anterior";

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
	/**
	 * Quién responde por el retroceso de etapa. Va a
	 * `opportunityStageHistory.changedBy`, que es NOT NULL: el timeline no
	 * admite una transición sin autor, y acá el autor es quien hizo la maniobra
	 * que costó la revalidación (el admin que abrió el candado).
	 */
	cambiadaPor: string;
	database?: Pick<typeof db, "select" | "update" | "insert">;
}): Promise<ResultadoRevalidacion> {
	const database = params.database ?? db;
	const resultado: ResultadoRevalidacion = {
		reseteadas: [],
		avisadas: [],
		bloqueadasPorSalvaguarda: [],
	};

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

		// 🔴 Sin la etapa de análisis no hay a dónde mandarlas, y eso es un FALLO,
		// no un aviso. Antes se anotaba y se seguía: el llamador commiteaba igual
		// el cambio de identidad y la oportunidad quedaba viva y aprobada contra la
		// identidad VIEJA — el agujero entero, con una fila de bitácora que nadie
		// mira en el momento. Ahora lanza; y como la revalidación corre DENTRO de
		// la transacción que cambia la identidad, el throw revierte también ese
		// cambio: o se revalida, o no se cambia.
		if (!etapa) {
			throw new ErrorRevalidacionIncompleta(
				`No se pudo revalidar la identidad: no existe la etapa de análisis (closurePercentage=${PORCENTAJE_ETAPA_ANALISIS}). El cambio de identidad se revirtió.`,
			);
		}

		// La etapa de la que sale cada una, leída ANTES del UPDATE: `RETURNING`
		// devuelve la fila NUEVA, así que después del reset el dato ya no existe y
		// el `from` del timeline quedaría en blanco.
		const etapaPrevia = new Map(
			(
				await database
					.select({ id: opportunities.id, stageId: opportunities.stageId })
					.from(opportunities)
					.where(inArray(opportunities.id, resultado.reseteadas))
			).map((fila) => [fila.id, fila.stageId]),
		);

		// Las salvaguardas viajan DENTRO del UPDATE, no solo en el snapshot: ver
		// `sqlResetPermitido`. Lo que vuelve es lo que se escribió de verdad.
		const devueltas = await database
			.update(opportunities)
			.set({ ...parcheDeRevalidacion(etapa.id), updatedAt: new Date() })
			.where(
				and(
					inArray(opportunities.id, resultado.reseteadas),
					sqlResetPermitido(),
				),
			)
			.returning({ id: opportunities.id });

		const { aplicadas, bloqueadas } = separarPorSalvaguarda(
			resultado.reseteadas,
			devueltas.map((fila) => fila.id),
		);

		resultado.reseteadas = aplicadas;
		resultado.bloqueadasPorSalvaguarda = bloqueadas;

		// 🔴 El reset movía `stageId` sin dejar la transición en
		// `opportunityStageHistory`. Para los timelines y para
		// `latestStageChangedAt` la oportunidad seguía en la etapa avanzada: el
		// retroceso era invisible, y la pantalla mostraba una historia que termina
		// en el 40% con la solicitud parada en el 30%. Peor todavía, el tiempo en
		// etapa se seguía contando desde la última transición registrada, que ya no
		// era la real.
		//
		// Va en la MISMA transacción del reset y solo por las que de verdad se
		// escribieron: una transición de una oportunidad que la salvaguarda dejó
		// intacta sería una fila que miente.
		if (aplicadas.length > 0) {
			await database.insert(opportunityStageHistory).values(
				aplicadas.map((id) => ({
					opportunityId: id,
					fromStageId: etapaPrevia.get(id) ?? null,
					toStageId: etapa.id,
					changedBy: params.cambiadaPor,
					reason: `${RAZON_TRANSICION_REVALIDACION}: ${params.detalle}`,
					// `isOverride` es del flujo de ventas-vs-análisis (ventas pisó la
					// decisión del analista); este retroceso no es eso.
					isOverride: false,
				})),
			);
		}

		for (const id of bloqueadas) {
			params.anotar({
				entity: "opportunity",
				id,
				action: params.accion,
				data: {
					...params.datosExtra,
					detalle: params.detalle,
					resultado: MOTIVO_SALVAGUARDA,
				},
				ok: false,
			});
		}

		for (const id of aplicadas) {
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
