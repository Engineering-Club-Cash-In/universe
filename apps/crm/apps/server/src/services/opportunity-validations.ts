import { createClientFromEnv, isNotFoundError } from "@repo/infornet";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, gt, type SQL, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { getOnlyRenapInfoController } from "../controllers/bot";
import { infornetController } from "../controllers/buro";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { infornetPersonaCache } from "../db/schema/buro";
import { coDebtors, leads, opportunities, salesStages } from "../db/schema/crm";
import {
	documentRequirementsByClientType,
	opportunityDocuments,
} from "../db/schema/documents";
import { otps } from "../db/schema/otp";
import { renapInfo } from "../db/schema/renap";
import {
	opportunityValidationOverrideLogs,
	opportunityValidations,
} from "../db/schema/validations";
import { auditedTransaction, auditRecord } from "../lib/audit";
import { evaluarBuro } from "../lib/buro-evaluation";
import { tomarCandadoBuroSiLibre } from "../lib/candado-consulta-buro";
import { eqDpi } from "../lib/dpi-lookup";
import {
	isOpportunityFromSource,
	type LeadSource,
} from "../lib/lead-opportunity-source";
import { CONSULTAR_RENAP } from "../lib/renap-config";
import { normalizarDpi, validarDpi } from "../utils/cui-validation";

const REINTENTOS_AUTOMATICOS = 1;
const ESPERA_ENTRE_REINTENTOS_MS = 800;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Lector = Pick<Transaction, "select">;

/** El `fetch` de RENAP no lleva `AbortSignal`, así que la cota se aplica acá */
const TIMEOUT_RENAP_MS = 30_000;

const MENSAJE_SIN_REGISTRO_BURO = "Sin registro en el buró de Infornet";

const MENSAJE_TIMEOUT_RENAP = "RENAP no respondió";

/** Un "sin registro" vale lo mismo que un estudio: si Infornet no tiene a la persona hoy, tampoco mañana */
const VIGENCIA_SIN_REGISTRO_MS = 30 * 24 * 60 * 60 * 1000;

/** Mensaje de Infornet que no distingue "sin registro" de un fallo real */
const ERROR_INFORNET_AMBIGUO = "Persona no encontrada en Infornet";

/** Mensaje crudo de `buro.ts` cuando no hay RENAP local para el DPI; se reescribe abajo para no confundir con un problema de RENAP */
const ERROR_BURO_SIN_RENAP_LOCAL = "DPI no encontrado en RENAP";

/** Vigencia de un override manual de Buró: igual al TTL normal de un veredicto real de Infornet */
const VIGENCIA_OVERRIDE_BURO_MS = 30 * 24 * 60 * 60 * 1000;

export class OportunidadNoEncontradaError extends Error {
	constructor() {
		super("Oportunidad no encontrada");
		this.name = "OportunidadNoEncontradaError";
	}
}

export class OverrideNoAplicaError extends Error {
	constructor(tipo: "buro" | "renap") {
		super(
			`No hay un error de ${tipo === "buro" ? "Buró" : "RENAP"} vigente para esta oportunidad; actualiza la página.`,
		);
		this.name = "OverrideNoAplicaError";
	}
}

export class OverrideDpiInvalidoError extends Error {
	constructor(sujeto: SujetoValidacion = "titular") {
		super(
			sujeto === "cofirmante"
				? "El DPI del cofirmante tiene un formato inválido — corregilo en la ficha del cofirmante. Un override no lo resuelve: la aprobación va a seguir bloqueada por el mismo motivo."
				: "El DPI del lead tiene un formato inválido — corregilo en la ficha del lead. Un override no lo resuelve: la aprobación va a seguir bloqueada por el mismo motivo.",
		);
		this.name = "OverrideDpiInvalidoError";
	}
}

export class CofirmanteNoEncontradoError extends Error {
	constructor() {
		super("Cofirmante no encontrado en esta oportunidad");
		this.name = "CofirmanteNoEncontradoError";
	}
}

export type SujetoValidacion = "titular" | "cofirmante";

export type EstadoValidacion =
	| "aprobado"
	| "rechazado"
	| "error"
	| "sin_registro";

export type ValidacionOportunidad = typeof opportunityValidations.$inferSelect;

export type ResultadoEjecucionValidaciones = {
	exento: boolean;
	faltaDpi: boolean;
	errorTecnico: boolean;
	sinRegistroBuro: boolean;
	mensaje?: string;
	renap?: {
		estado: EstadoValidacion;
		mensaje: string | null;
	};
	buro?: {
		estado: EstadoValidacion;
		mensaje: string | null;
		scoreRiesgo: number | null;
		nivelRiesgo: string | null;
		alertas: string[] | null;
		fuenteDeDatos: string | null;
	};
};

/** Resumen de lo que devolvió RENAP, leído de `renapinfo` */
export type DetalleRenap = {
	nombreCompleto: string;
	fechaNacimiento: string | null;
	genero: string | null;
	estadoCivil: string | null;
	nacionalidad: string | null;
	ocupacion: string | null;
	vigenciaDpi: string | null;
	fechaDefuncion: string | null;
};

/** Resumen del estudio de Infornet, leído de `infornet_persona_cache` */
export type DetalleBuro = {
	codigoPersona: number;
	nombreCompleto: string;
	tieneReferenciasComerciales: boolean;
	tieneReferenciasJudiciales: boolean;
	esPEP: boolean;
	cantidadInmuebles: number | null;
	cantidadVehiculos: number | null;
	cantidadEmpresas: number | null;
	consultadoEn: Date;
	expiraEn: Date;
};

/** Detalle de un override manual: quién lo marcó, por qué y cuándo */
export type OverrideInfo = {
	motivo: string | null;
	marcadoPorNombre: string | null;
	marcadoAt: Date;
};

/** Buró de un cofirmante, con la misma forma que el del titular */
export type EstadoBuroCofirmante = {
	coDebtorId: string;
	nombre: string;
	/** DPI actual del cofirmante, normalizado */
	dpi: string;
	buro: ValidacionOportunidad | null;
	buroVigente: boolean;
	/** La fila mostrada es de un DPI distinto al actual del cofirmante */
	buroDesactualizado: boolean;
	detalleBuro: DetalleBuro | null;
	overrideBuro: OverrideInfo | null;
};

export type ResultadoBuroCofirmante = {
	coDebtorId: string;
	nombre: string;
	dpi: string;
	buro: NonNullable<ResultadoEjecucionValidaciones["buro"]>;
};

export type ResultadoEjecucionCofirmantes = {
	exento: boolean;
	/** Algún cofirmante quedó sin veredicto: bloquea la aprobación igual que el titular */
	errorTecnico: boolean;
	mensaje?: string;
	cofirmantes: ResultadoBuroCofirmante[];
};

export type EstadoValidacionesOportunidad = {
	exento: boolean;
	faltaDpi: boolean;
	dpi: string | null;
	renap: ValidacionOportunidad | null;
	buro: ValidacionOportunidad | null;
	buroVigente: boolean;
	aprobacionBloqueada: boolean;
	/** Declara origen bot pero no hay evidencia de que el bot la validara */
	origenBotSinEvidencia: boolean;
	/** El tipo de cliente exige cláusula de consentimiento y todavía no está cargada */
	faltaConsentimiento: boolean;
	/** Espera decisión de análisis; si no, no se valida sola */
	enAnalisisPendiente: boolean;
	/** true si Buró o RENAP (o ambos) se ejecutaron con un DPI distinto al actual */
	dpiDesactualizado: boolean;
	/** La fila de Buró mostrada es de un DPI distinto al actual del lead */
	buroDesactualizado: boolean;
	/** La fila de RENAP mostrada es de un DPI distinto al actual del lead */
	renapDesactualizado: boolean;
	detalleRenap: DetalleRenap | null;
	detalleBuro: DetalleBuro | null;
	/** Presente solo si `buro.fuenteDeDatos === 'manual'` */
	overrideBuro: OverrideInfo | null;
	/** Presente solo si `renap.fuenteDeDatos === 'manual'` */
	overrideRenap: OverrideInfo | null;
	/** Bitácora del titular; las filas de cofirmantes van en `cofirmantes` */
	validaciones: ValidacionOportunidad[];
	/** Vacío si la oportunidad no tiene cofirmantes o está exenta */
	cofirmantes: EstadoBuroCofirmante[];
};

const esperar = (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** Corta la espera; la promesa original sigue corriendo pero ya no bloquea */
async function conTimeout<T>(
	ejecutar: () => Promise<T>,
	ms: number,
	alExpirar: () => T,
): Promise<T> {
	let temporizador: ReturnType<typeof setTimeout> | undefined;

	try {
		return await Promise.race([
			ejecutar(),
			new Promise<T>((resolve) => {
				temporizador = setTimeout(() => resolve(alExpirar()), ms);
			}),
		]);
	} finally {
		if (temporizador) clearTimeout(temporizador);
	}
}

/** Reintenta una vez ante fallos transitorios; `noReintentar` corta el ciclo */
async function conReintento<T>(
	ejecutar: () => Promise<T>,
	noReintentar: (resultado: T) => boolean,
): Promise<T> {
	let resultado = await ejecutar();
	for (
		let intento = 0;
		intento < REINTENTOS_AUTOMATICOS && !noReintentar(resultado);
		intento++
	) {
		await esperar(ESPERA_ENTRE_REINTENTOS_MS);
		resultado = await ejecutar();
	}
	return resultado;
}

/** `buro.ts` usa el mismo mensaje para "sin registro" y para un fallo real */
async function clasificarFalloInfornet(
	dpi: string,
): Promise<"tecnico" | "sin_registro"> {
	try {
		const personas = await createClientFromEnv().busquedaPersona({
			orden: "DPI",
			registro: dpi,
			pais: "GT",
		});

		return personas.length === 0 ? "sin_registro" : "tecnico";
	} catch (error) {
		// Sin registro llega como excepción 00002, no como lista vacía
		return isNotFoundError(error) ? "sin_registro" : "tecnico";
	}
}

/** `sin_registro` vigente para ese DPI: evita repetir la búsqueda de clasificación. Devuelve su vigencia para heredarla, nunca para renovarla */
async function sinRegistroVigentePorDpi(dpi: string): Promise<Date | null> {
	const [fila] = await db
		.select({ expiraEn: opportunityValidations.expiraEn })
		.from(opportunityValidations)
		.where(
			and(
				eq(opportunityValidations.tipo, "buro"),
				eq(opportunityValidations.estado, "sin_registro"),
				eq(opportunityValidations.dpi, dpi),
				gt(opportunityValidations.expiraEn, new Date()),
				// Un "sin registro" manual no es evidencia de que Infornet no tenga a
				// la persona: no debe filtrarse a la clasificación automática de otra
				// oportunidad con el mismo DPI
				sql`${opportunityValidations.fuenteDeDatos} IS DISTINCT FROM 'manual'`,
			),
		)
		.orderBy(desc(opportunityValidations.expiraEn))
		.limit(1);

	return fila?.expiraEn ?? null;
}

/** Filas de la bitácora de UN sujeto: el titular (`coDebtorId` null) o ese cofirmante */
function delSujeto(coDebtorId: string | null) {
	return coDebtorId
		? eq(opportunityValidations.coDebtorId, coDebtorId)
		: eq(opportunityValidations.sujeto, "titular");
}

async function registrarValidacion(
	valores: {
		opportunityId: string;
		/** null o ausente = titular */
		coDebtorId?: string | null;
		dpi: string;
		tipo: "renap" | "buro";
		estado: EstadoValidacion;
		mensaje?: string | null;
		scoreRiesgo?: number | null;
		nivelRiesgo?: string | null;
		alertas?: string[] | null;
		fuenteDeDatos?: string | null;
		expiraEn?: Date | null;
		ejecutadoPor?: string | null;
	},
	escritor?: Pick<Transaction, "insert">,
): Promise<void> {
	const insertar = (tx: Pick<Transaction, "insert">) =>
		tx.insert(opportunityValidations).values({
			opportunityId: valores.opportunityId,
			sujeto: valores.coDebtorId ? "cofirmante" : "titular",
			coDebtorId: valores.coDebtorId ?? null,
			dpi: valores.dpi,
			tipo: valores.tipo,
			estado: valores.estado,
			mensaje: valores.mensaje ?? null,
			scoreRiesgo: valores.scoreRiesgo ?? null,
			nivelRiesgo: valores.nivelRiesgo ?? null,
			alertas: valores.alertas ?? null,
			fuenteDeDatos: valores.fuenteDeDatos ?? null,
			expiraEn: valores.expiraEn ?? null,
			ejecutadoPor: valores.ejecutadoPor ?? null,
		});
	if (escritor) {
		await insertar(escritor);
		return;
	}
	await db.transaction(async (tx) => {
		// Candado por oportunidad (no por DPI, que es mutable): serializa contra
		// cualquier otra escritura a esta bitácora, incluida un override
		// concurrente (mismo candado en `marcarValidacionManualCritico`) —
		// necesario porque bajo READ COMMITTED un simple "insertar solo si..." no alcanza
		await tomarCandadoBuroSiLibre(tx, valores.opportunityId);

		await insertar(tx);
	});
}

async function cargarOportunidadConLead(
	opportunityId: string,
	lector: Lector = db,
): Promise<{
	source: LeadSource | null;
	leadSource: LeadSource | null;
	leadId: string | null;
	leadDpi: string | null;
	clientType: string | null;
	creditType: string;
	analysisStatus: string;
} | null> {
	const [row] = await lector
		.select({
			source: opportunities.source,
			leadSource: leads.source,
			leadId: opportunities.leadId,
			leadDpi: leads.dpi,
			clientType: leads.clientType,
			creditType: opportunities.creditType,
			analysisStatus: opportunities.analysisStatus,
		})
		.from(opportunities)
		.leftJoin(leads, eq(opportunities.leadId, leads.id))
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	return row ?? null;
}

/** El OTP se marca usado justo antes de consultar el buró; probar que el bot llegó ahí (el magic URL no) exige además estudio vigente */
async function elBotValidoAlLead(
	leadId: string | null,
	leadDpi: string | null,
	lector: Lector = db,
): Promise<boolean> {
	if (!leadId || !leadDpi) return false;

	const [otpCompletado] = await lector
		.select({ id: otps.id })
		.from(otps)
		.where(
			and(
				eq(otps.leadId, leadId),
				eq(otps.used, true),
				// El DPI del lead pudo cambiar: un OTP de otro DPI no sirve como evidencia
				eqDpi(otps.dpi, leadDpi),
			),
		)
		.limit(1);

	if (!otpCompletado) return false;

	const [estudioVigente] = await lector
		.select({ dpi: infornetPersonaCache.dpi })
		.from(infornetPersonaCache)
		.where(
			and(
				eq(infornetPersonaCache.dpi, normalizarDpi(leadDpi)),
				gt(infornetPersonaCache.expiraEn, new Date()),
			),
		)
		.limit(1);

	return Boolean(estudioVigente);
}

export type ResolucionExencion = {
	exento: boolean;
	/** Declara origen bot pero el bot no lo validó, o el veredicto venció */
	origenBotSinEvidencia: boolean;
};

/** Una oportunidad ya validada no vuelve a ser exenta: escondería su propio veredicto. Solo cuenta el titular, que es a quien valida el bot */
async function yaTieneBitacora(
	opportunityId: string,
	lector: Lector = db,
): Promise<boolean> {
	const [fila] = await lector
		.select({ id: opportunityValidations.id })
		.from(opportunityValidations)
		.where(
			and(
				eq(opportunityValidations.opportunityId, opportunityId),
				delSujeto(null),
			),
		)
		.limit(1);

	return Boolean(fila);
}

/** Único punto donde se resuelve la exención; lo usan el servicio y el gate */
export async function resolverExencionPorBot(
	oportunidad: {
		opportunityId: string;
		source: LeadSource | null;
		leadSource: LeadSource | null;
		leadId: string | null;
		leadDpi: string | null;
	},
	lector: Lector = db,
): Promise<ResolucionExencion> {
	const declaraOrigenBot = isOpportunityFromSource(
		oportunidad.source,
		"Whatsapp",
		oportunidad.leadSource ?? "other",
	);

	if (!declaraOrigenBot) {
		return { exento: false, origenBotSinEvidencia: false };
	}

	// Si ya se validó, el veredicto es de esta oportunidad y tiene que verse
	if (await yaTieneBitacora(oportunidad.opportunityId, lector)) {
		return { exento: false, origenBotSinEvidencia: false };
	}

	const validadaPorElBot = await elBotValidoAlLead(
		oportunidad.leadId,
		oportunidad.leadDpi,
		lector,
	);

	return {
		exento: validadaPorElBot,
		origenBotSinEvidencia: !validadaPorElBot,
	};
}

const DOCUMENTO_CONSENTIMIENTO = "clausula_consentimiento";

/** Estados en los que la oportunidad espera decisión de análisis */
const ESTADOS_EN_ANALISIS = ["pending", "resubmitted"];

/** Consultar el buró sin la cláusula firmada no corresponde; se lee del catálogo, no se asume el tipo de cliente */
export async function faltaConsentimientoDelTitular(
	opportunityId: string,
	clientType: string | null,
	creditType: string,
	lector: Lector = db,
): Promise<boolean> {
	const [exigido] = await lector
		.select({ tipo: documentRequirementsByClientType.documentType })
		.from(documentRequirementsByClientType)
		.where(
			and(
				eq(
					documentRequirementsByClientType.clientType,
					(clientType ?? "individual") as "individual",
				),
				eq(
					documentRequirementsByClientType.creditType,
					creditType as "autocompra",
				),
				eq(
					documentRequirementsByClientType.documentType,
					DOCUMENTO_CONSENTIMIENTO,
				),
				eq(documentRequirementsByClientType.required, true),
			),
		)
		.limit(1);

	if (!exigido) return false;

	const [cargado] = await lector
		.select({ id: opportunityDocuments.id })
		.from(opportunityDocuments)
		.where(
			and(
				eq(opportunityDocuments.opportunityId, opportunityId),
				eq(opportunityDocuments.documentType, DOCUMENTO_CONSENTIMIENTO),
			),
		)
		.limit(1);

	return !cargado;
}

const filaPorDpi = new Map<string, Promise<unknown>>();

/** El caché de Infornet es por DPI: dos oportunidades de la misma persona se encolan para no pagar dos veces */
function enFilaPorDpi<T>(dpi: string, ejecutar: () => Promise<T>): Promise<T> {
	const anterior = filaPorDpi.get(dpi) ?? Promise.resolve();
	const propia = anterior.then(ejecutar, ejecutar);
	const marcador = propia.catch(() => undefined);

	filaPorDpi.set(dpi, marcador);
	marcador.finally(() => {
		if (filaPorDpi.get(dpi) === marcador) filaPorDpi.delete(dpi);
	});

	return propia;
}

type ReusoRenap = { estado: EstadoValidacion; mensaje: string | null };
type ReusoBuro = NonNullable<ResultadoEjecucionValidaciones["buro"]>;

/**
 * Vigencia de RENAP y Buró para ese DPI, evaluada de forma independiente por
 * fuente (no se comparan cronológicamente entre sí). RENAP vigente = última
 * fila no es error; Buró vigente = última fila no es error y `expiraEn`
 * sigue en el futuro.
 */
async function cargarVigenciasPorFuente(
	opportunityId: string,
	dpi: string,
	coDebtorId: string | null,
): Promise<{ renap: ReusoRenap | null; buro: ReusoBuro | null }> {
	const filas = await db
		.select()
		.from(opportunityValidations)
		.where(
			and(
				eq(opportunityValidations.opportunityId, opportunityId),
				eq(opportunityValidations.dpi, dpi),
				delSujeto(coDebtorId),
			),
		)
		.orderBy(desc(opportunityValidations.ejecutadoAt));

	const ultimoRenap = filas.find((f) => f.tipo === "renap");
	const ultimoBuro = filas.find((f) => f.tipo === "buro");

	const renap: ReusoRenap | null =
		ultimoRenap && ultimoRenap.estado !== "error"
			? { estado: ultimoRenap.estado, mensaje: ultimoRenap.mensaje }
			: null;

	const buro: ReusoBuro | null =
		ultimoBuro &&
		ultimoBuro.estado !== "error" &&
		ultimoBuro.expiraEn &&
		ultimoBuro.expiraEn > new Date()
			? {
					estado: ultimoBuro.estado,
					mensaje: ultimoBuro.mensaje,
					scoreRiesgo: ultimoBuro.scoreRiesgo,
					nivelRiesgo: ultimoBuro.nivelRiesgo,
					alertas: ultimoBuro.alertas,
					fuenteDeDatos: ultimoBuro.fuenteDeDatos,
				}
			: null;

	return { renap, buro };
}

const validacionesEnCurso = new Map<string, Promise<unknown>>();

/** Llave de la validación de un sujeto con su DPI actual; la comparten el mutex y los overrides */
function claveDeValidacion(
	opportunityId: string,
	dpi: string,
	coDebtorId: string | null,
): string {
	return coDebtorId
		? `${opportunityId}:cofirmante:${coDebtorId}:${dpi}`
		: `${opportunityId}:${dpi}`;
}

/** Reusa la validación en curso del mismo sujeto+DPI en vez de disparar otra; vive en memoria para no retener una conexión del pool durante llamadas externas */
function conMutexDeOportunidad<T>(
	clave: string,
	ejecutar: () => Promise<T>,
): Promise<T> {
	const enCurso = validacionesEnCurso.get(clave) as Promise<T> | undefined;
	if (enCurso) return enCurso;

	const validacion = ejecutar().finally(() => {
		validacionesEnCurso.delete(clave);
	});

	validacionesEnCurso.set(clave, validacion);

	return validacion;
}

/** Overrides manuales en curso, misma llave que `conMutexDeOportunidad`: solo coordina turnos con una validación real concurrente, no cachea resultado */
const overridesEnCurso = new Map<string, Promise<unknown>>();

/** Señal de "el DPI cambió mientras se esperaba el turno": nunca sale de este archivo */
const DPI_CAMBIO_DURANTE_ESPERA = Symbol("dpi-cambio-durante-espera");

/** Valida RENAP y Buró para oportunidades no-bot y registra el resultado */
export async function ejecutarValidaciones(parametros: {
	opportunityId: string;
	userId?: string | null;
	/** El gate reusa un veredicto vigente; el botón manual siempre re-consulta */
	reusarVigente?: boolean;
}): Promise<ResultadoEjecucionValidaciones> {
	// El DPI se relee en cada vuelta: puede cambiar mientras se espera un
	// override en curso, y la llave tiene que reflejar el DPI actual antes
	// de entrar al mutex (mismo patrón que `marcarValidacionManual`). Se
	// pasa esta misma lectura a `ejecutarValidacionesInterno` en vez de que
	// vuelva a leerla: una segunda lectura independiente podría ver un DPI
	// distinto al que ya decidió la llave, sin que nada la re-ancle.
	for (;;) {
		const oportunidad = await cargarOportunidadConLead(
			parametros.opportunityId,
		);
		const claveDpi = oportunidad?.leadDpi
			? normalizarDpi(oportunidad.leadDpi)
			: "sin-dpi";
		const clave = claveDeValidacion(parametros.opportunityId, claveDpi, null);

		const overrideEnCurso = overridesEnCurso.get(clave);
		if (overrideEnCurso) {
			await overrideEnCurso.catch(() => undefined);
			continue;
		}

		return conMutexDeOportunidad(clave, () =>
			ejecutarValidacionesInterno({ ...parametros, oportunidad }),
		);
	}
}

async function ejecutarValidacionesInterno({
	opportunityId,
	oportunidad,
	userId,
	reusarVigente,
}: {
	opportunityId: string;
	oportunidad: Awaited<ReturnType<typeof cargarOportunidadConLead>>;
	userId?: string | null;
	reusarVigente?: boolean;
}): Promise<ResultadoEjecucionValidaciones> {
	if (!oportunidad) {
		return {
			exento: false,
			faltaDpi: false,
			errorTecnico: true,
			sinRegistroBuro: false,
			mensaje: "Oportunidad no encontrada",
		};
	}

	const exencion = await resolverExencionPorBot({
		opportunityId,
		...oportunidad,
	});

	if (exencion.exento) {
		return {
			exento: true,
			faltaDpi: false,
			errorTecnico: false,
			sinRegistroBuro: false,
		};
	}

	if (!oportunidad.leadDpi) {
		return {
			exento: false,
			faltaDpi: true,
			errorTecnico: false,
			sinRegistroBuro: false,
		};
	}

	// `getOnlyRenapInfoController` no valida el formato; un DPI malo revienta en Centinela
	const dpiValidado = validarDpi(oportunidad.leadDpi);

	if (!dpiValidado.valid) {
		await registrarValidacion({
			opportunityId,
			dpi: normalizarDpi(oportunidad.leadDpi),
			tipo: CONSULTAR_RENAP ? "renap" : "buro",
			estado: "error",
			mensaje: dpiValidado.error,
			ejecutadoPor: userId ?? null,
		});

		return {
			exento: false,
			faltaDpi: false,
			errorTecnico: true,
			sinRegistroBuro: false,
			mensaje: dpiValidado.error,
			...(CONSULTAR_RENAP
				? { renap: { estado: "error" as const, mensaje: dpiValidado.error } }
				: {
						buro: {
							estado: "error" as const,
							mensaje: dpiValidado.error,
							scoreRiesgo: null,
							nivelRiesgo: null,
							alertas: null,
							fuenteDeDatos: null,
						},
					}),
		};
	}

	const dpi = dpiValidado.dpiLimpio;

	let renapVigente: ReusoRenap | null = null;
	let buroVigente: ReusoBuro | null = null;

	if (reusarVigente) {
		({ renap: renapVigente, buro: buroVigente } =
			await cargarVigenciasPorFuente(opportunityId, dpi, null));
	}

	// 1. RENAP: sincronizar datos de identidad en renap_info (se salta si ya está vigente)
	let renapResumen: ReusoRenap | undefined;
	let buroProtegido: ReusoBuro | undefined;

	if (!CONSULTAR_RENAP) {
		// Deshabilitado: sin consulta no hay veredicto de RENAP que registrar ni que bloquee
	} else if (renapVigente) {
		renapResumen = renapVigente;
	} else {
		const consultaRenap = await conCandadoDuranteConsulta(
			opportunityId,
			async (escritor) => {
				await validarContextoConsultaProtegida({
					opportunityId,
					dpi,
					coDebtorId: null,
					lector: escritor,
					fuente: "RENAP",
				});
				const resultado = await conReintento(
					() =>
						conTimeout(
							() => getOnlyRenapInfoController(dpi),
							TIMEOUT_RENAP_MS,
							() => ({
								success: false as const,
								message: MENSAJE_TIMEOUT_RENAP,
								error: null,
							}),
						),
					// El timeout deja la petición original en vuelo: reintentar la duplicaría
					(r) => r.success || r.message === MENSAJE_TIMEOUT_RENAP,
				);
				const resumen = resultado.success
					? {
							estado: "aprobado" as const,
							mensaje: "Datos de RENAP sincronizados",
						}
					: {
							estado: "error" as const,
							mensaje: resultado.message || null,
						};
				const mensaje = resultado.success
					? null
					: resultado.message || "Error desconocido al consultar RENAP";

				await registrarValidacion(
					{
						opportunityId,
						dpi,
						tipo: "renap",
						estado: resumen.estado,
						mensaje: resultado.success
							? "Datos de RENAP sincronizados"
							: mensaje,
						ejecutadoPor: userId ?? null,
					},
					escritor,
				);

				let tieneRenapPrevio = resultado.success;
				if (!resultado.success) {
					// Infornet exige el DPI en renap_info: con sincronización previa se continúa
					const [renapPrevio] = await escritor
						.select({ dpi: renapInfo.dpi })
						.from(renapInfo)
						.where(eqDpi(renapInfo.dpi, dpi))
						.limit(1);
					tieneRenapPrevio = Boolean(renapPrevio);
				}
				const buro = tieneRenapPrevio
					? (buroVigente ??
						(await consultarBuro(
							{ opportunityId, dpi, coDebtorId: null, userId },
							escritor,
						)))
					: undefined;
				return {
					resumen,
					mensaje,
					tieneRenapPrevio,
					buro,
				};
			},
		);
		renapResumen = consultaRenap.resumen;
		buroProtegido = consultaRenap.buro;
		if (!consultaRenap.tieneRenapPrevio) {
			return {
				exento: false,
				faltaDpi: false,
				errorTecnico: true,
				sinRegistroBuro: false,
				mensaje: `RENAP: ${consultaRenap.mensaje}`,
				renap: renapResumen,
			};
		}
	}

	// Sigue siendo un fallo actual aunque se haya continuado hacia Buró: cada fuente bloquea por su cuenta
	const renapFalloAhora = renapResumen?.estado === "error";

	// 2. Buró: usa el caché de 30 días (se salta si ya está vigente, incluido un
	// override manual)
	const buro =
		buroProtegido ??
		buroVigente ??
		(await consultarBuro({ opportunityId, dpi, coDebtorId: null, userId }));
	const buroFallo = buro.estado === "error";

	return {
		exento: false,
		faltaDpi: false,
		// Sin registro no es fallo de la fuente: no bloquea por su cuenta,
		// pero un RENAP recién fallido sigue bloqueando igual
		errorTecnico: buroFallo || renapFalloAhora,
		sinRegistroBuro: buro.estado === "sin_registro",
		mensaje: buroFallo
			? `Buró: ${buro.mensaje}`
			: renapFalloAhora
				? `RENAP: ${renapResumen?.mensaje}`
				: undefined,
		renap: renapResumen,
		buro,
	};
}

const MAX_CONSULTAS_CON_CANDADO = 2;
let consultasConCandado = 0;
const esperaCandado: Array<() => void> = [];

/** Usa una conexión dedicada y deja libre el pool que Infornet necesita. */
async function conCandadoDuranteConsulta<T>(
	opportunityId: string,
	consultar: (escritor: NodePgDatabase) => Promise<T>,
): Promise<T> {
	if (consultasConCandado >= MAX_CONSULTAS_CON_CANDADO) {
		await new Promise<void>((resolver) => esperaCandado.push(resolver));
	} else {
		consultasConCandado++;
	}
	try {
		const cliente = new Client({ connectionString: process.env.DATABASE_URL });
		let conectado = false;
		let candadoTomado = false;
		try {
			await cliente.connect();
			conectado = true;
			await cliente.query("select pg_advisory_lock(hashtext($1))", [
				opportunityId,
			]);
			candadoTomado = true;
			return await consultar(drizzle(cliente));
		} finally {
			try {
				if (conectado && candadoTomado) {
					await cliente.query("select pg_advisory_unlock(hashtext($1))", [
						opportunityId,
					]);
				}
			} finally {
				if (conectado) await cliente.end();
			}
		}
	} finally {
		const siguiente = esperaCandado.shift();
		if (siguiente) siguiente();
		else consultasConCandado--;
	}
}

async function validarContextoConsultaProtegida({
	opportunityId,
	dpi,
	coDebtorId,
	lector,
	fuente,
}: {
	opportunityId: string;
	dpi: string;
	coDebtorId: string | null;
	lector: NodePgDatabase;
	fuente: "Buró" | "RENAP";
}): Promise<void> {
	const [actual] = await lector
		.select({
			porcentaje: salesStages.closurePercentage,
			status: opportunities.status,
			buroRevalidacionAl30: opportunities.buroRevalidacionAl30,
			clientType: leads.clientType,
			leadDpi: leads.dpi,
			creditType: opportunities.creditType,
		})
		.from(opportunities)
		.innerJoin(salesStages, eq(opportunities.stageId, salesStages.id))
		.leftJoin(leads, eq(opportunities.leadId, leads.id))
		.where(eq(opportunities.id, opportunityId))
		.limit(1);
	if (
		!actual ||
		actual.status !== "open" ||
		!(
			actual.porcentaje === 20 ||
			(actual.porcentaje === 30 && actual.buroRevalidacionAl30)
		)
	) {
		throw new ORPCError("CONFLICT", {
			message: `La oportunidad cambió de etapa antes de consultar ${fuente}. Recarga la página para ver su estado actual.`,
		});
	}
	const [cofirmanteActual] = coDebtorId
		? await lector
				.select({ dpi: coDebtors.dpi })
				.from(coDebtors)
				.where(
					and(
						eq(coDebtors.id, coDebtorId),
						eq(coDebtors.opportunityId, opportunityId),
					),
				)
				.limit(1)
		: [];
	const dpiActual = coDebtorId ? cofirmanteActual?.dpi : actual.leadDpi;
	if (!dpiActual || normalizarDpi(dpiActual) !== dpi) {
		throw new ORPCError("CONFLICT", {
			message: `El DPI del firmante cambió antes de consultar ${fuente}. Recarga la oportunidad.`,
		});
	}
	if (
		await faltaConsentimientoDelTitular(
			opportunityId,
			actual.clientType,
			actual.creditType,
			lector,
		)
	) {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"Carga la cláusula de consentimiento antes de consultar Infornet.",
		});
	}
}

/**
 * Consulta Infornet para el DPI de un sujeto (titular o cofirmante), decide el
 * veredicto y lo registra en su bitácora. El fallo se clasifica ANTES de
 * reintentar, porque reconsultar no hace aparecer a quien Infornet no tiene.
 */
async function consultarBuro(
	{
		opportunityId,
		dpi,
		coDebtorId,
		userId,
	}: {
		opportunityId: string;
		dpi: string;
		coDebtorId: string | null;
		userId?: string | null;
	},
	escritorExistente?: NodePgDatabase,
): Promise<ReusoBuro> {
	const ejecutar = async (escritor: NodePgDatabase): Promise<ReusoBuro> => {
		await validarContextoConsultaProtegida({
			opportunityId,
			dpi,
			coDebtorId,
			lector: escritor,
			fuente: "Buró",
		});
		// Los cofirmantes no pasan por RENAP: no se les puede exigir `renapinfo`
		const opcionesInfornet = { exigirRenap: coDebtorId === null };

		const consultaBuro = await enFilaPorDpi(dpi, async () => {
			let resultado = await infornetController.obtenerEstudioPorDPI(
				dpi,
				opcionesInfornet,
			);
			let sinRegistro = false;
			let expiraSinRegistro: Date | null = null;

			if (!resultado.success) {
				// El intento contra Infornet siempre se hace; solo se reusa su clasificación
				if (resultado.error === ERROR_INFORNET_AMBIGUO) {
					expiraSinRegistro = await sinRegistroVigentePorDpi(dpi);
					sinRegistro =
						expiraSinRegistro !== null ||
						(await clasificarFalloInfornet(dpi)) === "sin_registro";
				}

				for (
					let intento = 0;
					intento < REINTENTOS_AUTOMATICOS &&
					!resultado.success &&
					!sinRegistro;
					intento++
				) {
					await esperar(ESPERA_ENTRE_REINTENTOS_MS);
					resultado = await infornetController.obtenerEstudioPorDPI(
						dpi,
						opcionesInfornet,
					);
				}
			}

			return { resultado, sinRegistro, expiraSinRegistro };
		});

		const estudio = consultaBuro.resultado;
		const buroSinRegistro = consultaBuro.sinRegistro;

		if (!estudio.success) {
			const mensajeCrudo =
				estudio.error || "Error al obtener el estudio de Infornet";

			const mensajeBuro = buroSinRegistro
				? MENSAJE_SIN_REGISTRO_BURO
				: mensajeCrudo === ERROR_BURO_SIN_RENAP_LOCAL
					? // Suele aparecer tras overridear RENAP sin sincronizar datos reales; la salida es overridear Buró también
						"La consulta automática a Infornet necesita datos de RENAP ya sincronizados para este DPI, y no existen. Mientras no existan, Buró debe validarse manualmente."
					: mensajeCrudo;
			const estadoBuro = buroSinRegistro ? "sin_registro" : "error";

			await registrarValidacion(
				{
					opportunityId,
					coDebtorId,
					dpi,
					tipo: "buro",
					estado: estadoBuro,
					mensaje: mensajeBuro,
					expiraEn: buroSinRegistro
						? (consultaBuro.expiraSinRegistro ??
							new Date(Date.now() + VIGENCIA_SIN_REGISTRO_MS))
						: null,
					ejecutadoPor: userId ?? null,
				},
				escritor,
			);

			return {
				estado: estadoBuro,
				mensaje: mensajeBuro,
				scoreRiesgo: null,
				nivelRiesgo: null,
				alertas: null,
				fuenteDeDatos: null,
			};
		}

		// `analizarRiesgo` repite la consulta pero pega en el caché recién escrito
		const analisisRiesgo = await infornetController
			.analizarRiesgo(dpi, opcionesInfornet)
			.catch((error) => {
				console.error("Error al analizar el estudio de Buró:", error);
				return null;
			});
		const veredicto = evaluarBuro(analisisRiesgo);

		if (veredicto.sinVeredicto) {
			await registrarValidacion(
				{
					opportunityId,
					coDebtorId,
					dpi,
					tipo: "buro",
					estado: "error",
					mensaje: veredicto.mensajeBuro,
					ejecutadoPor: userId ?? null,
				},
				escritor,
			);

			return {
				estado: "error",
				mensaje: veredicto.mensajeBuro,
				scoreRiesgo: null,
				nivelRiesgo: null,
				alertas: null,
				fuenteDeDatos: null,
			};
		}

		// `guardarEnCache` se traga los errores de base: sin fila vigente el estudio no quedó persistido
		const [cacheRow] = await db
			.select({ expiraEn: infornetPersonaCache.expiraEn })
			.from(infornetPersonaCache)
			.where(
				and(
					eq(infornetPersonaCache.dpi, dpi),
					gt(infornetPersonaCache.expiraEn, new Date()),
				),
			)
			.limit(1);

		if (!cacheRow) {
			console.warn(
				`⚠️ El estudio de ${dpi} no quedó en caché; el veredicto se guarda con vigencia propia`,
			);
		}

		// La consulta sí fue exitosa: el veredicto vale aunque el caché no lo respalde
		const expiraEnBuro =
			cacheRow?.expiraEn ?? new Date(Date.now() + VIGENCIA_SIN_REGISTRO_MS);

		const fuenteDeDatos = estudio.fromCache ? "cache" : "api";
		const estadoBuro = veredicto.pasoBuro ? "aprobado" : "rechazado";

		await registrarValidacion(
			{
				opportunityId,
				coDebtorId,
				dpi,
				tipo: "buro",
				estado: estadoBuro,
				mensaje: veredicto.mensajeBuro,
				scoreRiesgo: analisisRiesgo?.scoreRiesgo ?? null,
				nivelRiesgo: analisisRiesgo?.nivelRiesgo ?? null,
				alertas: analisisRiesgo?.alertas ?? null,
				fuenteDeDatos,
				expiraEn: expiraEnBuro,
				ejecutadoPor: userId ?? null,
			},
			escritor,
		);

		return {
			estado: estadoBuro,
			mensaje: veredicto.mensajeBuro,
			scoreRiesgo: analisisRiesgo?.scoreRiesgo ?? null,
			nivelRiesgo: analisisRiesgo?.nivelRiesgo ?? null,
			alertas: analisisRiesgo?.alertas ?? null,
			fuenteDeDatos,
		};
	};
	return escritorExistente
		? ejecutar(escritorExistente)
		: conCandadoDuranteConsulta(opportunityId, ejecutar);
}

type CofirmanteDeOportunidad = { id: string; fullName: string; dpi: string };

async function cofirmantesDeOportunidad(
	opportunityId: string,
	lector: Lector = db,
): Promise<CofirmanteDeOportunidad[]> {
	return lector
		.select({
			id: coDebtors.id,
			fullName: coDebtors.fullName,
			dpi: coDebtors.dpi,
		})
		.from(coDebtors)
		.where(eq(coDebtors.opportunityId, opportunityId))
		.orderBy(coDebtors.createdAt);
}

/** Consulta el Buró de cada cofirmante; la exención del bot solo cubre al titular. */
export async function ejecutarBuroCofirmantes({
	opportunityId,
	userId,
	reusarVigente,
}: {
	opportunityId: string;
	userId?: string | null;
	reusarVigente?: boolean;
}): Promise<ResultadoEjecucionCofirmantes> {
	const oportunidad = await cargarOportunidadConLead(opportunityId);

	if (!oportunidad) {
		return {
			exento: false,
			errorTecnico: true,
			mensaje: "Oportunidad no encontrada",
			cofirmantes: [],
		};
	}

	const resultados: ResultadoBuroCofirmante[] = [];

	for (const cofirmante of await cofirmantesDeOportunidad(opportunityId)) {
		const resultado = await ejecutarBuroDeCofirmante({
			opportunityId,
			coDebtorId: cofirmante.id,
			userId,
			reusarVigente,
		});
		if (resultado) resultados.push(resultado);
	}

	const fallido = resultados.find((r) => r.buro.estado === "error");

	return {
		exento: false,
		errorTecnico: Boolean(fallido),
		mensaje: fallido
			? `Buró del cofirmante ${fallido.nombre}: ${fallido.buro.mensaje}`
			: undefined,
		cofirmantes: resultados,
	};
}

/**
 * Consulta al 20%, o al 30% si una revalidación excepcional quedó registrada.
 * Lee la etapa e identidad actuales antes de consultar.
 * El resultado queda en la misma
 * bitácora que usa el análisis del 30%.
 */
export async function ejecutarBuroAlVeinteSiCorresponde({
	opportunityId,
	userId,
}: {
	opportunityId: string;
	userId?: string | null;
}): Promise<void> {
	const [oportunidad] = await db
		.select({
			porcentaje: salesStages.closurePercentage,
			status: opportunities.status,
			buroRevalidacionAl30: opportunities.buroRevalidacionAl30,
			source: opportunities.source,
			leadSource: leads.source,
			leadId: opportunities.leadId,
			leadDpi: leads.dpi,
			clientType: leads.clientType,
			creditType: opportunities.creditType,
		})
		.from(opportunities)
		.innerJoin(salesStages, eq(opportunities.stageId, salesStages.id))
		.leftJoin(leads, eq(opportunities.leadId, leads.id))
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	if (
		!oportunidad ||
		!(
			oportunidad.porcentaje === 20 ||
			(oportunidad.porcentaje === 30 && oportunidad.buroRevalidacionAl30)
		) ||
		oportunidad.status !== "open" ||
		(await faltaConsentimientoDelTitular(
			opportunityId,
			oportunidad.clientType,
			oportunidad.creditType,
		))
	) {
		return;
	}

	const titularExento = (
		await resolverExencionPorBot({
			opportunityId,
			source: oportunidad.source,
			leadSource: oportunidad.leadSource,
			leadId: oportunidad.leadId,
			leadDpi: oportunidad.leadDpi,
		})
	).exento;
	const [titular, cofirmantes] = await Promise.all([
		oportunidad.leadDpi && !titularExento
			? ejecutarValidaciones({ opportunityId, userId, reusarVigente: true })
			: null,
		ejecutarBuroCofirmantes({ opportunityId, userId, reusarVigente: true }),
	]);
	if (titular?.errorTecnico || cofirmantes.errorTecnico) {
		console.warn(
			`[Buró 20%] La validación de la oportunidad ${opportunityId} quedó pendiente: ${titular?.mensaje ?? cofirmantes.mensaje ?? "error técnico"}`,
		);
	}
}

/** Cofirmantes con el DPI con que se validaron, como `id:dpi` en orden de id: lo que compara `firmaCofirmantesSql` */
export function firmaCofirmantes(
	cofirmantes: { coDebtorId: string; dpi: string }[],
): string {
	return cofirmantes
		.map((c) => `${c.coDebtorId}:${c.dpi}`)
		.sort()
		.join(",");
}

/**
 * La misma firma sobre los cofirmantes ACTUALES de la oportunidad, para el
 * WHERE del UPDATE que aprueba el análisis: así un cofirmante agregado o con
 * DPI corregido después de validar no puede quedar aprobado sin buró. El DPI se
 * limpia de espacios igual que `normalizarDpi`.
 */
export function firmaCofirmantesSql(opportunityIdExpr: SQL): SQL {
	return sql`(SELECT coalesce(string_agg(
			cd.id::text || ':' || regexp_replace(cd.dpi, '\\s', '', 'g'),
			',' ORDER BY cd.id), '')
		FROM public.co_debtors cd
		WHERE cd.opportunity_id = ${opportunityIdExpr})`;
}

/** Mismo patrón que `ejecutarValidaciones`: el DPI se relee en cada vuelta para que la llave refleje el actual */
async function ejecutarBuroDeCofirmante({
	opportunityId,
	coDebtorId,
	userId,
	reusarVigente,
}: {
	opportunityId: string;
	coDebtorId: string;
	userId?: string | null;
	reusarVigente?: boolean;
}): Promise<ResultadoBuroCofirmante | null> {
	for (;;) {
		const [cofirmante] = await db
			.select({
				id: coDebtors.id,
				fullName: coDebtors.fullName,
				dpi: coDebtors.dpi,
			})
			.from(coDebtors)
			.where(
				and(
					eq(coDebtors.id, coDebtorId),
					eq(coDebtors.opportunityId, opportunityId),
				),
			)
			.limit(1);

		// Lo borraron mientras se validaban los anteriores
		if (!cofirmante) return null;

		const clave = claveDeValidacion(
			opportunityId,
			normalizarDpi(cofirmante.dpi),
			coDebtorId,
		);

		const overrideEnCurso = overridesEnCurso.get(clave);
		if (overrideEnCurso) {
			await overrideEnCurso.catch(() => undefined);
			continue;
		}

		return conMutexDeOportunidad(clave, () =>
			ejecutarBuroDeCofirmanteInterno({
				opportunityId,
				cofirmante,
				userId,
				reusarVigente,
			}),
		);
	}
}

async function ejecutarBuroDeCofirmanteInterno({
	opportunityId,
	cofirmante,
	userId,
	reusarVigente,
}: {
	opportunityId: string;
	cofirmante: CofirmanteDeOportunidad;
	userId?: string | null;
	reusarVigente?: boolean;
}): Promise<ResultadoBuroCofirmante> {
	const base = { coDebtorId: cofirmante.id, nombre: cofirmante.fullName };
	const dpiValidado = validarDpi(cofirmante.dpi);

	// En el titular un DPI inválido cae en RENAP; el cofirmante solo pasa por Buró
	if (!dpiValidado.valid) {
		const dpi = normalizarDpi(cofirmante.dpi);

		await registrarValidacion({
			opportunityId,
			coDebtorId: cofirmante.id,
			dpi,
			tipo: "buro",
			estado: "error",
			mensaje: dpiValidado.error,
			ejecutadoPor: userId ?? null,
		});

		return {
			...base,
			dpi,
			buro: {
				estado: "error",
				mensaje: dpiValidado.error,
				scoreRiesgo: null,
				nivelRiesgo: null,
				alertas: null,
				fuenteDeDatos: null,
			},
		};
	}

	const dpi = dpiValidado.dpiLimpio;
	const vigente = reusarVigente
		? (await cargarVigenciasPorFuente(opportunityId, dpi, cofirmante.id)).buro
		: null;

	const buro =
		vigente ??
		(await consultarBuro({
			opportunityId,
			dpi,
			coDebtorId: cofirmante.id,
			userId,
		}));

	return { ...base, dpi, buro };
}

/** Lee `renapinfo`, no consulta la API */
async function obtenerDetalleRenap(
	dpi: string,
	lector: Lector = db,
): Promise<DetalleRenap | null> {
	const [fila] = await lector
		.select()
		.from(renapInfo)
		.where(eqDpi(renapInfo.dpi, dpi))
		.limit(1);

	if (!fila) return null;

	const nombreCompleto = [
		fila.firstName,
		fila.secondName,
		fila.thirdName,
		fila.firstLastName,
		fila.secondLastName,
	]
		.filter(Boolean)
		.join(" ");

	return {
		nombreCompleto,
		fechaNacimiento: fila.birthDate,
		genero: fila.gender,
		estadoCivil: fila.civilStatus,
		nacionalidad: fila.nationality,
		ocupacion: fila.ocupation,
		vigenciaDpi: fila.dpiExpiracyDate,
		fechaDefuncion: fila.deathDate,
	};
}

/** Lee el caché de Infornet, no consulta la API. Solo devuelve el estudio que produjo el veredicto guardado */
async function obtenerDetalleBuro(
	dpi: string,
	expiraEnAuditado: Date | null,
	lector: Lector = db,
): Promise<DetalleBuro | null> {
	const [fila] = await lector
		.select()
		.from(infornetPersonaCache)
		.where(eq(infornetPersonaCache.dpi, dpi))
		.limit(1);

	if (!fila) return null;

	// Otra oportunidad pudo refrescar el estudio despues de este veredicto
	if (
		!expiraEnAuditado ||
		fila.expiraEn.getTime() !== new Date(expiraEnAuditado).getTime()
	) {
		return null;
	}

	return {
		codigoPersona: fila.codigoPersona,
		nombreCompleto: `${fila.nombres} ${fila.apellidos}`.trim(),
		tieneReferenciasComerciales: fila.tieneReferenciasComerciales ?? false,
		tieneReferenciasJudiciales: fila.tieneReferenciasJudiciales ?? false,
		esPEP: fila.esPEP ?? false,
		cantidadInmuebles: fila.cantidadInmuebles,
		cantidadVehiculos: fila.cantidadVehiculos,
		cantidadEmpresas: fila.cantidadEmpresas,
		consultadoEn: fila.consultadoEn,
		expiraEn: fila.expiraEn,
	};
}

export type ResultadoOverride = {
	validacion: ValidacionOportunidad;
	overrideId: string;
};

/**
 * Override manual: inserta una fila nueva (append-only) en vez de pisar la
 * de error. Buró usa `sin_registro` + 30 días de vigencia (igual a un
 * veredicto real); RENAP usa `aprobado` sin vigencia (igual a sus filas reales).
 */
async function marcarValidacionManual({
	opportunityId,
	coDebtorId,
	tipo,
	userId,
	motivo,
}: {
	opportunityId: string;
	/** null = titular */
	coDebtorId: string | null;
	tipo: "buro" | "renap";
	userId: string;
	motivo: string;
}): Promise<ResultadoOverride> {
	// Coordinación en memoria, solo una OPTIMIZACIÓN (la garantía real es el
	// candado de Postgres en `marcarValidacionManualCritico`): evita esperar
	// con una transacción abierta mientras una validación real sigue en
	// vuelo. Reintenta si el DPI cambió mientras esperaba su turno.
	for (;;) {
		const dpiCrudo = await dpiCrudoDelSujeto(opportunityId, coDebtorId);
		if (!dpiCrudo) throw new OverrideNoAplicaError(tipo);
		const dpi = normalizarDpi(dpiCrudo);
		const clave = claveDeValidacion(opportunityId, dpi, coDebtorId);

		// Encadena sin ningún `await` entre leer y publicar en el mapa (mismo
		// patrón que `enFilaPorDpi`): si no, dos overrides que despiertan juntos
		// podrían no verse entre sí.
		const anterior =
			overridesEnCurso.get(clave) ??
			validacionesEnCurso.get(clave) ??
			Promise.resolve();
		const trabajo: Promise<
			ResultadoOverride | typeof DPI_CAMBIO_DURANTE_ESPERA
		> = anterior
			.catch(() => undefined)
			.then(async () => {
				// Ya nos tocó el turno: si el DPI cambió mientras esperábamos,
				// no ejecuta nada — el loop de afuera reintenta con el DPI actual
				const fresco = await dpiCrudoDelSujeto(opportunityId, coDebtorId);
				const dpiFresco = fresco ? normalizarDpi(fresco) : null;
				if (dpiFresco !== dpi) return DPI_CAMBIO_DURANTE_ESPERA;

				return marcarValidacionManualCritico({
					opportunityId,
					coDebtorId,
					tipo,
					userId,
					motivo,
				});
			});
		overridesEnCurso.set(clave, trabajo);

		// `.finally()` devuelve una promesa nueva; sin `.catch()` propio queda como rejection no manejada aparte
		trabajo
			.finally(() => {
				if (overridesEnCurso.get(clave) === trabajo)
					overridesEnCurso.delete(clave);
			})
			.catch(() => {});

		const resultado = await trabajo;
		if (resultado !== DPI_CAMBIO_DURANTE_ESPERA) return resultado;
	}
}

/** DPI sin normalizar del sujeto: el del lead (titular) o el del co-deudor de ESTA oportunidad */
async function dpiCrudoDelSujeto(
	opportunityId: string,
	coDebtorId: string | null,
): Promise<string | null> {
	if (!coDebtorId) {
		const oportunidad = await cargarOportunidadConLead(opportunityId);
		if (!oportunidad) throw new OportunidadNoEncontradaError();
		return oportunidad.leadDpi;
	}

	const [cofirmante] = await db
		.select({ dpi: coDebtors.dpi })
		.from(coDebtors)
		.where(
			and(
				eq(coDebtors.id, coDebtorId),
				eq(coDebtors.opportunityId, opportunityId),
			),
		)
		.limit(1);

	if (!cofirmante) throw new CofirmanteNoEncontradoError();
	return cofirmante.dpi;
}

async function marcarValidacionManualCritico({
	opportunityId,
	coDebtorId,
	tipo,
	userId,
	motivo,
}: {
	opportunityId: string;
	coDebtorId: string | null;
	tipo: "buro" | "renap";
	userId: string;
	motivo: string;
}): Promise<ResultadoOverride> {
	// Se relee acá (después de esperar el turno) para usar el DPI actual, no el leído antes de esperar
	const dpiCrudo = await dpiCrudoDelSujeto(opportunityId, coDebtorId);
	if (!dpiCrudo) throw new OverrideNoAplicaError(tipo);

	// Un DPI inválido se corrige en la ficha: un override no satisface el
	// requisito de identidad al entrar al 30%, sea titular o cofirmante.
	if (!validarDpi(dpiCrudo).valid) {
		throw new OverrideDpiInvalidoError(coDebtorId ? "cofirmante" : "titular");
	}

	const dpi = normalizarDpi(dpiCrudo);

	const valoresPorTipo =
		tipo === "buro"
			? {
					estado: "sin_registro" as const,
					expiraEn: new Date(Date.now() + VIGENCIA_OVERRIDE_BURO_MS),
				}
			: { estado: "aprobado" as const, expiraEn: null };

	return auditedTransaction(async (tx) => {
		// Mismo candado que `registrarValidacion`, tomado ANTES de leer
		// `ultima`: el chequeo "¿sigue en error?" y el insert quedan
		// protegidos como una sola operación (necesario bajo READ COMMITTED)
		await tomarCandadoBuroSiLibre(tx, opportunityId);

		// Chequeo defensivo server-side: la UI puede mostrar el botón
		// desactualizado (otra pestaña, un reintento que sí resolvió)
		const [ultima] = await tx
			.select()
			.from(opportunityValidations)
			.where(
				and(
					eq(opportunityValidations.opportunityId, opportunityId),
					eq(opportunityValidations.tipo, tipo),
					eq(opportunityValidations.dpi, dpi),
					delSujeto(coDebtorId),
				),
			)
			.orderBy(desc(opportunityValidations.ejecutadoAt))
			.limit(1);

		if (!ultima || ultima.estado !== "error") {
			throw new OverrideNoAplicaError(tipo);
		}

		const [validacion] = await tx
			.insert(opportunityValidations)
			.values({
				opportunityId,
				sujeto: coDebtorId ? "cofirmante" : "titular",
				coDebtorId,
				dpi,
				tipo,
				mensaje: motivo,
				fuenteDeDatos: "manual",
				ejecutadoPor: userId,
				...valoresPorTipo,
			})
			.returning();

		const [override] = await tx
			.insert(opportunityValidationOverrideLogs)
			.values({
				opportunityId,
				validationId: validacion.id,
				overriddenValidationId: ultima.id,
				tipo,
				reason: motivo,
				markedBy: userId,
			})
			.returning();

		auditRecord({
			entity: "opportunity",
			id: opportunityId,
			action: `override_${tipo}_validation`,
			data: {
				motivo,
				validationId: validacion.id,
				overrideId: override.id,
				...(coDebtorId ? { coDebtorId } : {}),
			},
		});

		return { validacion, overrideId: override.id };
	});
}

export async function marcarValidacionBuroManual(params: {
	opportunityId: string;
	/** Ausente = titular */
	coDebtorId?: string | null;
	userId: string;
	motivo: string;
}): Promise<ResultadoOverride> {
	return marcarValidacionManual({
		...params,
		coDebtorId: params.coDebtorId ?? null,
		tipo: "buro",
	});
}

/** RENAP solo aplica al titular: los cofirmantes no pasan por RENAP */
export async function marcarValidacionRenapManual(params: {
	opportunityId: string;
	userId: string;
	motivo: string;
}): Promise<ResultadoOverride> {
	return marcarValidacionManual({ ...params, coDebtorId: null, tipo: "renap" });
}

/** Última fila de ese tipo para el DPI actual; si no hay, la más reciente de cualquier DPI */
function filaMasRecientePorDpi(
	validaciones: ValidacionOportunidad[],
	tipo: "renap" | "buro",
	dpiActual: string | null,
): ValidacionOportunidad | null {
	const delDpiActual =
		dpiActual &&
		validaciones.find((v) => v.tipo === tipo && v.dpi === dpiActual);
	return delDpiActual || validaciones.find((v) => v.tipo === tipo) || null;
}

/** Detalle de un override manual, con el nombre de quien lo marcó */
async function obtenerOverride(
	validationId: string,
	lector: Lector = db,
): Promise<OverrideInfo | null> {
	const [fila] = await lector
		.select({
			motivo: opportunityValidationOverrideLogs.reason,
			marcadoAt: opportunityValidationOverrideLogs.createdAt,
			marcadoPorNombre: user.name,
		})
		.from(opportunityValidationOverrideLogs)
		.leftJoin(user, eq(opportunityValidationOverrideLogs.markedBy, user.id))
		.where(eq(opportunityValidationOverrideLogs.validationId, validationId))
		.limit(1);

	return fila
		? {
				motivo: fila.motivo,
				marcadoPorNombre: fila.marcadoPorNombre,
				marcadoAt: fila.marcadoAt,
			}
		: null;
}

/** Buró de cada cofirmante, leído de la bitácora y del caché; no consulta la API */
async function estadoBuroCofirmantes(
	opportunityId: string,
	lector: Lector = db,
): Promise<EstadoBuroCofirmante[]> {
	const cofirmantes = await cofirmantesDeOportunidad(opportunityId, lector);
	if (cofirmantes.length === 0) return [];

	const filas = await lector
		.select()
		.from(opportunityValidations)
		.where(
			and(
				eq(opportunityValidations.opportunityId, opportunityId),
				eq(opportunityValidations.sujeto, "cofirmante"),
				eq(opportunityValidations.tipo, "buro"),
			),
		)
		.orderBy(desc(opportunityValidations.ejecutadoAt));

	return Promise.all(
		cofirmantes.map(async (cofirmante) => {
			const dpi = normalizarDpi(cofirmante.dpi);
			// Mismo criterio que el titular: primero la fila de su DPI actual
			const buro = filaMasRecientePorDpi(
				filas.filter((f) => f.coDebtorId === cofirmante.id),
				"buro",
				dpi,
			);

			const [detalleBuro, overrideBuro] = await Promise.all([
				buro
					? obtenerDetalleBuro(buro.dpi, buro.expiraEn ?? null, lector)
					: null,
				buro?.fuenteDeDatos === "manual"
					? obtenerOverride(buro.id, lector)
					: null,
			]);

			return {
				coDebtorId: cofirmante.id,
				nombre: cofirmante.fullName,
				dpi,
				buro,
				buroVigente: buro?.expiraEn
					? new Date(buro.expiraEn) > new Date()
					: false,
				buroDesactualizado: Boolean(buro && buro.dpi !== dpi),
				detalleBuro,
				overrideBuro,
			};
		}),
	);
}

/** Estado de las validaciones: exención, DPI y últimos resultados de la bitácora */
export async function getValidaciones({
	opportunityId,
	lector = db,
}: {
	opportunityId: string;
	lector?: Lector;
}): Promise<EstadoValidacionesOportunidad> {
	const oportunidad = await cargarOportunidadConLead(opportunityId, lector);

	if (!oportunidad) {
		throw new OportunidadNoEncontradaError();
	}

	const exencion = await resolverExencionPorBot(
		{
			opportunityId,
			...oportunidad,
		},
		lector,
	);

	if (exencion.exento) {
		const cofirmantes = await estadoBuroCofirmantes(opportunityId, lector);
		return {
			exento: true,
			faltaDpi: false,
			dpi: null,
			renap: null,
			buro: null,
			buroVigente: false,
			aprobacionBloqueada: cofirmantes.some(
				(c) => c.buro?.estado === "error" && !c.buroDesactualizado,
			),
			origenBotSinEvidencia: false,
			faltaConsentimiento:
				cofirmantes.length > 0 &&
				(await faltaConsentimientoDelTitular(
					opportunityId,
					oportunidad.clientType,
					oportunidad.creditType,
					lector,
				)),
			enAnalisisPendiente: false,
			dpiDesactualizado: false,
			buroDesactualizado: false,
			renapDesactualizado: false,
			detalleRenap: null,
			detalleBuro: null,
			overrideBuro: null,
			overrideRenap: null,
			validaciones: [],
			cofirmantes,
		};
	}

	const validaciones = await lector
		.select()
		.from(opportunityValidations)
		.where(
			and(
				eq(opportunityValidations.opportunityId, opportunityId),
				delSujeto(null),
			),
		)
		.orderBy(desc(opportunityValidations.ejecutadoAt));

	const dpiActual = oportunidad.leadDpi
		? normalizarDpi(oportunidad.leadDpi)
		: null;

	// Prioriza la fila del DPI actual (mismo criterio que el gate real en
	// `cargarVigenciasPorFuente`); si no hay ninguna, cae a la más reciente
	// de cualquier DPI, solo como contexto (el aviso de desactualizado la
	// distingue). Sin priorizar el DPI actual, un DPI que cambió y volvió a
	// su valor anterior podía tapar un error vigente y bloqueante del DPI
	// actual con una fila más reciente de una identidad distinta.
	const renap = filaMasRecientePorDpi(validaciones, "renap", dpiActual);
	const buro = filaMasRecientePorDpi(validaciones, "buro", dpiActual);
	const buroVigente = buro?.expiraEn
		? new Date(buro.expiraEn) > new Date()
		: false;

	// Se calcula por fuente, no con un DPI único mezclado entre las dos: cada
	// una puede haber quedado con un DPI distinto (ej. Buró ya overrideado,
	// RENAP no). `dpiActual` en null (lead sin DPI) también cuenta como
	// desactualizado: la fila mostrada sigue siendo de una identidad que ya
	// no es la del lead.
	const buroDesactualizado = Boolean(buro && buro.dpi !== dpiActual);
	const renapDesactualizado = Boolean(renap && renap.dpi !== dpiActual);
	const dpiDesactualizado = buroDesactualizado || renapDesactualizado;

	// Cada fuente bloquea por su cuenta (mismo criterio que
	// `cargarVigenciasPorFuente`, que sí filtra por DPI actual): un error de
	// una fila desactualizada no cuenta, para no contradecir al gate real
	const cofirmantes = await estadoBuroCofirmantes(opportunityId, lector);

	const aprobacionBloqueada =
		(buro?.estado === "error" && !buroDesactualizado) ||
		(CONSULTAR_RENAP && renap?.estado === "error" && !renapDesactualizado) ||
		cofirmantes.some(
			(c) => c.buro?.estado === "error" && !c.buroDesactualizado,
		);

	const [detalleRenap, detalleBuro] = await Promise.all([
		renap?.dpi ? obtenerDetalleRenap(renap.dpi, lector) : null,
		buro?.dpi
			? obtenerDetalleBuro(buro.dpi, buro?.expiraEn ?? null, lector)
			: null,
	]);

	const [overrideBuro, overrideRenap] = await Promise.all([
		buro?.fuenteDeDatos === "manual" ? obtenerOverride(buro.id, lector) : null,
		renap?.fuenteDeDatos === "manual"
			? obtenerOverride(renap.id, lector)
			: null,
	]);

	return {
		exento: false,
		faltaDpi: !oportunidad.leadDpi,
		dpi: dpiActual,
		renap,
		buro,
		buroVigente,
		aprobacionBloqueada: aprobacionBloqueada ?? false,
		origenBotSinEvidencia: exencion.origenBotSinEvidencia,
		faltaConsentimiento: await faltaConsentimientoDelTitular(
			opportunityId,
			oportunidad.clientType,
			oportunidad.creditType,
			lector,
		),
		enAnalisisPendiente: ESTADOS_EN_ANALISIS.includes(
			oportunidad.analysisStatus,
		),
		dpiDesactualizado,
		buroDesactualizado,
		renapDesactualizado,
		detalleRenap,
		detalleBuro,
		overrideBuro,
		overrideRenap,
		validaciones,
		cofirmantes,
	};
}
