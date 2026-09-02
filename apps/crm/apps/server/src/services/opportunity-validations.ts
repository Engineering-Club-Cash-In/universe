import { createClientFromEnv, isNotFoundError } from "@repo/infornet";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getOnlyRenapInfoController } from "../controllers/bot";
import { infornetController } from "../controllers/buro";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { infornetPersonaCache } from "../db/schema/buro";
import { leads, opportunities } from "../db/schema/crm";
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
import { eqDpi } from "../lib/dpi-lookup";
import {
	isOpportunityFromSource,
	type LeadSource,
} from "../lib/lead-opportunity-source";
import { normalizarDpi, validarDpi } from "../utils/cui-validation";

const REINTENTOS_AUTOMATICOS = 1;
const ESPERA_ENTRE_REINTENTOS_MS = 800;

/** El `fetch` de RENAP no lleva `AbortSignal`, así que la cota se aplica acá */
const TIMEOUT_RENAP_MS = 30_000;

const MENSAJE_SIN_REGISTRO_BURO = "Sin registro en el buró de Infornet";

const MENSAJE_TIMEOUT_RENAP = "RENAP no respondió";

/** Un "sin registro" vale lo mismo que un estudio: si Infornet no tiene a la persona hoy, tampoco mañana */
const VIGENCIA_SIN_REGISTRO_MS = 30 * 24 * 60 * 60 * 1000;

/** Mensaje de Infornet que no distingue "sin registro" de un fallo real */
const ERROR_INFORNET_AMBIGUO = "Persona no encontrada en Infornet";

/**
 * Mensaje crudo de `buro.ts` cuando Infornet no llega a consultarse porque no
 * hay una fila local de RENAP para ese DPI (dependencia preexistente entre
 * fuentes, ajena a este servicio — ver `controllers/buro.ts`). Es la
 * consecuencia esperada de overridear RENAP cuando nunca sincronizó de
 * verdad: Buró sigue sin poder consultarse y necesita su propio override,
 * pero el mensaje original suena a un problema de RENAP, no de Buró.
 */
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
	/** El resultado mostrado se ejecutó con un DPI distinto al que tiene hoy el lead */
	dpiDesactualizado: boolean;
	/** DPI con el que se ejecutó la última validación */
	dpiValidado: string | null;
	detalleRenap: DetalleRenap | null;
	detalleBuro: DetalleBuro | null;
	/** Presente solo si `buro.fuenteDeDatos === 'manual'` */
	overrideBuro: OverrideInfo | null;
	/** Presente solo si `renap.fuenteDeDatos === 'manual'` */
	overrideRenap: OverrideInfo | null;
	validaciones: ValidacionOportunidad[];
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

async function registrarValidacion(valores: {
	opportunityId: string;
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
}): Promise<void> {
	await db.insert(opportunityValidations).values({
		opportunityId: valores.opportunityId,
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
}

async function cargarOportunidadConLead(opportunityId: string): Promise<{
	source: LeadSource | null;
	leadSource: LeadSource | null;
	leadId: string | null;
	leadDpi: string | null;
	clientType: string | null;
	creditType: string;
	analysisStatus: string;
} | null> {
	const [row] = await db
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

/**
 * El OTP se marca usado en `/info/validate-otp`, el paso inmediatamente
 * anterior a la consulta al buró, y `otpController` solo lo usa el flujo del
 * bot. Prueba que ese flujo llegó al buró, cosa que el magic URL no hace:
 * se crea antes, en el paso de RENAP. Se exige además estudio vigente.
 */
async function elBotValidoAlLead(
	leadId: string | null,
	leadDpi: string | null,
): Promise<boolean> {
	if (!leadId || !leadDpi) return false;

	const [otpCompletado] = await db
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

	const [estudioVigente] = await db
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

/** Una oportunidad ya validada no vuelve a ser exenta: escondería su propio veredicto */
async function yaTieneBitacora(opportunityId: string): Promise<boolean> {
	const [fila] = await db
		.select({ id: opportunityValidations.id })
		.from(opportunityValidations)
		.where(eq(opportunityValidations.opportunityId, opportunityId))
		.limit(1);

	return Boolean(fila);
}

/** Único punto donde se resuelve la exención; lo usan el servicio y el gate */
export async function resolverExencionPorBot(oportunidad: {
	opportunityId: string;
	source: LeadSource | null;
	leadSource: LeadSource | null;
	leadId: string | null;
	leadDpi: string | null;
}): Promise<ResolucionExencion> {
	const declaraOrigenBot = isOpportunityFromSource(
		oportunidad.source,
		"Whatsapp",
		oportunidad.leadSource ?? "other",
	);

	if (!declaraOrigenBot) {
		return { exento: false, origenBotSinEvidencia: false };
	}

	// Si ya se validó, el veredicto es de esta oportunidad y tiene que verse
	if (await yaTieneBitacora(oportunidad.opportunityId)) {
		return { exento: false, origenBotSinEvidencia: false };
	}

	const validadaPorElBot = await elBotValidoAlLead(
		oportunidad.leadId,
		oportunidad.leadDpi,
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
): Promise<boolean> {
	const [exigido] = await db
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

	const [cargado] = await db
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
 * Vigencia de RENAP y Buró para ese DPI, evaluada de forma **independiente**
 * por fuente: que una esté vigente no depende de la otra ni de cuál corrió
 * más reciente. Antes se comparaban cronológicamente (`renapEsPosterior`),
 * lo que producía dos fallas: (a) overridear solo RENAP sin que exista fila
 * de Buró no dejaba nada vigente porque el chequeo de vigencia estaba anclado
 * a Buró, y (b) overridear solo Buró con timestamp nuevo hacía que un error
 * de RENAP más viejo se descartara por "no ser posterior", aprobando sin
 * resolver RENAP. Cada fuente ahora se lee sola: RENAP vigente = su última
 * fila no es error (no usa `expiraEn`, igual que en el resto del sistema);
 * Buró vigente = su última fila no es error y su `expiraEn` sigue en el futuro.
 */
async function cargarVigenciasPorFuente(
	opportunityId: string,
	dpi: string,
): Promise<{ renap: ReusoRenap | null; buro: ReusoBuro | null }> {
	const filas = await db
		.select()
		.from(opportunityValidations)
		.where(
			and(
				eq(opportunityValidations.opportunityId, opportunityId),
				eq(opportunityValidations.dpi, dpi),
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

const validacionesEnCurso = new Map<
	string,
	Promise<ResultadoEjecucionValidaciones>
>();

/**
 * Reusa la validación en curso de la misma oportunidad en vez de disparar otra.
 * La llave incluye el DPI: si el lead cambia de DPI mientras corre una
 * validación, el resultado en curso pertenece a otra persona y reusarlo
 * podría aprobar una identidad que nunca se validó.
 * Vive en memoria a propósito: un lock en la base retendría una conexión del
 * pool durante las llamadas externas.
 */
function conMutexDeOportunidad(
	clave: string,
	ejecutar: () => Promise<ResultadoEjecucionValidaciones>,
): Promise<ResultadoEjecucionValidaciones> {
	const enCurso = validacionesEnCurso.get(clave);
	if (enCurso) return enCurso;

	const validacion = ejecutar().finally(() => {
		validacionesEnCurso.delete(clave);
	});

	validacionesEnCurso.set(clave, validacion);

	return validacion;
}

/**
 * Overrides manuales en curso, por la misma llave `opportunityId:dpi` que usa
 * `conMutexDeOportunidad`. No es un caché para reusar resultado (cada override
 * tiene su propio motivo y debe correr su propia lógica) — es solo una señal
 * para que una validación real concurrente espere a que termine antes de
 * arrancar, y viceversa. Sin esto, un reintento real podía completarse entre
 * la lectura y el insert del override, dejando la fila manual por encima
 * cronológicamente de un veredicto real ya resuelto.
 */
const overridesEnCurso = new Map<string, Promise<unknown>>();

/** Valida RENAP y Buró para oportunidades no-bot y registra el resultado */
export async function ejecutarValidaciones(parametros: {
	opportunityId: string;
	userId?: string | null;
	/** El gate reusa un veredicto vigente; el botón manual siempre re-consulta */
	reusarVigente?: boolean;
}): Promise<ResultadoEjecucionValidaciones> {
	// El DPI se lee antes del mutex para que la llave lo incluya: reusar una
	// validación en curso solo es seguro si ambas llamadas ven el mismo DPI
	const oportunidad = await cargarOportunidadConLead(parametros.opportunityId);
	const claveDpi = oportunidad?.leadDpi
		? normalizarDpi(oportunidad.leadDpi)
		: "sin-dpi";
	const clave = `${parametros.opportunityId}:${claveDpi}`;

	// Si hay un override manual en curso para esta misma oportunidad+DPI, se
	// espera a que termine antes de leer/escribir el estado real. En loop: un
	// segundo override puede encadenarse detrás del que se está esperando y
	// reemplazar la entrada del mapa mientras se espera — un solo chequeo no
	// lo vería, así que se re-consulta el mapa después de cada espera hasta
	// que no quede ningún override pendiente para esta llave.
	let overrideEnCurso = overridesEnCurso.get(clave);
	while (overrideEnCurso) {
		await overrideEnCurso.catch(() => undefined);
		overrideEnCurso = overridesEnCurso.get(clave);
	}

	return conMutexDeOportunidad(clave, () =>
		ejecutarValidacionesInterno(parametros),
	);
}

async function ejecutarValidacionesInterno({
	opportunityId,
	userId,
	reusarVigente,
}: {
	opportunityId: string;
	userId?: string | null;
	reusarVigente?: boolean;
}): Promise<ResultadoEjecucionValidaciones> {
	const oportunidad = await cargarOportunidadConLead(opportunityId);

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
			tipo: "renap",
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
			renap: { estado: "error", mensaje: dpiValidado.error },
		};
	}

	const dpi = dpiValidado.dpiLimpio;

	let renapVigente: ReusoRenap | null = null;
	let buroVigente: ReusoBuro | null = null;

	if (reusarVigente) {
		({ renap: renapVigente, buro: buroVigente } =
			await cargarVigenciasPorFuente(opportunityId, dpi));
	}

	// 1. RENAP: sincronizar datos de identidad en renap_info (se salta si ya está vigente)
	let renapResumen: ReusoRenap;

	if (renapVigente) {
		renapResumen = renapVigente;
	} else {
		const renapResultado = await conReintento(
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

		renapResumen = renapResultado.success
			? { estado: "aprobado" as const, mensaje: "Datos de RENAP sincronizados" }
			: { estado: "error" as const, mensaje: renapResultado.message || null };

		if (!renapResultado.success) {
			const mensajeRenap =
				renapResultado.message || "Error desconocido al consultar RENAP";

			await registrarValidacion({
				opportunityId,
				dpi,
				tipo: "renap",
				estado: "error",
				mensaje: mensajeRenap,
				ejecutadoPor: userId ?? null,
			});

			// Infornet exige el DPI en renap_info: con sincronización previa se continúa
			const [renapPrevio] = await db
				.select({ dpi: renapInfo.dpi })
				.from(renapInfo)
				.where(eqDpi(renapInfo.dpi, dpi))
				.limit(1);

			if (!renapPrevio) {
				return {
					exento: false,
					faltaDpi: false,
					errorTecnico: true,
					sinRegistroBuro: false,
					mensaje: `RENAP: ${mensajeRenap}`,
					renap: renapResumen,
				};
			}
		} else {
			await registrarValidacion({
				opportunityId,
				dpi,
				tipo: "renap",
				estado: "aprobado",
				mensaje: "Datos de RENAP sincronizados",
				ejecutadoPor: userId ?? null,
			});
		}
	}

	// Si RENAP se reintentó recién (no venía vigente) y falló, sigue siendo un
	// fallo actual aunque `renapPrevio` haya dejado continuar hacia Buró: que
	// Buró esté bien no resuelve a RENAP, cada fuente bloquea por su cuenta
	const renapFalloAhora = renapResumen.estado === "error";

	// 2. Buró: usa el caché de 30 días (se salta si ya está vigente, incluido un
	// override manual). El fallo se clasifica ANTES de reintentar, porque
	// reconsultar no hace aparecer a quien Infornet no tiene
	if (buroVigente) {
		return {
			exento: false,
			faltaDpi: false,
			errorTecnico: renapFalloAhora,
			sinRegistroBuro: buroVigente.estado === "sin_registro",
			mensaje: renapFalloAhora ? `RENAP: ${renapResumen.mensaje}` : undefined,
			renap: renapResumen,
			buro: buroVigente,
		};
	}

	const consultaBuro = await enFilaPorDpi(dpi, async () => {
		let resultado = await infornetController.obtenerEstudioPorDPI(dpi);
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
				intento < REINTENTOS_AUTOMATICOS && !resultado.success && !sinRegistro;
				intento++
			) {
				await esperar(ESPERA_ENTRE_REINTENTOS_MS);
				resultado = await infornetController.obtenerEstudioPorDPI(dpi);
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
				? // Este error suele aparecer justo DESPUÉS de overridear RENAP (que
					// no llega a sincronizar datos reales): volver a overridear RENAP
					// no crea el renap_info que Infornet exige, así que el mensaje no
					// debe sugerir eso — la única salida acá es overridear Buró también.
					"La consulta automática a Infornet necesita datos de RENAP ya sincronizados para este DPI, y no existen. Mientras no existan, Buró debe validarse manualmente."
				: mensajeCrudo;
		const estadoBuro = buroSinRegistro ? "sin_registro" : "error";

		await registrarValidacion({
			opportunityId,
			dpi,
			tipo: "buro",
			estado: estadoBuro,
			mensaje: mensajeBuro,
			expiraEn: buroSinRegistro
				? (consultaBuro.expiraSinRegistro ??
					new Date(Date.now() + VIGENCIA_SIN_REGISTRO_MS))
				: null,
			ejecutadoPor: userId ?? null,
		});

		return {
			exento: false,
			faltaDpi: false,
			// Sin registro no es fallo de la fuente: no bloquea por su cuenta,
			// pero un RENAP recién fallido sigue bloqueando igual
			errorTecnico: !buroSinRegistro || renapFalloAhora,
			sinRegistroBuro: buroSinRegistro,
			mensaje: !buroSinRegistro
				? `Buró: ${mensajeBuro}`
				: renapFalloAhora
					? `RENAP: ${renapResumen.mensaje}`
					: undefined,
			renap: renapResumen,
			buro: {
				estado: estadoBuro,
				mensaje: mensajeBuro,
				scoreRiesgo: null,
				nivelRiesgo: null,
				alertas: null,
				fuenteDeDatos: null,
			},
		};
	}

	// `analizarRiesgo` repite la consulta pero pega en el caché recién escrito
	const analisisRiesgo = await infornetController.analizarRiesgo(dpi);
	const veredicto = evaluarBuro(analisisRiesgo);

	if (veredicto.sinVeredicto) {
		await registrarValidacion({
			opportunityId,
			dpi,
			tipo: "buro",
			estado: "error",
			mensaje: veredicto.mensajeBuro,
			ejecutadoPor: userId ?? null,
		});

		return {
			exento: false,
			faltaDpi: false,
			errorTecnico: true,
			sinRegistroBuro: false,
			mensaje: `Buró: ${veredicto.mensajeBuro}`,
			renap: renapResumen,
			buro: {
				estado: "error",
				mensaje: veredicto.mensajeBuro,
				scoreRiesgo: null,
				nivelRiesgo: null,
				alertas: null,
				fuenteDeDatos: null,
			},
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

	await registrarValidacion({
		opportunityId,
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
	});

	return {
		exento: false,
		faltaDpi: false,
		errorTecnico: renapFalloAhora,
		sinRegistroBuro: false,
		mensaje: renapFalloAhora ? `RENAP: ${renapResumen.mensaje}` : undefined,
		renap: renapResumen,
		buro: {
			estado: estadoBuro,
			mensaje: veredicto.mensajeBuro,
			scoreRiesgo: analisisRiesgo?.scoreRiesgo ?? null,
			nivelRiesgo: analisisRiesgo?.nivelRiesgo ?? null,
			alertas: analisisRiesgo?.alertas ?? null,
			fuenteDeDatos,
		},
	};
}

/** Lee `renapinfo`, no consulta la API */
async function obtenerDetalleRenap(dpi: string): Promise<DetalleRenap | null> {
	const [fila] = await db
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
): Promise<DetalleBuro | null> {
	const [fila] = await db
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
 * Override manual: el analista verificó a mano en el portal de la fuente que
 * falló (Infornet o Centinela/RENAP) que el cliente está en orden. Nunca pisa
 * la fila de error real — inserta una fila NUEVA (append-only, igual que el
 * resto de la bitácora), que `veredictoVigente` recoge exactamente igual que
 * cualquier otro resultado no-error, más una fila de log ligada a ella.
 *
 * Buró usa `estado:'sin_registro'` + `expiraEn` a 30 días (mismo TTL que un
 * veredicto real). RENAP usa `estado:'aprobado'` + sin `expiraEn` — igual que
 * cualquier fila real de RENAP hoy, que tampoco vence.
 */
async function marcarValidacionManual({
	opportunityId,
	tipo,
	userId,
	motivo,
}: {
	opportunityId: string;
	tipo: "buro" | "renap";
	userId: string;
	motivo: string;
}): Promise<ResultadoOverride> {
	const oportunidad = await cargarOportunidadConLead(opportunityId);
	if (!oportunidad) throw new OportunidadNoEncontradaError();
	if (!oportunidad.leadDpi) throw new OverrideNoAplicaError(tipo);

	// Solo para saber qué llave esperar — la crítica relee el DPI, porque
	// puede cambiar mientras se espera abajo. Limitación aceptada: si el DPI
	// cambia justo durante esa espera, la llave sigue anclada al DPI viejo
	// mientras la crítica ya opera sobre el nuevo, así que una validación real
	// que arranque para el DPI nuevo en esa ventana no esperaría a este
	// override. El peor caso es el mismo que ya se documenta para múltiples
	// réplicas: una fila de más en la bitácora, nunca un bypass — el gate
	// siempre relee la fila más reciente por su cuenta.
	const clave = `${opportunityId}:${normalizarDpi(oportunidad.leadDpi)}`;

	// Encadena el propio trabajo al que esté en curso (real u otro override)
	// SIN ningún `await` entre leer y publicar en el mapa: si se lee primero y
	// se espera antes de escribir, dos overrides que ya estaban esperando la
	// misma validación real despiertan juntos y ninguno ve al otro todavía
	// registrado, así que los dos leerían la misma fila de error. Encadenando
	// de forma síncrona (mismo patrón que `enFilaPorDpi`), el segundo SIEMPRE
	// ve la promesa que acaba de publicar el primero.
	const anterior =
		overridesEnCurso.get(clave) ??
		validacionesEnCurso.get(clave) ??
		Promise.resolve();
	const trabajo = anterior
		.catch(() => undefined)
		.then(() =>
			marcarValidacionManualCritico({ opportunityId, tipo, userId, motivo }),
		);
	overridesEnCurso.set(clave, trabajo);

	// `.finally()` devuelve una promesa NUEVA y distinta de `trabajo`: si no se
	// atiende también su propio rechazo queda como una promesa no manejada
	// aparte, aunque quien llama a `marcarValidacionManual` sí capture `trabajo`
	trabajo
		.finally(() => {
			if (overridesEnCurso.get(clave) === trabajo)
				overridesEnCurso.delete(clave);
		})
		.catch(() => {});

	return trabajo;
}

async function marcarValidacionManualCritico({
	opportunityId,
	tipo,
	userId,
	motivo,
}: {
	opportunityId: string;
	tipo: "buro" | "renap";
	userId: string;
	motivo: string;
}): Promise<ResultadoOverride> {
	// Se relee la oportunidad acá, después de haber esperado cualquier trabajo
	// en curso: si el DPI cambió durante esa espera, el chequeo y el insert
	// deben usar el DPI actual, no el que se leyó antes de esperar
	const oportunidad = await cargarOportunidadConLead(opportunityId);
	if (!oportunidad) throw new OportunidadNoEncontradaError();
	if (!oportunidad.leadDpi) throw new OverrideNoAplicaError(tipo);
	const dpi = normalizarDpi(oportunidad.leadDpi);

	// Chequeo defensivo server-side: no confiar en que la UI solo muestre el
	// botón cuando corresponde (otra pestaña, un reintento que sí resolvió, o
	// el DPI del lead cambió después de que el analista abrió el diálogo)
	const [ultima] = await db
		.select()
		.from(opportunityValidations)
		.where(
			and(
				eq(opportunityValidations.opportunityId, opportunityId),
				eq(opportunityValidations.tipo, tipo),
				eq(opportunityValidations.dpi, dpi),
			),
		)
		.orderBy(desc(opportunityValidations.ejecutadoAt))
		.limit(1);

	if (!ultima || ultima.estado !== "error")
		throw new OverrideNoAplicaError(tipo);

	const valoresPorTipo =
		tipo === "buro"
			? {
					estado: "sin_registro" as const,
					expiraEn: new Date(Date.now() + VIGENCIA_OVERRIDE_BURO_MS),
				}
			: { estado: "aprobado" as const, expiraEn: null };

	return auditedTransaction(async (tx) => {
		const [validacion] = await tx
			.insert(opportunityValidations)
			.values({
				opportunityId,
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
			data: { motivo, validationId: validacion.id, overrideId: override.id },
		});

		return { validacion, overrideId: override.id };
	});
}

export async function marcarValidacionBuroManual(params: {
	opportunityId: string;
	userId: string;
	motivo: string;
}): Promise<ResultadoOverride> {
	return marcarValidacionManual({ ...params, tipo: "buro" });
}

export async function marcarValidacionRenapManual(params: {
	opportunityId: string;
	userId: string;
	motivo: string;
}): Promise<ResultadoOverride> {
	return marcarValidacionManual({ ...params, tipo: "renap" });
}

/** Detalle de un override manual, con el nombre de quien lo marcó */
async function obtenerOverride(
	validationId: string,
): Promise<OverrideInfo | null> {
	const [fila] = await db
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

/** Estado de las validaciones: exención, DPI y últimos resultados de la bitácora */
export async function getValidaciones({
	opportunityId,
}: {
	opportunityId: string;
}): Promise<EstadoValidacionesOportunidad> {
	const oportunidad = await cargarOportunidadConLead(opportunityId);

	if (!oportunidad) {
		throw new OportunidadNoEncontradaError();
	}

	const exencion = await resolverExencionPorBot({
		opportunityId,
		...oportunidad,
	});

	if (exencion.exento) {
		return {
			exento: true,
			faltaDpi: false,
			dpi: null,
			renap: null,
			buro: null,
			buroVigente: false,
			aprobacionBloqueada: false,
			origenBotSinEvidencia: false,
			faltaConsentimiento: false,
			enAnalisisPendiente: false,
			dpiDesactualizado: false,
			dpiValidado: null,
			detalleRenap: null,
			detalleBuro: null,
			overrideBuro: null,
			overrideRenap: null,
			validaciones: [],
		};
	}

	const validaciones = await db
		.select()
		.from(opportunityValidations)
		.where(eq(opportunityValidations.opportunityId, opportunityId))
		.orderBy(desc(opportunityValidations.ejecutadoAt));

	const renap = validaciones.find((v) => v.tipo === "renap") ?? null;
	const buro = validaciones.find((v) => v.tipo === "buro") ?? null;
	const buroVigente = buro?.expiraEn
		? new Date(buro.expiraEn) > new Date()
		: false;

	// Cada fuente bloquea por su cuenta: que la otra esté bien no la resuelve.
	// Antes se comparaba cronológicamente (¿cuál corrió más reciente?), lo que
	// dejaba pasar un RENAP en error si Buró se había revalidado después —
	// mismo criterio que ahora usa el gate en `cargarVigenciasPorFuente`
	const aprobacionBloqueada =
		buro?.estado === "error" || renap?.estado === "error";

	const dpiActual = oportunidad.leadDpi
		? normalizarDpi(oportunidad.leadDpi)
		: null;

	// DPI cambiado: el resultado es de otra persona. No bloquea, pero se avisa
	const dpiValidado = buro?.dpi ?? renap?.dpi ?? null;
	const dpiDesactualizado = Boolean(
		dpiValidado && dpiActual && dpiValidado !== dpiActual,
	);

	// El detalle usa el DPI validado, para que coincida con el veredicto mostrado
	const [detalleRenap, detalleBuro] = dpiValidado
		? await Promise.all([
				obtenerDetalleRenap(dpiValidado),
				obtenerDetalleBuro(dpiValidado, buro?.expiraEn ?? null),
			])
		: [null, null];

	const [overrideBuro, overrideRenap] = await Promise.all([
		buro?.fuenteDeDatos === "manual" ? obtenerOverride(buro.id) : null,
		renap?.fuenteDeDatos === "manual" ? obtenerOverride(renap.id) : null,
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
		),
		enAnalisisPendiente: ESTADOS_EN_ANALISIS.includes(
			oportunidad.analysisStatus,
		),
		dpiDesactualizado,
		dpiValidado,
		detalleRenap,
		detalleBuro,
		overrideBuro,
		overrideRenap,
		validaciones,
	};
}
