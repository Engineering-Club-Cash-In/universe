import { createClientFromEnv, isNotFoundError } from "@repo/infornet";
import { desc, eq } from "drizzle-orm";
import { getOnlyRenapInfoController } from "../controllers/bot";
import { infornetController } from "../controllers/buro";
import { db } from "../db";
import { infornetPersonaCache } from "../db/schema/buro";
import { leads, opportunities } from "../db/schema/crm";
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

/**
 * Cota para la consulta a RENAP: su `fetch` no lleva `AbortSignal` y el
 * controller es compartido con el bot, así que el límite se aplica acá para
 * que la aprobación no quede colgada indefinidamente (req. #5).
 */
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

/**
 * Corta la espera de una fuente externa que no responde. La promesa original
 * sigue corriendo (no se puede abortar desde acá), pero su resultado ya no
 * mantiene al analista esperando.
 */
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

/**
 * Ejecuta una función y reintenta una vez si el resultado no es exitoso
 * (fallos transitorios de las fuentes externas).
 */
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

/**
 * `obtenerEstudioPorDPI` reporta con el mismo mensaje a la persona que no
 * tiene registro en Infornet y a la consulta que reventó: `buscarCodigoPersona`
 * se traga la excepción y devuelve `null` en ambos casos (`buro.ts:150-173`).
 *
 * Sin esa distinción un cliente sin historial crediticio quedaba bloqueado
 * para siempre en el gate 30%→40%. Como `buro.ts` pertenece al flujo del bot y
 * no se toca, la clasificación se hace acá repitiendo la búsqueda contra el
 * mismo paquete `@repo/infornet`, y solo en la ruta de fallo.
 */
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
		// Infornet NO devuelve una lista vacía cuando no tiene a la persona:
		// lanza el código 00002 ("Ninguna entidad encontrada"). Cualquier otro
		// error —conexión, límite de consultas, falta de autorización— sí es
		// técnico y debe bloquear.
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
	leadDpi: string | null;
} | null> {
	const [row] = await db
		.select({
			source: opportunities.source,
			leadSource: leads.source,
			leadDpi: leads.dpi,
		})
		.from(opportunities)
		.leftJoin(leads, eq(opportunities.leadId, leads.id))
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	return row ?? null;
}

function esExentaPorBot(oportunidad: {
	source: LeadSource | null;
	leadSource: LeadSource | null;
}): boolean {
	return isOpportunityFromSource(
		oportunidad.source,
		"Whatsapp",
		oportunidad.leadSource ?? "other",
	);
}

/**
 * Ejecuta las validaciones de RENAP y Buró (Infornet) para una oportunidad
 * cuyo origen NO es el bot de WhatsApp, registrando cada resultado en la
 * bitácora `opportunity_validations`.
 *
 * Las oportunidades del bot quedan exentas (ya fueron validadas por su flujo)
 * y no generan registros ni llamadas a las fuentes externas.
 */
export async function ejecutarValidaciones({
	opportunityId,
	userId,
}: {
	opportunityId: string;
	userId?: string | null;
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

	if (esExentaPorBot(oportunidad)) {
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

	// El DPI se valida antes de salir a RENAP: `getOnlyRenapInfoController` no lo
	// hace (a diferencia del controller completo del bot), y un DPI mal tipeado
	// termina en un 400 de Centinela con un mensaje genérico en inglés.
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

	// 1. RENAP: sincronizar datos de identidad en renap_info
	const renapResultado = await conReintento(
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

		// Infornet exige que el DPI exista en renap_info; si hay una
		// sincronización previa se puede continuar con el buró.
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

	// 2. Buró (Infornet): obtiene el estudio (usa el caché de 30 días si
	// está vigente) y evalúa el veredicto.
	//
	// El fallo se clasifica ANTES de reintentar: el reintento existe para
	// fallos transitorios, y volver a consultar no va a hacer aparecer a una
	// persona que Infornet no tiene registrada.
	let estudio = await infornetController.obtenerEstudioPorDPI(dpi);
	let buroSinRegistro = false;

	if (!estudio.success) {
		buroSinRegistro =
			estudio.error === ERROR_INFORNET_AMBIGUO &&
			(await clasificarFalloInfornet(dpi)) === "sin_registro";

		for (
			let intento = 0;
			intento < REINTENTOS_AUTOMATICOS && !estudio.success && !buroSinRegistro;
			intento++
		) {
			await esperar(ESPERA_ENTRE_REINTENTOS_MS);
			estudio = await infornetController.obtenerEstudioPorDPI(dpi);
		}
	}

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
			// Sin registro no es un fallo de la fuente: la persona simplemente no
			// tiene historial crediticio, así que no bloquea la aprobación.
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

	// `analizarRiesgo` vuelve a pedir el estudio internamente (buro.ts:297); con
	// el caché recién escrito eso no cuesta otra llamada a Infornet. Se reusa tal
	// cual para no duplicar acá la fórmula de score/nivel/alertas.
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

/**
 * Lo que quedó guardado de RENAP para ese DPI. No consulta la API: lee la
 * tabla que el propio flujo sincroniza.
 */
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

/**
 * Resumen del estudio de Infornet que quedó en caché. Tampoco consulta la API:
 * solo expone lo que ya se guardó.
 */
async function obtenerDetalleBuro(dpi: string): Promise<DetalleBuro | null> {
	const [fila] = await db
		.select()
		.from(infornetPersonaCache)
		.where(eq(infornetPersonaCache.dpi, dpi))
		.limit(1);

	if (!fila) return null;

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

/**
 * Consulta el estado de las validaciones de una oportunidad: exención del
 * bot, DPI faltante y últimos resultados de RENAP/Buró de la bitácora.
 */
export async function getValidaciones({
	opportunityId,
}: {
	opportunityId: string;
}): Promise<EstadoValidacionesOportunidad> {
	const oportunidad = await cargarOportunidadConLead(opportunityId);

	if (!oportunidad) {
		throw new OportunidadNoEncontradaError();
	}

	if (esExentaPorBot(oportunidad)) {
		return {
			exento: true,
			faltaDpi: false,
			dpi: null,
			renap: null,
			buro: null,
			buroVigente: false,
			aprobacionBloqueada: false,
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

	// Un error de RENAP solo bloquea cuando abortó antes del buró; si el buró
	// alcanzó a correr (había sincronización previa en renap_info) la
	// aprobación sigue habilitada.
	const aprobacionBloqueada = buro
		? buro.estado === "error"
		: renap?.estado === "error";

	const dpiActual = oportunidad.leadDpi
		? normalizarDpi(oportunidad.leadDpi)
		: null;

	// Si le cambiaron el DPI al lead después de validar, el resultado que se
	// muestra pertenece a otra persona. No bloquea nada (el gate revalida con el
	// DPI vigente), pero el analista tiene que verlo.
	const dpiValidado = buro?.dpi ?? renap?.dpi ?? null;
	const dpiDesactualizado = Boolean(
		dpiValidado && dpiActual && dpiValidado !== dpiActual,
	);

	// El detalle se arma con el DPI que se validó, para que coincida con el
	// veredicto que se está mostrando.
	const [detalleRenap, detalleBuro] = dpiValidado
		? await Promise.all([
				obtenerDetalleRenap(dpiValidado),
				obtenerDetalleBuro(dpiValidado),
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
		dpiDesactualizado,
		dpiValidado,
		detalleRenap,
		detalleBuro,
		validaciones,
	};
}
