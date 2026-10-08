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
import { clients, leads } from "../db/schema/crm";
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
	cargarReferencias,
	resolverContextoCaso,
} from "../services/referencias-cobros-datos";
import { contarCuotasAtrasadasUnicas } from "./cobros-plantillas";
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

/** Tapa los números de 8 dígitos o más (teléfonos, DPI, cuentas). */
export function taparNumeros(texto: string): string {
	return texto.replace(/[+(]?\d[\d\s().-]{6,}\d/g, (m) =>
		m.replace(/\D/g, "").length >= 8 ? "[número]" : m,
	);
}

const sinAcentos = (t: string) =>
	t
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase();

/** Partículas de los nombres y palabras de cobranza que no son un nombre. */
const NO_SON_NOMBRE = new Set([
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
 * para `taparDatosPersonales`.
 */
export function palabrasDeNombres(
	nombres: Array<string | null | undefined>,
): Set<string> {
	const palabras = new Set<string>();
	for (const nombre of nombres) {
		for (const w of (nombre ?? "").split(/[^\p{L}]+/u)) {
			const t = sinAcentos(w);
			if (t.length >= 3 && !NO_SON_NOMBRE.has(t)) palabras.add(t);
		}
	}
	return palabras;
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
	return sinNumeros.replace(/\p{L}+/gu, (w) =>
		nombres.has(sinAcentos(w)) ? "[nombre]" : w,
	);
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
): Promise<ContextoIA["credito"] | null> {
	if (!numeroSifco) return null;
	try {
		const c = await carteraBackClient.getCredito(numeroSifco, false);
		const cuotasVencidas = contarCuotasAtrasadasUnicas(c.cuotasAtrasadas ?? []);
		return {
			estadoMora: c.convenioActivo
				? "en_convenio"
				: (c.credito.statusCredit ?? "desconocido"),
			diasMora: diasMoraDelDetalle(c.diasAtrasoMoraMaximo, () =>
				calcularDiasMoraExactos(c.cuotasAtrasadas ?? []),
			),
			cuotasVencidas,
			moraAcumulada: Number(c.moraActual ?? 0).toFixed(2),
			cuotaMensual: Number(c.credito.cuota ?? 0).toFixed(2),
		};
	} catch (error) {
		console.error(`[AsistenteIA] crédito ${numeroSifco} en cartera:`, error);
		return null;
	}
}

/**
 * Palabras de los nombres de las personas del caso: titular (contrato y
 * lead), codeudores, referencias y cónyuge. Lanza si no se pueden leer.
 */
async function cargarNombresCaso(casoCobroId: string): Promise<Set<string>> {
	const ctx = await resolverContextoCaso(casoCobroId);
	const [delContrato, delLead, { referencias }] = await Promise.all([
		db
			.select({ nombre: clients.contactPerson })
			.from(casosCobros)
			.innerJoin(
				contratosFinanciamiento,
				eq(contratosFinanciamiento.id, casosCobros.contratoId),
			)
			.innerJoin(clients, eq(clients.id, contratosFinanciamiento.clientId))
			.where(eq(casosCobros.id, casoCobroId))
			.limit(1),
		ctx.leadId
			? db
					.select({ nombre: leads.firstName, apellido: leads.lastName })
					.from(leads)
					.where(eq(leads.id, ctx.leadId))
					.limit(1)
			: Promise.resolve([]),
		cargarReferencias(ctx),
	]);
	return palabrasDeNombres([
		delContrato[0]?.nombre,
		delLead[0]?.nombre,
		delLead[0]?.apellido,
		...referencias.flatMap((r) => [r.nombre, ...r.otrosNombres]),
	]);
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
	const [credito, historico, gestiones, nombres] = await Promise.all([
		cargarCreditoVivo(caso.numeroSifco),
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
		cargarNombresCaso(casoCobroId).catch((error) => {
			console.error(`[AsistenteIA] nombres del caso ${casoCobroId}:`, error);
			return null;
		}),
	]);
	return {
		contexto: armarContextoIA({
			credito: credito ?? {
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
		completo: credito !== null && historico.completo && nombres !== null,
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

const enCurso = new Map<string, Promise<ResumenIA | null>>();

async function generarYGuardar(
	casoCobroId: string,
	contexto: ContextoIA,
	huella: string,
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
		await db
			.insert(resumenesIaCobros)
			.values({ casoCobroId, ...fila })
			.onConflictDoUpdate({ target: resumenesIaCobros.casoCobroId, set: fila });
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

/** Una sola generación por caso a la vez. */
function generarUnaVez(
	casoCobroId: string,
	contexto: ContextoIA,
	huella: string,
): Promise<ResumenIA | null> {
	const previa = enCurso.get(casoCobroId);
	if (previa) return previa;
	const promesa = generarYGuardar(casoCobroId, contexto, huella).finally(() =>
		enCurso.delete(casoCobroId),
	);
	enCurso.set(casoCobroId, promesa);
	return promesa;
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
	// Sin gestiones ni hitos no hay nada que resumir.
	if (contexto.gestiones.length === 0 && contexto.hitos.length === 0) {
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
