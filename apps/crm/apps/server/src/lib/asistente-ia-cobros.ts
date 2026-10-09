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

import { createHash, randomUUID } from "node:crypto";
import { google } from "@ai-sdk/google";
import { ORPCError } from "@orpc/server";
import { generateObject, generateText } from "ai";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db";
import { creditApplications } from "../db/schema/client-forms";
import {
	casosCobros,
	contactosCobros,
	contratosFinanciamiento,
	preguntasIaCobros,
	resumenesIaCobros,
} from "../db/schema/cobros";
import { clients, leads, opportunities } from "../db/schema/crm";
import { contactosReferenciasCobros } from "../db/schema/referencias-cobros";
import { renapInfo } from "../db/schema/renap";
import type { HitoCredito, ResumenIA } from "../routers/ficha-cobros";
import { carteraBackClient } from "../services/cartera-back-client";
import {
	type ContextoCaso,
	cargarReferencias,
	resolverContextoCaso,
} from "../services/referencias-cobros-datos";
import { contarCuotasAtrasadasUnicas } from "./cobros-plantillas";
import { sifcoSinAmbiguedad } from "./documentos-ficha";
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
	return texto.replace(/[+(]?\d[\d\s()./\\_·–—-]{6,}\d/g, (m) =>
		m.replace(/\D/g, "").length >= 8 ? "[número]" : m,
	);
}

const sinAcentos = (t: string) =>
	t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

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
			comentario: taparDatosPersonales(
				g.comentarios.trim(),
				fuentes.nombres,
			).slice(0, 500),
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

let versionPromptCache: string | undefined;

/**
 * Huella de lo que le dice el sistema al modelo: las instrucciones y el schema
 * de la salida (serializado desde el propio schema, con sus descripciones). Se
 * deriva del contenido, no de una versión que haya que acordarse de subir.
 */
export function versionPrompt(): string {
	versionPromptCache ??= createHash("sha256")
		.update(
			INSTRUCCIONES +
				JSON.stringify(resumenSchema.shape, (_k, v) =>
					v && typeof v === "object" && "_def" in v ? v._def : v,
				),
		)
		.digest("hex")
		.slice(0, 16);
	return versionPromptCache;
}

/**
 * Huella de un resumen: modelo, prompt y schema, y los datos del caso. Si
 * cambia cualquiera de los tres, el resumen guardado deja de valer y se
 * regenera: una corrección del prompt (más estricto, o de privacidad) llega a
 * los casos que no cambiaron.
 */
export function huellaContexto(contexto: ContextoIA): string {
	return createHash("sha256")
		.update(
			`${MODELO_ASISTENTE}\n${versionPrompt()}\n${JSON.stringify(contexto)}`,
		)
		.digest("hex");
}

/**
 * La mora VIVA del crédito, de cartera: la misma que pinta la ficha. Los
 * campos de mora de `casos_cobros` se desactualizan (un caso en mora podía
 * figurar «al día, 0 días»), así que no se le mandan al modelo. `null` si
 * cartera no responde.
 */
async function cargarCreditoVivo(numeroSifco: string | null): Promise<{
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

export type IdentidadCaso = {
	leadId: string | null;
	opportunityId: string | null;
};

/**
 * Las identidades (lead + oportunidad) cuyos nombres hay que tapar: la que
 * resolvió el caso, la del cliente del contrato y todas las que comparten su
 * SIFCO, sin repetir. Tapar de más es inocuo; dejar un nombre sin tapar no.
 */
export function identidadesDelCaso(
	ctx: IdentidadCaso,
	delContrato: IdentidadCaso | null,
	porSifco: IdentidadCaso[],
): IdentidadCaso[] {
	const vistas = new Set<string>();
	const identidades: IdentidadCaso[] = [];
	for (const i of [ctx, ...(delContrato ? [delContrato] : []), ...porSifco]) {
		const clave = `${i.leadId ?? ""}|${i.opportunityId ?? ""}`;
		if (vistas.has(clave)) continue;
		vistas.add(clave);
		identidades.push({ leadId: i.leadId, opportunityId: i.opportunityId });
	}
	return identidades;
}

/**
 * Con titular desconocido entre varios candidatos, cada uno necesita su nombre
 * legible; si no, no se manda texto libre (lanza).
 */
export function exigirTitularPorIdentidad(
	titulares: Array<Array<string | null | undefined>>,
): void {
	if (titulares.some((t) => palabrasDeNombres(t).size === 0)) {
		throw new Error(
			"SIFCO en leads distintos y un candidato sin nombre de titular legible",
		);
	}
}

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
export async function cargarNombresCaso(
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
	// Todas las oportunidades con el SIFCO del caso: SIFCO puede repetirse en
	// oportunidades de otro lead y `resolverContextoCaso` elige solo una; los
	// nombres de las demás (cónyuge, codeudores, referencias) también se tapan.
	const porSifco = ctx.numeroCreditoSifco
		? await db
				.select({ id: opportunities.id, leadId: opportunities.leadId })
				.from(opportunities)
				.where(eq(opportunities.numeroSifco, ctx.numeroCreditoSifco))
		: [];
	const identidades = identidadesDelCaso(
		ctx,
		delContrato ?? null,
		porSifco.map((o) => ({ leadId: o.leadId, opportunityId: o.id })),
	);
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
	// Sin contrato y con SIFCO en leads distintos no se sabe cuál es el titular
	// (cartera dice un nombre, no de qué candidato): cada candidato tiene que
	// tener el suyo legible, o uno sin nombre dejaría sus nombres sin tapar.
	if (!delContrato && porSifco.length > 0 && !sifcoSinAmbiguedad(porSifco)) {
		exigirTitularPorIdentidad(porIdentidad.map((n) => n.titular));
	}
	return unirNombres(
		[
			delContrato?.nombre,
			delCredito,
			...porIdentidad.flatMap((n) => n.titular),
		],
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

export const resumenSchema = z.object({
	// `.describe()` solo le explica al modelo qué escribir: no valida. Sin el
	// `min(1)` (tras el trim) un resumen vacío se aceptaría y se cachearía.
	texto: z
		.string()
		.trim()
		.min(1)
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
	{
		huella: string;
		/** `instanteBD()` en que se leyó el contexto de esta generación. */
		inicio?: string;
		promesa: Promise<ResumenIA | null>;
	}
>;
const enCursoPorCaso: EnCurso = new Map();

/** Lock por caso que serializa guardar e invalidar el resumen. */
const lockResumen = (casoCobroId: string) =>
	sql`SELECT pg_advisory_xact_lock(hashtext(${`resumen-ia:${casoCobroId}`}))`;

/**
 * Huella de la fila que marca «el contexto quedó sin nada que resumir» y su
 * instante. Vive en la BD (no en memoria) para que una generación de OTRO
 * proceso, iniciada antes, tampoco guarde un resumen obsoleto. No es un resumen:
 * `obtenerResumenIA` la ignora.
 */
const SIN_RESUMEN = "__sin_resumen__";

/**
 * Reloj de la BD (el mismo de todos los procesos), como texto para compararlo
 * con `generado_en` sin pasar por zonas horarias de JS. El formato
 * («AAAA-MM-DD HH:MM:SS[.ffffff]», sin ceros finales) se ordena igual como texto
 * que como instante, así que `<` entre dos de ellos es la comparación correcta.
 */
async function instanteBD(): Promise<string> {
	const r = await db.execute<{ t: string }>(
		sql`SELECT clock_timestamp()::timestamp::text AS t`,
	);
	return r.rows[0].t;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cada cuánto mira quien espera a que otro proceso termine la misma huella. */
const ESPERA_RESERVA_MS = 500;
/** Holgura de la reserva sobre el timeout del modelo. */
const MARGEN_RESERVA_MS = 10_000;

type Resultado =
	| { tipo: "listo"; resumen: ResumenIA | null }
	| { tipo: "espera" }
	| { tipo: "reservado"; token: string };

/**
 * Paso 1, transacción CORTA bajo el lock del caso: decide si hay que generar y,
 * si sí, reserva la huella (`generando_*`, con vencimiento por si el proceso
 * muere). Nada del modelo ocurre aquí.
 * - ya está guardada esa huella → se reutiliza, sin generar;
 * - hay algo guardado hecho con un contexto más nuevo (otro proceso o una
 *   invalidación) → este resumen nacería viejo;
 * - otro proceso tiene una reserva vigente del caso (de esta huella o de otra:
 *   los datos pudieron cambiar mientras generaba) → se espera a que termine y se
 *   reevalúa: una sola generación a la vez por caso.
 */
async function reservarGeneracion(
	casoCobroId: string,
	huella: string,
	sigueVigente: () => boolean,
	inicio?: string,
): Promise<Resultado> {
	return db.transaction(async (tx) => {
		await tx.execute(lockResumen(casoCobroId));
		if (!sigueVigente()) return { tipo: "listo", resumen: null };
		const [previa] = await tx
			.select({
				huella: resumenesIaCobros.huella,
				texto: resumenesIaCobros.texto,
				etiquetas: resumenesIaCobros.etiquetas,
				generadoEn: resumenesIaCobros.generadoEn,
				// Se ordena por el contexto leído, no por cuándo terminó la
				// generación: una A lenta que termina después de leída B no es
				// más nueva que B.
				masNueva: inicio
					? hayObservacionMasNueva(huella, inicio)
					: sql<boolean>`false`,
				// Cualquier reserva vigente del caso, de la huella que sea: una sola
				// generación a la vez; quien llega después espera y reevalúa.
				reservada: sql<boolean>`${resumenesIaCobros.generandoHuella} IS NOT NULL AND ${resumenesIaCobros.generandoHasta} > clock_timestamp()::timestamp`,
			})
			.from(resumenesIaCobros)
			.where(eq(resumenesIaCobros.casoCobroId, casoCobroId))
			.limit(1);
		if (previa && previa.huella !== SIN_RESUMEN && previa.huella === huella) {
			return {
				tipo: "listo",
				resumen: {
					texto: previa.texto,
					etiquetas: previa.etiquetas,
					generadoEn: previa.generadoEn.toISOString(),
				},
			};
		}
		if (previa?.masNueva) return { tipo: "listo", resumen: null };
		if (previa?.reservada) return { tipo: "espera" };
		const token = randomUUID();
		const reserva = {
			generandoToken: token,
			generandoHuella: huella,
			generandoHasta:
				sql`clock_timestamp()::timestamp + ${TIMEOUT_GENERACION_MS + MARGEN_RESERVA_MS} * interval '1 millisecond'` as unknown as Date,
		};
		// Sin fila previa se crea una fila vacía (huella de «sin resumen» y sin
		// `contexto_en`: no cuenta como nada guardado) que solo sostiene la reserva.
		await tx
			.insert(resumenesIaCobros)
			.values({
				casoCobroId,
				texto: "",
				etiquetas: [],
				huella: SIN_RESUMEN,
				modelo: MODELO_ASISTENTE,
				...reserva,
			})
			.onConflictDoUpdate({
				target: resumenesIaCobros.casoCobroId,
				set: reserva,
			});
		return { tipo: "reservado", token };
	});
}

/**
 * Registra, en la BD y bajo el lock del caso, que en `inicio` se observó el
 * contexto de esa huella (la última observación gana, ordenada por el instante
 * de lectura). TODA petición lo hace antes de decidir qué devolver o generar:
 * devolver un guardado, compartir una generación en curso, esperar una reserva
 * o declarar «nada que resumir» son la misma cosa, una observación. Una
 * generación solo se guarda si ninguna observación posterior es de otro
 * contexto, así que una de un contexto anterior no pisa a la más nueva sin
 * importar por qué camino llegó la observación. Una fila por apertura de la
 * ficha (se crea una fila vacía, sin resumen, si el caso aún no tenía).
 */
export async function registrarObservacion(
	casoCobroId: string,
	huellaObservada: string,
	inicio: string,
): Promise<void> {
	const obs = {
		contextoEn: sql`${inicio}::timestamp` as unknown as Date,
		observadoHuella: huellaObservada,
	};
	await db
		.transaction(async (tx) => {
			await tx.execute(lockResumen(casoCobroId));
			await tx
				.insert(resumenesIaCobros)
				.values({
					casoCobroId,
					texto: "",
					etiquetas: [],
					huella: SIN_RESUMEN,
					modelo: MODELO_ASISTENTE,
					...obs,
				})
				.onConflictDoUpdate({
					target: resumenesIaCobros.casoCobroId,
					set: obs,
					setWhere: sql`${resumenesIaCobros.contextoEn} IS NULL OR ${resumenesIaCobros.contextoEn} < ${inicio}::timestamp`,
				});
		})
		.catch((error) =>
			console.error(
				`[AsistenteIA] registrar observación de ${casoCobroId}:`,
				error,
			),
		);
}

/**
 * ¿Hay una observación posterior a `inicio` de OTRO contexto? Entonces lo que
 * esta generación produzca nacería viejo. Observaciones posteriores del mismo
 * contexto no cuentan.
 */
const hayObservacionMasNueva = (huella: string, inicio: string) =>
	sql<boolean>`${resumenesIaCobros.contextoEn} IS NOT NULL AND ${resumenesIaCobros.contextoEn} > ${inicio}::timestamp AND ${resumenesIaCobros.observadoHuella} IS DISTINCT FROM ${huella}`;

/** Suelta la reserva propia (el modelo falló o el contexto dejó de valer). */
async function liberarReserva(casoCobroId: string, token: string) {
	await db
		.update(resumenesIaCobros)
		.set({ generandoHuella: null, generandoHasta: null, generandoToken: null })
		.where(
			and(
				eq(resumenesIaCobros.casoCobroId, casoCobroId),
				// Solo la reserva propia: si venció y otra instancia la retomó (con
				// la misma huella), la reserva viva no es nuestra.
				eq(resumenesIaCobros.generandoToken, token),
			),
		)
		.catch((error) =>
			console.error(`[AsistenteIA] liberar reserva de ${casoCobroId}:`, error),
		);
}

/**
 * Genera y guarda el resumen del caso, sin retener ninguna transacción ni
 * conexión mientras responde el modelo (hasta `TIMEOUT_GENERACION_MS`):
 * 1. `reservarGeneracion`: transacción corta bajo el lock del caso;
 * 2. el modelo, FUERA de toda transacción;
 * 3. transacción corta bajo el mismo lock que revalida y escribe: no escribe si
 *   ya hay guardado algo hecho con un contexto más nuevo (un resumen o la marca
 *   de «sin nada que resumir»), y la invalidación de `obtenerResumenIA` toma el
 *   mismo lock, así que o ve esta fila ya guardada y la reemplaza, o llega
 *   antes y esta generación la respeta.
 * Otro proceso con una reserva vigente del caso no llama al modelo: espera
 * consultando (consultas sueltas, sin conexión retenida) y reevalúa: reutiliza
 * la fila si es de su huella, o genera la suya cuando la anterior terminó.
 */
export async function generarYGuardar(
	casoCobroId: string,
	contexto: ContextoIA,
	huella: string,
	/** false si, mientras se generaba, el contexto quedó sin nada que resumir. */
	sigueVigente: () => boolean = () => true,
	/** `instanteBD()` tomado ANTES de leer el contexto que se resume. */
	inicio?: string,
): Promise<ResumenIA | null> {
	/** Token de la reserva propia, mientras se tenga. */
	let token: string | undefined;
	try {
		const limite = Date.now() + TIMEOUT_GENERACION_MS + MARGEN_RESERVA_MS;
		for (;;) {
			const r = await reservarGeneracion(
				casoCobroId,
				huella,
				sigueVigente,
				inicio,
			);
			if (r.tipo === "listo") return r.resumen;
			if (r.tipo === "reservado") {
				token = r.token;
				break;
			}
			if (Date.now() >= limite) return null;
			await dormir(ESPERA_RESERVA_MS);
		}

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
		const texto = object.texto.trim();
		// Un resumen vacío no se guarda: quedaría cacheado bajo esta huella y se
		// devolvería en blanco sin reintentar hasta que cambie el caso.
		if (!texto) throw new Error("el modelo devolvió un resumen vacío");
		const fila = {
			texto,
			etiquetas: object.etiquetas
				.map((e) => e.trim())
				.filter(Boolean)
				.slice(0, 4),
			huella,
			modelo: MODELO_ASISTENTE,
			generadoEn: sql`clock_timestamp()::timestamp` as unknown as Date,
			contextoEn: inicio
				? (sql`${inicio}::timestamp` as unknown as Date)
				: null,
			observadoHuella: huella,
			generandoHuella: null,
			generandoHasta: null,
			generandoToken: null,
		};
		// Al guardar solo se suelta la reserva si es la propia: si venció y otra
		// instancia la retomó (con la misma huella), su reserva viva se respeta.
		const sueltaSiEsMia = (columna: AnyPgColumn) =>
			sql`CASE WHEN ${resumenesIaCobros.generandoToken} = ${token} THEN NULL ELSE ${columna} END` as unknown as null;
		const filaSet = {
			...fila,
			// `contexto_en` no retrocede: puede haber una observación posterior de
			// este mismo contexto.
			...(inicio && {
				contextoEn:
					sql`GREATEST(${resumenesIaCobros.contextoEn}, ${inicio}::timestamp)` as unknown as Date,
			}),
			generandoHuella: sueltaSiEsMia(resumenesIaCobros.generandoHuella),
			generandoHasta: sueltaSiEsMia(resumenesIaCobros.generandoHasta),
			// (En un UPDATE todas las expresiones leen el valor previo de la fila.)
			generandoToken: sueltaSiEsMia(resumenesIaCobros.generandoToken),
		};
		const guardada = await db.transaction(async (tx) => {
			await tx.execute(lockResumen(casoCobroId));
			if (!sigueVigente()) return null;
			if (inicio) {
				const [mas] = await tx
					.select({ masNueva: hayObservacionMasNueva(huella, inicio) })
					.from(resumenesIaCobros)
					.where(eq(resumenesIaCobros.casoCobroId, casoCobroId))
					.limit(1);
				if (mas?.masNueva) return null;
			}
			const [g] = await tx
				.insert(resumenesIaCobros)
				.values({ casoCobroId, ...fila })
				.onConflictDoUpdate({
					target: resumenesIaCobros.casoCobroId,
					set: filaSet,
				})
				.returning({ generadoEn: resumenesIaCobros.generadoEn });
			return g;
		});
		if (!guardada) {
			await liberarReserva(casoCobroId, token);
			return null;
		}
		token = undefined;
		return {
			texto: fila.texto,
			etiquetas: fila.etiquetas,
			generadoEn: guardada.generadoEn.toISOString(),
		};
	} catch (error) {
		console.error(`[AsistenteIA] resumen del caso ${casoCobroId}:`, error);
		if (token) await liberarReserva(casoCobroId, token);
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
	/** `instanteBD()` tomado ANTES de leer `contexto`. */
	inicio?: string,
): Promise<ResumenIA | null> {
	const previa = enCurso.get(casoCobroId);
	if (previa?.huella === huella) return previa.promesa;
	// Dos peticiones leen el contexto a la vez y la más vieja termina de leer
	// después: ordena el instante en que se leyó, no el de llegada. La más vieja
	// no reemplaza a la nueva (cancelaría su guardado y se guardaría el contexto
	// viejo): comparte su resultado.
	if (previa?.inicio && inicio && inicio < previa.inicio) return previa.promesa;
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
	enCurso.set(casoCobroId, { huella, inicio, promesa });
	return promesa;
}

/**
 * Descarta la generación en curso del caso (y las que esperan turno): ninguna
 * guarda su resultado. Para cuando el contexto cambió a «nada que resumir».
 */
export function invalidarGeneracion(
	casoCobroId: string,
	/** `instanteBD()` en que se leyó el contexto que motiva la invalidación. */
	inicio?: string,
	enCurso: EnCurso = enCursoPorCaso,
): void {
	const actual = enCurso.get(casoCobroId);
	// Una lectura más vieja que la generación en curso no la invalida: ya hay
	// un contexto más nuevo que el suyo.
	if (actual?.inicio && inicio && inicio < actual.inicio) return;
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
	// Antes de leer nada: una invalidación posterior a este instante descarta
	// la generación que salga de este contexto.
	const inicio = await instanteBD();
	const [[fila], { contexto, completo }] = await Promise.all([
		db
			.select()
			.from(resumenesIaCobros)
			.where(eq(resumenesIaCobros.casoCobroId, casoCobroId))
			.limit(1),
		cargarContextoIA(casoCobroId, hitos),
	]);
	const guardado = fila?.huella === SIN_RESUMEN ? undefined : fila;
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
		invalidarGeneracion(casoCobroId, inicio);
		// Con el contexto completo ya no hay nada que contar (el crédito se puso
		// al día y no tiene historial): el resumen guardado quedó obsoleto y, si
		// no se borra, un corte de cartera lo volvería a mostrar.
		// Se reemplaza por la fila marcadora siempre (aunque la lectura de arriba
		// no viera fila): una generación ya iniciada, aquí o en otro proceso,
		// pudo guardarla después de esa lectura o guardarla después de esto.
		const marca = {
			texto: "",
			etiquetas: [],
			huella: SIN_RESUMEN,
			modelo: MODELO_ASISTENTE,
			generadoEn: sql`clock_timestamp()::timestamp` as unknown as Date,
			contextoEn: sql`${inicio}::timestamp` as unknown as Date,
			observadoHuella: SIN_RESUMEN,
		};
		await db
			.transaction(async (tx) => {
				await tx.execute(lockResumen(casoCobroId));
				await tx
					.insert(resumenesIaCobros)
					.values({ casoCobroId, ...marca })
					.onConflictDoUpdate({
						target: resumenesIaCobros.casoCobroId,
						set: marca,
						// Una marca hecha con un contexto más viejo que el de la fila
						// guardada no la pisa.
						setWhere: sql`${resumenesIaCobros.contextoEn} IS NULL OR ${resumenesIaCobros.contextoEn} <= ${inicio}::timestamp`,
					});
			})
			.catch((error) =>
				console.error(
					`[AsistenteIA] invalidar resumen de ${casoCobroId}:`,
					error,
				),
			);
		return null;
	}
	const huella = huellaContexto(contexto);
	// Se registra la observación ANTES de decidir: devolver el guardado,
	// compartir una generación en curso o esperar una reserva son todas
	// observaciones de este contexto, y una generación de otro contexto más
	// viejo (aquí o en otro proceso) no debe guardarse después de esta.
	await registrarObservacion(casoCobroId, huella, inicio);
	if (guardado && guardado.huella === huella) {
		// El contexto volvió a ser el del resumen guardado (p. ej. se restauró una
		// promesa editada): lo que se esté generando de otro contexto es viejo.
		invalidarGeneracion(casoCobroId, inicio);
		return comoResumen(guardado);
	}

	const generacion = generarUnaVez(
		casoCobroId,
		contexto,
		huella,
		(id, ctx, h, vigente) => generarYGuardar(id, ctx, h, vigente, inicio),
		undefined,
		inicio,
	);
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
		// Una respuesta vacía no es una respuesta: se trata como fallo (la
		// reserva queda con ok=false) en vez de guardarla y devolverla en blanco.
		if (!respuesta) throw new Error("el modelo devolvió una respuesta vacía");
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
