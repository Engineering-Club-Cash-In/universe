import { createClientFromEnv, isNotFoundError } from "@repo/infornet";
import { and, desc, eq, gt } from "drizzle-orm";
import { getOnlyRenapInfoController } from "../controllers/bot";
import { infornetController } from "../controllers/buro";
import { db } from "../db";
import { infornetPersonaCache } from "../db/schema/buro";
import { leads, magicUrls, opportunities } from "../db/schema/crm";
import {
	documentRequirementsByClientType,
	opportunityDocuments,
} from "../db/schema/documents";
import { renapInfo } from "../db/schema/renap";
import { opportunityValidations } from "../db/schema/validations";
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

/** Mensaje de Infornet que no distingue "sin registro" de un fallo real */
const ERROR_INFORNET_AMBIGUO = "Persona no encontrada en Infornet";

export class OportunidadNoEncontradaError extends Error {
	constructor() {
		super("Oportunidad no encontrada");
		this.name = "OportunidadNoEncontradaError";
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

/** Reintenta una vez ante fallos transitorios de las fuentes externas */
async function conReintento<T>(
	ejecutar: () => Promise<T>,
	esExitoso: (resultado: T) => boolean,
): Promise<T> {
	let resultado = await ejecutar();
	for (
		let intento = 0;
		intento < REINTENTOS_AUTOMATICOS && !esExitoso(resultado);
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
 * El magic URL solo lo escribe el bot (`bot.ts:595,888`), así que su presencia
 * prueba que el lead pasó por ese flujo. Se exige además que el estudio del
 * buró siga vigente: uno vencido ya no sirve como veredicto.
 */
async function elBotValidoAlLead(
	leadId: string | null,
	leadDpi: string | null,
): Promise<boolean> {
	if (!leadId || !leadDpi) return false;

	const [magicUrl] = await db
		.select({ id: magicUrls.id })
		.from(magicUrls)
		.where(eq(magicUrls.leadId, leadId))
		.limit(1);

	if (!magicUrl) return false;

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

/** Único punto donde se resuelve la exención; lo usan el servicio y el gate */
export async function resolverExencionPorBot(oportunidad: {
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

/** Veredicto ya registrado para ese DPI y todavía vigente: evita re-consultar al aprobar */
async function veredictoVigente(
	opportunityId: string,
	dpi: string,
): Promise<ResultadoEjecucionValidaciones | null> {
	const [ultimo] = await db
		.select()
		.from(opportunityValidations)
		.where(
			and(
				eq(opportunityValidations.opportunityId, opportunityId),
				eq(opportunityValidations.tipo, "buro"),
				eq(opportunityValidations.dpi, dpi),
				gt(opportunityValidations.expiraEn, new Date()),
			),
		)
		.orderBy(desc(opportunityValidations.ejecutadoAt))
		.limit(1);

	if (!ultimo) return null;

	return {
		exento: false,
		faltaDpi: false,
		errorTecnico: false,
		sinRegistroBuro: false,
		buro: {
			estado: ultimo.estado,
			mensaje: ultimo.mensaje,
			scoreRiesgo: ultimo.scoreRiesgo,
			nivelRiesgo: ultimo.nivelRiesgo,
			alertas: ultimo.alertas,
			fuenteDeDatos: ultimo.fuenteDeDatos,
		},
	};
}

const validacionesEnCurso = new Map<
	string,
	Promise<ResultadoEjecucionValidaciones>
>();

/**
 * Reusa la validación en curso de la misma oportunidad en vez de disparar otra.
 * Vive en memoria a propósito: un lock en la base retendría una conexión del
 * pool durante las llamadas externas.
 */
function conMutexDeOportunidad(
	opportunityId: string,
	ejecutar: () => Promise<ResultadoEjecucionValidaciones>,
): Promise<ResultadoEjecucionValidaciones> {
	const enCurso = validacionesEnCurso.get(opportunityId);
	if (enCurso) return enCurso;

	const validacion = ejecutar().finally(() => {
		validacionesEnCurso.delete(opportunityId);
	});

	validacionesEnCurso.set(opportunityId, validacion);

	return validacion;
}

/** Valida RENAP y Buró para oportunidades no-bot y registra el resultado */
export async function ejecutarValidaciones(parametros: {
	opportunityId: string;
	userId?: string | null;
	/** El gate reusa un veredicto vigente; el botón manual siempre re-consulta */
	reusarVigente?: boolean;
}): Promise<ResultadoEjecucionValidaciones> {
	return conMutexDeOportunidad(parametros.opportunityId, () =>
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

	const exencion = await resolverExencionPorBot(oportunidad);

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

	if (reusarVigente) {
		const vigente = await veredictoVigente(opportunityId, dpi);
		if (vigente) return vigente;
	}

	// 1. RENAP: sincronizar datos de identidad en renap_info
	// Encolado por DPI: `renapinfo` tiene el DPI como llave primaria y el
	// controller hace select + insert, así que dos validaciones simultáneas del
	// mismo lead pueden chocar con violación de llave
	const renapResultado = await enFilaPorDpi(dpi, () =>
		conReintento(
			() =>
				conTimeout(
					() => getOnlyRenapInfoController(dpi),
					TIMEOUT_RENAP_MS,
					() => ({
						success: false as const,
						message: "RENAP no respondió",
						error: null,
					}),
				),
			(r) => r.success,
		),
	);

	const renapResumen = renapResultado.success
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

	// 2. Buró: usa el caché de 30 días. El fallo se clasifica ANTES de reintentar,
	// porque reconsultar no hace aparecer a quien Infornet no tiene
	const consultaBuro = await enFilaPorDpi(dpi, async () => {
		let resultado = await infornetController.obtenerEstudioPorDPI(dpi);
		let sinRegistro = false;

		if (!resultado.success) {
			sinRegistro =
				resultado.error === ERROR_INFORNET_AMBIGUO &&
				(await clasificarFalloInfornet(dpi)) === "sin_registro";

			for (
				let intento = 0;
				intento < REINTENTOS_AUTOMATICOS && !resultado.success && !sinRegistro;
				intento++
			) {
				await esperar(ESPERA_ENTRE_REINTENTOS_MS);
				resultado = await infornetController.obtenerEstudioPorDPI(dpi);
			}
		}

		return { resultado, sinRegistro };
	});

	const estudio = consultaBuro.resultado;
	const buroSinRegistro = consultaBuro.sinRegistro;

	if (!estudio.success) {
		const mensajeCrudo =
			estudio.error || "Error al obtener el estudio de Infornet";

		const mensajeBuro = buroSinRegistro
			? MENSAJE_SIN_REGISTRO_BURO
			: mensajeCrudo;
		const estadoBuro = buroSinRegistro ? "sin_registro" : "error";

		await registrarValidacion({
			opportunityId,
			dpi,
			tipo: "buro",
			estado: estadoBuro,
			mensaje: mensajeBuro,
			ejecutadoPor: userId ?? null,
		});

		return {
			exento: false,
			faltaDpi: false,
			// Sin registro no es fallo de la fuente: no bloquea
			errorTecnico: !buroSinRegistro,
			sinRegistroBuro: buroSinRegistro,
			mensaje: buroSinRegistro ? undefined : `Buró: ${mensajeBuro}`,
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

	const [cacheRow] = await db
		.select({ expiraEn: infornetPersonaCache.expiraEn })
		.from(infornetPersonaCache)
		.where(eq(infornetPersonaCache.dpi, dpi))
		.limit(1);

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
		expiraEn: cacheRow?.expiraEn ?? null,
		ejecutadoPor: userId ?? null,
	});

	return {
		exento: false,
		faltaDpi: false,
		errorTecnico: false,
		sinRegistroBuro: false,
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

	const exencion = await resolverExencionPorBot(oportunidad);

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

	// RENAP en error solo bloquea si abortó antes del buró
	// Si el RENAP más reciente falló después del último buró, ese veredicto ya no representa el estado actual
	const renapEsPosterior =
		renap && (!buro || renap.ejecutadoAt > buro.ejecutadoAt);
	const aprobacionBloqueada =
		buro?.estado === "error" || (renapEsPosterior && renap?.estado === "error");

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
		validaciones,
	};
}
