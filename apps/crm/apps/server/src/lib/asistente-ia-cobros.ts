/**
 * F7 (#1864) · Asistente IA de la Ficha 360: resumen del caso y preguntas.
 *
 * Mismo motor que la lectura de boletas del bot y el análisis bancario:
 * Gemini vía `@ai-sdk/google` (`GOOGLE_GENERATIVE_AI_API_KEY`), sin
 * dependencia ni cuenta nueva.
 *
 * **Apagado por defecto.** Cada llamada cuesta: solo corre con
 * `COBROS_ASISTENTE_IA=on`. Apagado, el resumen es `null` (la ficha muestra
 * «Pronto») y las preguntas responden que el asistente no está activo.
 *
 * Costo acotado:
 * - el resumen se guarda por caso (`resumenes_ia_cobros`) con la huella de
 *   los datos que se le mandaron; solo se regenera si la huella cambia;
 * - una sola generación en curso por caso (los que abren la ficha a la vez
 *   esperan la misma);
 * - cero reintentos y timeout;
 * - tope de preguntas por usuario en 24 horas.
 *
 * Al modelo NO se le mandan el nombre, el DPI ni los teléfonos del cliente:
 * solo el estado del crédito y las gestiones. Los comentarios son texto libre,
 * así que se les tapan los números largos, los correos y los nombres de las
 * personas del caso (titular, codeudores, referencias, cónyuge). Si no se
 * pueden leer esos nombres, no se manda nada al modelo.
 *
 * Plan: docs/features/cobros-02/21-plan-backend-ficha-360.md
 */

import { createHash } from "node:crypto";
import { google } from "@ai-sdk/google";
import { ORPCError } from "@orpc/server";
import { generateObject, generateText } from "ai";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { creditApplications } from "../db/schema/client-forms";
import { clients, leads } from "../db/schema/crm";
import { renapInfo } from "../db/schema/renap";
import { contactosReferenciasCobros } from "../db/schema/referencias-cobros";
import {
	casosCobros,
	contactosCobros,
	contratosFinanciamiento,
	preguntasIaCobros,
	resumenesIaCobros,
} from "../db/schema/cobros";
import type { HitoCredito, ResumenIA } from "../routers/ficha-cobros";
import { carteraBackClient } from "../services/cartera-back-client";
import {
	type ContextoCaso,
	cargarReferencias,
	resolverContextoCaso,
} from "../services/referencias-cobros-datos";
import { contarCuotasAtrasadasUnicas } from "./cobros-plantillas";
import { eqDpi } from "./dpi-lookup";
import {
	cargarHistoricoDetallado,
	type HistoricoCargado,
} from "./ficha-complementos";
import { calcularDiasMoraExactos, diasMoraDelDetalle } from "./mora-utils";

export const MODELO_ASISTENTE = "gemini-3-flash-preview";
const TIMEOUT_GENERACION_MS = 30_000;
/** Lo que espera la ficha por un resumen nuevo antes de seguir sin él. */
const ESPERA_RESUMEN_MS = 8_000;
const MAX_GESTIONES = 20;
const MAX_HITOS = 10;
export const TOPE_PREGUNTAS_24H = 30;

export function asistenteActivo(): boolean {
	return (
		process.env.COBROS_ASISTENTE_IA === "on" &&
		!!process.env.GOOGLE_GENERATIVE_AI_API_KEY
	);
}

/* ── Contexto que ve el modelo ──────────────────────────────────────────────── */

export interface GestionContexto {
	fecha: string;
	metodo: string;
	resultado: string;
	comentario: string;
	montoPrometido: string | null;
	fechaPrometida: string | null;
	estadoPromesa: string | null;
}

export interface ContextoIA {
	credito: {
		estadoMora: string;
		diasMora: number;
		cuotasVencidas: number;
		moraAcumulada: string;
		cuotaMensual: string;
	};
	hitos: Array<{ fecha: string; descripcion: string }>;
	gestiones: GestionContexto[];
}

/**
 * Tapa los números de 8 dígitos o más (teléfonos, DPI, cuentas) aunque vengan
 * separados por espacios, puntos, guiones, diagonales, guion bajo o paréntesis.
 * La coma no separa: es la de los montos («Q1,500,000.00»). Una fecha completa
 * con año («03/10/2024») también suma 8 dígitos y se tapa: es preferible a
 * dejar pasar un teléfono escrito como «55/55/1234».
 */
export function taparNumeros(texto: string): string {
	return texto.replace(/[+(]?\d[\d\s().\/\\_·–—-]{6,}\d/g, (m) =>
		m.replace(/\D/g, "").length >= 8 ? "[número]" : m,
	);
}

const sinAcentos = (t: string) =>
	t
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase();

/**
 * Palabras comunes (partículas de los nombres, palabras del español y de
 * cobranza) que también pueden ser parte de un nombre («Mora», «San», «De»).
 * Si lo son en alguien del caso se tapan escritas con mayúscula inicial; en
 * minúscula se leen como lo que son y se conservan. Las iniciales de una sola
 * letra («Juan A. Pérez») siguen la misma regla.
 */
const NO_SON_NOMBRE = new Set([
	"de",
	"la",
	"el",
	"en",
	"un",
	"una",
	"se",
	"su",
	"sus",
	"mi",
	"tu",
	"me",
	"te",
	"lo",
	"le",
	"no",
	"si",
	"al",
	"es",
	"ya",
	"que",
	"con",
	"por",
	"para",
	"del",
	"las",
	"los",
	"san",
	"santa",
	"mora",
	"pago",
	"pagos",
	"cuota",
	"cuotas",
	"credito",
	"banco",
	"carro",
	"moto",
	"casa",
	"cliente",
	"promesa",
	"convenio",
]);

/**
 * Palabras sueltas de los nombres dados, en minúscula y sin acentos, listas
 * para `taparDatosPersonales` (todas, también las que son palabras comunes).
 */
export function palabrasDeNombres(
	nombres: Array<string | null | undefined>,
): Set<string> {
	const palabras = new Set<string>();
	for (const nombre of nombres) {
		for (const w of (nombre ?? "").split(/[^\p{L}]+/u)) {
			const t = sinAcentos(w);
			if (t.length >= 1) palabras.add(t);
		}
	}
	return palabras;
}

/**
 * Une los nombres del titular con los demás. Sin el nombre del titular no hay
 * forma de taparlo (un caso sin contrato ni oportunidad, válido, solo lo
 * conoce cartera): lanza, y el asistente no manda texto libre al modelo.
 */
export function unirNombres(
	titular: Array<string | null | undefined>,
	otros: Array<string | null | undefined>,
): Set<string> {
	const delTitular = palabrasDeNombres(titular);
	if (delTitular.size === 0) {
		throw new Error("el caso no tiene el nombre del titular en ninguna fuente");
	}
	return new Set([...delTitular, ...palabrasDeNombres(otros)]);
}

/**
 * Texto libre sin datos personales: correos, números largos y las palabras de
 * los nombres de las personas del caso (sin importar mayúsculas ni acentos).
 */
export function taparDatosPersonales(
	texto: string,
	nombres: Set<string> = new Set(),
): string {
	const sinCorreos = texto.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[correo]");
	const sinNumeros = taparNumeros(sinCorreos);
	if (nombres.size === 0) return sinNumeros;
	return sinNumeros.replace(/\p{L}+/gu, (w) => {
		const t = sinAcentos(w);
		if (!nombres.has(t)) return w;
		const esComun = NO_SON_NOMBRE.has(t) || t.length === 1;
		const comoPalabraComun = esComun && w === w.toLowerCase();
		return comoPalabraComun ? w : "[nombre]";
	});
}

const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Arma el contexto (pura, en orden estable para que la huella sea estable). */
export function armarContextoIA(fuentes: {
	credito: ContextoIA["credito"];
	hitos: HitoCredito[] | null;
	gestiones: Array<{
		fechaContacto: Date;
		metodoContacto: string;
		estadoContacto: string;
		comentarios: string;
		montoComprometido: string | null;
		fechaProximoContacto: Date | null;
		estadoPromesa: string | null;
	}>;
	/** Palabras de los nombres de las personas del caso (`palabrasDeNombres`). */
	nombres?: Set<string>;
}): ContextoIA {
	return {
		credito: fuentes.credito,
		hitos: (fuentes.hitos ?? []).slice(0, MAX_HITOS).map((h) => ({
			fecha: h.fecha.slice(0, 10),
			descripcion: h.descripcion,
		})),
		gestiones: fuentes.gestiones.slice(0, MAX_GESTIONES).map((g) => ({
			fecha: g.fechaContacto.toISOString().slice(0, 16),
			metodo: g.metodoContacto,
			resultado: g.estadoContacto,
			comentario: taparDatosPersonales(g.comentarios.trim(), fuentes.nombres).slice(
				0,
				500,
			),
			montoPrometido: g.montoComprometido,
			fechaPrometida: dia(g.fechaProximoContacto),
			estadoPromesa: g.estadoPromesa,
		})),
	};
}

/**
 * Hay algo que contar si el crédito está en mora o tiene gestiones o hitos:
 * un caso nuevo en mora sin historial igual se resume con el estado vivo.
 * Un crédito al día y sin historial no vale una llamada al modelo.
 */
export function hayQueResumir(contexto: ContextoIA): boolean {
	const { credito } = contexto;
	return (
		contexto.gestiones.length > 0 ||
		contexto.hitos.length > 0 ||
		credito.diasMora > 0 ||
		credito.cuotasVencidas > 0 ||
		Number(credito.moraAcumulada) > 0
	);
}

export function huellaContexto(contexto: ContextoIA): string {
	return createHash("sha256")
		.update(`${MODELO_ASISTENTE}\n${JSON.stringify(contexto)}`)
		.digest("hex");
}

/**
 * La mora VIVA del crédito, de cartera: la misma que pinta la ficha. Los
 * campos de mora de `casos_cobros` se desactualizan (un caso en mora podía
 * figurar «al día, 0 días»), así que no se le mandan al modelo. `null` si
 * cartera no responde.
 */
async function cargarCreditoVivo(
	numeroSifco: string | null,
): Promise<{
	credito: ContextoIA["credito"];
	/** Nombre del cliente en cartera: fuente del titular que no depende del CRM. */
	nombreCliente: string | null;
} | null> {
	if (!numeroSifco) return null;
	try {
		const c = await carteraBackClient.getCredito(numeroSifco, false, false);
		const cuotasVencidas = contarCuotasAtrasadasUnicas(c.cuotasAtrasadas ?? []);
		return {
			credito: {
				estadoMora: c.convenioActivo
					? "en_convenio"
					: (c.credito.statusCredit ?? "desconocido"),
				diasMora: diasMoraDelDetalle(c.diasAtrasoMoraMaximo, () =>
					calcularDiasMoraExactos(c.cuotasAtrasadas ?? []),
				),
				cuotasVencidas,
				moraAcumulada: Number(c.moraActual ?? 0).toFixed(2),
				cuotaMensual: Number(c.credito.cuota ?? 0).toFixed(2),
			},
			nombreCliente: c.usuario?.nombre?.trim() || null,
		};
	} catch (error) {
		console.error(`[AsistenteIA] crédito ${numeroSifco} en cartera:`, error);
		return null;
	}
}

type SolicitudNombres = {
	primerNombre: string | null;
	segundoNombre: string | null;
	primerApellido: string | null;
	segundoApellido: string | null;
	apellidoCasada: string | null;
	conyuge: string | null;
	personType: string | null;
};

/**
 * Nombres de las solicitudes de crédito. La del titular (`lead`, o sin tipo)
 * cuenta como fuente del titular: un lead sin nombre y sin nombre en cartera
 * igual se puede tapar. Codeudores y cónyuges van en `otros`.
 */
export function nombresDeSolicitudes(solicitudes: SolicitudNombres[]): {
	titular: Array<string | null>;
	otros: Array<string | null>;
} {
	return {
		titular: solicitudes
			.filter((x) => x.personType !== "coDebtor")
			.flatMap((x) => [
				x.primerNombre,
				x.segundoNombre,
				x.primerApellido,
				x.segundoApellido,
			]),
		otros: solicitudes.flatMap((x) => [
			x.primerNombre,
			x.segundoNombre,
			x.primerApellido,
			x.segundoApellido,
			x.apellidoCasada,
			x.conyuge,
		]),
	};
}

type IdentidadCaso = { leadId: string | null; opportunityId: string | null };

/** Todos los nombres guardados de una persona del caso (lead + oportunidad). */
async function nombresDeIdentidad(
	ctx: ContextoCaso,
	{ leadId, opportunityId }: IdentidadCaso,
): Promise<{ titular: Array<string | null>; otros: Array<string | null> }> {
	const [delLead, solicitudes, { referencias }] = await Promise.all([
		leadId
			? db
					.select({
						primerNombre: leads.firstName,
						segundoNombre: leads.middleName,
						primerApellido: leads.lastName,
						segundoApellido: leads.secondLastName,
						dpi: leads.dpi,
					})
					.from(leads)
					.where(eq(leads.id, leadId))
					.limit(1)
			: Promise.resolve([]),
		// Titular y codeudores: todas las solicitudes de la oportunidad.
		opportunityId
			? db
					.select({
						primerNombre: creditApplications.primerNombre,
						segundoNombre: creditApplications.segundoNombre,
						primerApellido: creditApplications.primerApellido,
						segundoApellido: creditApplications.segundoApellido,
						apellidoCasada: creditApplications.apellidoCasada,
						conyuge: creditApplications.conyugeNombre,
						personType: creditApplications.personType,
					})
					.from(creditApplications)
					.where(eq(creditApplications.opportunityId, opportunityId))
			: Promise.resolve([]),
		cargarReferencias({ ...ctx, leadId, opportunityId }),
	]);
	const dpi = delLead[0]?.dpi?.trim();
	const renap = dpi
		? await db
				.select({
					primerNombre: renapInfo.firstName,
					segundoNombre: renapInfo.secondName,
					tercerNombre: renapInfo.thirdName,
					primerApellido: renapInfo.firstLastName,
					segundoApellido: renapInfo.secondLastName,
					apellidoCasada: renapInfo.marriedLastName,
				})
				.from(renapInfo)
				.where(eqDpi(renapInfo.dpi, dpi))
				.limit(1)
		: [];
	const porSolicitud = nombresDeSolicitudes(solicitudes);
	const titular = [
		...delLead.flatMap((l) => [
			l.primerNombre,
			l.segundoNombre,
			l.primerApellido,
			l.segundoApellido,
		]),
		...renap.flatMap((r) => Object.values(r)),
		...porSolicitud.titular,
	];
	const otros = [
		...porSolicitud.otros,
		...referencias.flatMap((r) => [r.nombre, ...r.otrosNombres]),
	];
	return { titular, otros };
}

/**
 * Palabras de los nombres de las personas del caso: titular (contrato, lead,
 * RENAP y solicitudes de crédito, con todos sus componentes), codeudores,
 * referencias (vigentes y todas las copiadas en sus gestiones) y cónyuge. Se leen desde el cliente del contrato Y desde la
 * oportunidad que resuelve `resolverContextoCaso` (que sin oportunidad en el
 * cliente cae a una por SIFCO, quizá de otro lead): tapar de más es inocuo,
 * dejar un nombre sin tapar no. Lanza si no se pueden leer.
 */
async function cargarNombresCaso(
	casoCobroId: string,
	nombreCartera: Promise<string | null>,
): Promise<Set<string>> {
	const ctx = await resolverContextoCaso(casoCobroId);
	const [delContrato] = await db
		.select({
			nombre: clients.contactPerson,
			leadId: clients.leadId,
			opportunityId: clients.opportunityId,
		})
		.from(casosCobros)
		.innerJoin(
			contratosFinanciamiento,
			eq(contratosFinanciamiento.id, casosCobros.contratoId),
		)
		.innerJoin(clients, eq(clients.id, contratosFinanciamiento.clientId))
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	const identidades: IdentidadCaso[] = [
		{ leadId: ctx.leadId, opportunityId: ctx.opportunityId },
	];
	if (
		delContrato &&
		(delContrato.leadId !== ctx.leadId ||
			delContrato.opportunityId !== ctx.opportunityId)
	) {
		identidades.push({
			leadId: delContrato.leadId,
			opportunityId: delContrato.opportunityId,
		});
	}
	const [porIdentidad, delCredito, copiados] = await Promise.all([
		Promise.all(identidades.map((i) => nombresDeIdentidad(ctx, i))),
		nombreCartera,
		// Las gestiones a referencias guardan su nombre copiado: sobrevive aunque
		// la referencia se renombre o se borre. Todos, sin el límite de la
		// bitácora de la ficha (`cargarReferencias` trae solo los 200 últimos).
		db
			.selectDistinct({ nombre: contactosReferenciasCobros.referenciaNombre })
			.from(contactosReferenciasCobros)
			.where(eq(contactosReferenciasCobros.casoCobroId, casoCobroId)),
	]);
	return unirNombres(
		[delContrato?.nombre, delCredito, ...porIdentidad.flatMap((n) => n.titular)],
		[...porIdentidad.flatMap((n) => n.otros), ...copiados.map((c) => c.nombre)],
	);
}

/**
 * `hitos`: si el que llama ya los cargó (la ficha), se reutilizan para no
 * volver a llamar a cartera. `completo` = false si cartera no respondió del
 * todo o a medias (historial parcial o estado del crédito) o si no se
 * pudieron leer los nombres a tapar: con datos a medias no se genera.
 */
async function cargarContextoIA(
	casoCobroId: string,
	hitosYaCargados?: Promise<HistoricoCargado>,
): Promise<{
	contexto: ContextoIA;
	completo: boolean;
	nombres: Set<string>;
}> {
	const [caso] = await db
		.select({ numeroSifco: casosCobros.numeroCreditoSifco })
		.from(casosCobros)
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	if (!caso) {
		throw new ORPCError("NOT_FOUND", {
			message: "Caso de cobro no encontrado.",
		});
	}
	const vivo = cargarCreditoVivo(caso.numeroSifco);
	const [creditoVivo, historico, gestiones, nombres] = await Promise.all([
		vivo,
		(hitosYaCargados ?? cargarHistoricoDetallado(casoCobroId)).catch(
			(): HistoricoCargado => ({ hitos: null, completo: false }),
		),
		db
			.select({
				fechaContacto: contactosCobros.fechaContacto,
				metodoContacto: contactosCobros.metodoContacto,
				estadoContacto: contactosCobros.estadoContacto,
				comentarios: contactosCobros.comentarios,
				montoComprometido: contactosCobros.montoComprometido,
				fechaProximoContacto: contactosCobros.fechaProximoContacto,
				estadoPromesa: contactosCobros.estadoPromesa,
			})
			.from(contactosCobros)
			.where(eq(contactosCobros.casoCobroId, casoCobroId))
			.orderBy(desc(contactosCobros.fechaContacto))
			.limit(MAX_GESTIONES),
		// Sin los nombres no se puede tapar el texto libre: no se manda.
		cargarNombresCaso(
			casoCobroId,
			vivo.then((v) => v?.nombreCliente ?? null),
		).catch((error) => {
			console.error(`[AsistenteIA] nombres del caso ${casoCobroId}:`, error);
			return null;
		}),
	]);
	return {
		contexto: armarContextoIA({
			credito: creditoVivo?.credito ?? {
				estadoMora: "desconocido",
				diasMora: 0,
				cuotasVencidas: 0,
				moraAcumulada: "0.00",
				cuotaMensual: "0.00",
			},
			hitos: historico.hitos,
			gestiones,
			nombres: nombres ?? undefined,
		}),
		completo: creditoVivo !== null && historico.completo && nombres !== null,
		nombres: nombres ?? new Set(),
	};
}

const INSTRUCCIONES = `Eres el asistente de un asesor de cobranza de una financiera de vehículos en Guatemala.
Recibes, en JSON, el estado de UN crédito, los hitos de su vida (buckets de mora, convenios, promesas cumplidas) y sus gestiones de cobro más recientes (de la más nueva a la más vieja).
Reglas:
- Usa SOLO esos datos. Si algo no está, no lo inventes ni lo supongas.
- Escribe en español de Guatemala, con trato de usted hacia el asesor y sin voseo ni tuteo.
- Los montos van en quetzales con el formato Q1,500.00. «moraAcumulada» es el recargo por atraso, no el valor de la cuota.
- No incluyas nombres, teléfonos ni números de documento.`;

const resumenSchema = z.object({
	texto: z
		.string()
		.describe(
			"Resumen del caso en 3 a 5 oraciones: situación de mora, cómo ha respondido el cliente, promesas y convenios, y el siguiente paso sugerido.",
		),
	etiquetas: z
		.array(z.string())
		.describe(
			"De 1 a 4 etiquetas cortas (2 o 3 palabras) que describan el caso, por ejemplo «Promesa incumplida» o «Sin contacto».",
		),
});

/* ── Resumen ────────────────────────────────────────────────────────────────── */

type EnCurso = Map<
	string,
	{ huella: string; promesa: Promise<ResumenIA | null> }
>;
const enCursoPorCaso: EnCurso = new Map();

/** Lock por caso que serializa guardar y borrar el resumen. */
const lockResumen = (casoCobroId: string) =>
	sql`SELECT pg_advisory_xact_lock(hashtext(${`resumen-ia:${casoCobroId}`}))`;

async function generarYGuardar(
	casoCobroId: string,
	contexto: ContextoIA,
	huella: string,
	/** false si, mientras se generaba, el contexto quedó sin nada que resumir. */
	sigueVigente: () => boolean = () => true,
): Promise<ResumenIA | null> {
	try {
		const { object } = await generateObject({
			model: google(MODELO_ASISTENTE),
			schema: resumenSchema,
			abortSignal: AbortSignal.timeout(TIMEOUT_GENERACION_MS),
			// El default del SDK son dos reintentos: hasta tres llamadas pagadas.
			maxRetries: 0,
			messages: [
				{ role: "system", content: INSTRUCCIONES },
				{
					role: "user",
					content: `Resuma este caso:\n${JSON.stringify(contexto)}`,
				},
			],
		});
		const fila = {
			texto: object.texto.trim(),
			etiquetas: object.etiquetas
				.map((e) => e.trim())
				.filter(Boolean)
				.slice(0, 4),
			huella,
			modelo: MODELO_ASISTENTE,
			generadoEn: new Date(),
		};
		// La vigencia se revisa DENTRO del lock del caso, el mismo que toma el
		// borrado de `obtenerResumenIA`: o el borrado ve esta fila ya guardada y
		// la elimina, o esta generación ve que fue invalidada y no escribe.
		const guardado = await db.transaction(async (tx) => {
			await tx.execute(lockResumen(casoCobroId));
			if (!sigueVigente()) return false;
			await tx
				.insert(resumenesIaCobros)
				.values({ casoCobroId, ...fila })
				.onConflictDoUpdate({
					target: resumenesIaCobros.casoCobroId,
					set: fila,
				});
			return true;
		});
		if (!guardado) return null;
		return {
			texto: fila.texto,
			etiquetas: fila.etiquetas,
			generadoEn: fila.generadoEn.toISOString(),
		};
	} catch (error) {
		console.error(`[AsistenteIA] resumen del caso ${casoCobroId}:`, error);
		return null;
	}
}

/**
 * Una sola generación por caso a la vez, y la última gana: quien pide la misma
 * huella que ya está en curso comparte su promesa; una huella distinta (los
 * datos cambiaron mientras se generaba) espera a que termine la anterior y
 * genera la nueva, salvo que llegue otra todavía más nueva.
 */
export function generarUnaVez(
	casoCobroId: string,
	contexto: ContextoIA,
	huella: string,
	generar: typeof generarYGuardar = generarYGuardar,
	enCurso: EnCurso = enCursoPorCaso,
): Promise<ResumenIA | null> {
	const previa = enCurso.get(casoCobroId);
	if (previa?.huella === huella) return previa.promesa;
	// Sin generación previa se arranca ya; con una en curso se espera su turno.
	const vigente = () => enCurso.get(casoCobroId)?.promesa === promesa;
	const promesa: Promise<ResumenIA | null> = previa
		? previa.promesa.then(() =>
				vigente() ? generar(casoCobroId, contexto, huella, vigente) : null,
			)
		: generar(casoCobroId, contexto, huella, vigente);
	promesa
		.finally(() => {
			if (enCurso.get(casoCobroId)?.promesa === promesa) {
				enCurso.delete(casoCobroId);
			}
		})
		.catch(() => undefined);
	enCurso.set(casoCobroId, { huella, promesa });
	return promesa;
}

/**
 * Descarta la generación en curso del caso (y las que esperan turno): ninguna
 * guarda su resultado. Para cuando el contexto cambió a «nada que resumir».
 */
export function invalidarGeneracion(
	casoCobroId: string,
	enCurso: EnCurso = enCursoPorCaso,
): void {
	enCurso.delete(casoCobroId);
}

/**
 * El resumen para `getFichaComplementos`:
 * - apagado → `null`;
 * - guardado y sin cambios (o sin cartera para comparar) → el guardado;
 * - guardado pero cambiaron los datos → el guardado, y se regenera atrás;
 * - sin guardado → se espera hasta 8 s; si no llega, `null` y la generación
 *   sigue (la próxima vez que se abra la ficha ya está).
 */
export async function obtenerResumenIA(
	casoCobroId: string,
	hitos?: Promise<HistoricoCargado>,
): Promise<ResumenIA | null> {
	if (!asistenteActivo()) return null;
	const [[guardado], { contexto, completo }] = await Promise.all([
		db
			.select()
			.from(resumenesIaCobros)
			.where(eq(resumenesIaCobros.casoCobroId, casoCobroId))
			.limit(1),
		cargarContextoIA(casoCobroId, hitos),
	]);
	const comoResumen = (g: NonNullable<typeof guardado>): ResumenIA => ({
		texto: g.texto,
		etiquetas: g.etiquetas,
		generadoEn: g.generadoEn.toISOString(),
	});
	// Sin cartera el contexto sale incompleto (puede llegar hasta vacío): no
	// se paga una regeneración con menos información que el resumen que ya
	// hay, y sin resumen previo no se inventa uno con datos a medias.
	if (!completo) return guardado ? comoResumen(guardado) : null;
	if (!hayQueResumir(contexto)) {
		invalidarGeneracion(casoCobroId);
		// Con el contexto completo ya no hay nada que contar (el crédito se puso
		// al día y no tiene historial): el resumen guardado quedó obsoleto y, si
		// no se borra, un corte de cartera lo volvería a mostrar.
		// Se borra siempre (aunque la lectura de arriba no viera fila): una
		// generación ya iniciada pudo guardarla después de esa lectura.
		await db
			.transaction(async (tx) => {
				await tx.execute(lockResumen(casoCobroId));
				await tx
					.delete(resumenesIaCobros)
					.where(eq(resumenesIaCobros.casoCobroId, casoCobroId));
			})
			.catch((error) =>
				console.error(`[AsistenteIA] borrar resumen de ${casoCobroId}:`, error),
			);
		return null;
	}
	const huella = huellaContexto(contexto);
	if (guardado && guardado.huella === huella) return comoResumen(guardado);

	const generacion = generarUnaVez(casoCobroId, contexto, huella);
	if (guardado) return comoResumen(guardado);
	return Promise.race([
		generacion,
		new Promise<null>((r) => setTimeout(() => r(null), ESPERA_RESUMEN_MS)),
	]);
}

/* ── Preguntas ──────────────────────────────────────────────────────────────── */

export async function preguntarAsistente(params: {
	casoCobroId: string;
	pregunta: string;
	userId: string;
}): Promise<{ respuesta: string }> {
	if (!asistenteActivo()) {
		throw new ORPCError("PRECONDITION_FAILED", {
			message: "El asistente IA todavía no está activo.",
		});
	}
	const { contexto, completo, nombres } = await cargarContextoIA(
		params.casoCobroId,
	);
	if (!completo) {
		throw new ORPCError("BAD_GATEWAY", {
			message:
				"No se pudo leer el estado del crédito en cartera. Intente de nuevo.",
		});
	}
	// Se reserva el cupo antes de llamar al modelo, con el conteo y el insert
	// bajo un lock por usuario: preguntas concurrentes no leen el mismo conteo.
	// Si la lectura de cartera de arriba falló no se gastó nada, no se reserva.
	const reserva = await db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext(${`preguntas-ia:${params.userId}`}))`,
		);
		const [uso] = await tx
			.select({ total: sql<number>`count(*)::int` })
			.from(preguntasIaCobros)
			.where(
				and(
					eq(preguntasIaCobros.realizadaPor, params.userId),
					gte(
						preguntasIaCobros.createdAt,
						new Date(Date.now() - 24 * 60 * 60 * 1000),
					),
				),
			);
		if (Number(uso?.total ?? 0) >= TOPE_PREGUNTAS_24H) return null;
		const [fila] = await tx
			.insert(preguntasIaCobros)
			.values({
				casoCobroId: params.casoCobroId,
				pregunta: params.pregunta,
				respuesta: null,
				ok: false,
				modelo: MODELO_ASISTENTE,
				realizadaPor: params.userId,
			})
			.returning({ id: preguntasIaCobros.id });
		return fila.id;
	});
	if (!reserva) {
		throw new ORPCError("TOO_MANY_REQUESTS", {
			message: `Llegó al tope de ${TOPE_PREGUNTAS_24H} preguntas en 24 horas. Intente más tarde.`,
		});
	}
	try {
		const { text } = await generateText({
			model: google(MODELO_ASISTENTE),
			abortSignal: AbortSignal.timeout(TIMEOUT_GENERACION_MS),
			maxRetries: 0,
			messages: [
				{
					role: "system",
					content: `${INSTRUCCIONES}\n- Responde la pregunta del asesor en un máximo de 6 oraciones. Si los datos no alcanzan para responder, dilo.`,
				},
				{
					role: "user",
					content: `Datos del caso:\n${JSON.stringify(contexto)}\n\nPregunta del asesor: ${taparDatosPersonales(params.pregunta, nombres)}`,
				},
			],
		});
		const respuesta = text.trim();
		await db
			.update(preguntasIaCobros)
			.set({ respuesta, ok: true })
			.where(eq(preguntasIaCobros.id, reserva));
		return { respuesta };
	} catch (error) {
		console.error(
			`[AsistenteIA] pregunta del caso ${params.casoCobroId}:`,
			error,
		);
		// La reserva queda con ok=false: un intento fallido también pudo costar.
		throw new ORPCError("BAD_GATEWAY", {
			message: "El asistente no pudo responder. Intente de nuevo.",
		});
	}
}
