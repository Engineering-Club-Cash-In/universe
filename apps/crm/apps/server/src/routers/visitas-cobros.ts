/**
 * CB-037 / CB-038 · Visitas de cobros en la Ficha 360.
 *
 *  · `getVisitasCaso`          — las visitas del caso: programadas primero.
 *  · `getResponsablesVisita`   — quién puede ir (dueño en cartera, cobertura, supervisores).
 *  · `getDatosLaboralesCaso`   — empresa, dirección y horario del trabajo (solicitud de crédito).
 *  · `programarVisitaCobro`    — agenda una visita: dirección, responsable y fecha.
 *  · `registrarVisitaCobro`    — el resultado (de una programada o directo, ya hecha).
 *  · `cancelarVisitaCobro`     — la programada no se hizo.
 *
 * Archivo aparte de cobros.ts por TS7056 (el tipo inferido del router grande
 * ya está en el límite); se monta como router propio en index.ts.
 *
 * Autorización: la de toda la ficha (`assertAccesoCasoCobro`, que pregunta a
 * cartera quién lleva el crédito). Las visitas NUEVAS solo de B2 a B4, con el
 * bucket leído de cartera sin cache y fallando cerrado.
 */

import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { creditApplications } from "../db/schema/client-forms";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import {
	visitasCobros,
	visitasCobrosEvidencias,
} from "../db/schema/visitas-cobros";
import { cobrosProcedure } from "../lib/orpc";
import { getFileUrl } from "../lib/storage";
import {
	erroresProgramacionVisita,
	erroresRegistroVisita,
	estadoContactoDeResultado,
	metodoContactoDeVisita,
	motivoBloqueoVisita,
	programarVisitaSchema,
	type ResultadoVisita,
	registrarVisitaSchema,
	siguientesPasos,
	type TipoVisita,
	textoGestionVisita,
	visitaPermitidaEnBucket,
} from "../lib/visitas-cobros";
import { resolverContextoCaso } from "../services/referencias-cobros-datos";
import {
	assertResponsablePosible,
	avisarVisitaProgramada,
	bucketActualEstricto,
	bucketActualTolerante,
	resolverAvisosDeVisita,
	responsablesPosiblesVisita,
	verificarEvidencias,
} from "../services/visitas-cobros";
import { assertAccesoCasoCobro } from "./cobros";

type ContextoProcedure = { userId: string; userRole: string };

/** Acceso a la ficha + el SIFCO del caso (null si no tiene crédito de cartera). */
async function casoConAcceso(
	casoCobroId: string,
	context: ContextoProcedure,
): Promise<{ numeroSifco: string | null }> {
	await assertAccesoCasoCobro(casoCobroId, context.userId, context.userRole);
	const [caso] = await db
		.select({ numeroSifco: casosCobros.numeroCreditoSifco })
		.from(casosCobros)
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	return { numeroSifco: caso?.numeroSifco?.trim() || null };
}

/** Una visita NUEVA exige crédito de cartera en B3 o B4. Devuelve el bucket. */
async function exigirBucketDeVisita(
	numeroSifco: string | null,
): Promise<number> {
	if (!numeroSifco) {
		throw new ORPCError("BAD_REQUEST", {
			message: "El caso no tiene crédito de cartera asociado.",
		});
	}
	const bucket = await bucketActualEstricto(numeroSifco);
	const bloqueo = motivoBloqueoVisita(bucket);
	if (bloqueo || bucket === null) {
		throw new ORPCError("BAD_REQUEST", {
			message: bloqueo ?? "El crédito no tiene bucket.",
		});
	}
	return bucket;
}

const responsable = alias(user, "responsable_visita");
const programador = alias(user, "programador_visita");
const registrador = alias(user, "registrador_visita");
const cancelador = alias(user, "cancelador_visita");

export const visitasCobrosRouter = {
	getVisitasCaso: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await casoConAcceso(input.casoCobroId, context);
			const filas = await db
				.select({
					id: visitasCobros.id,
					tipo: visitasCobros.tipo,
					estado: visitasCobros.estado,
					direccion: visitasCobros.direccion,
					referencia: visitasCobros.referencia,
					empresa: visitasCobros.empresa,
					responsableId: visitasCobros.responsableId,
					responsable: responsable.name,
					fechaProgramada: visitasCobros.fechaProgramada,
					notasProgramacion: visitasCobros.notasProgramacion,
					programadaPor: programador.name,
					fechaVisita: visitasCobros.fechaVisita,
					resultado: visitasCobros.resultado,
					motivoSinContacto: visitasCobros.motivoSinContacto,
					montoRecibido: visitasCobros.montoRecibido,
					comentarios: visitasCobros.comentarios,
					proximoPaso: visitasCobros.proximoPaso,
					ubicacionLat: visitasCobros.ubicacionLat,
					ubicacionLng: visitasCobros.ubicacionLng,
					ubicacionPrecisionM: visitasCobros.ubicacionPrecisionM,
					registradaPor: registrador.name,
					motivoCancelacion: visitasCobros.motivoCancelacion,
					canceladaPor: cancelador.name,
					canceladaAt: visitasCobros.canceladaAt,
					promesaContactoId: visitasCobros.promesaContactoId,
					recuperacionId: visitasCobros.recuperacionId,
					createdAt: visitasCobros.createdAt,
				})
				.from(visitasCobros)
				.leftJoin(responsable, eq(visitasCobros.responsableId, responsable.id))
				.leftJoin(programador, eq(visitasCobros.programadaPor, programador.id))
				.leftJoin(registrador, eq(visitasCobros.registradaPor, registrador.id))
				.leftJoin(cancelador, eq(visitasCobros.canceladaPor, cancelador.id))
				.where(eq(visitasCobros.casoCobroId, input.casoCobroId))
				.orderBy(desc(visitasCobros.createdAt))
				.limit(50);

			const ids = filas.map((f) => f.id);
			const evidencias =
				ids.length > 0
					? await db
							.select({
								id: visitasCobrosEvidencias.id,
								visitaId: visitasCobrosEvidencias.visitaId,
								r2Key: visitasCobrosEvidencias.r2Key,
								nombreArchivo: visitasCobrosEvidencias.nombreArchivo,
							})
							.from(visitasCobrosEvidencias)
							.where(inArray(visitasCobrosEvidencias.visitaId, ids))
					: [];
			// URL firmada por foto: el bucket es privado (son fachadas de casas y
			// lugares de trabajo). Una que no se pueda firmar se omite sin tumbar
			// la lista.
			const conUrl = await Promise.all(
				evidencias.map(async (e) => ({
					id: e.id,
					visitaId: e.visitaId,
					nombreArchivo: e.nombreArchivo,
					url: await getFileUrl(e.r2Key).catch(() => null),
				})),
			);

			const visitas = filas.map((f) => {
				const pasos =
					f.estado === "realizada" && f.resultado
						? siguientesPasos(f.resultado as ResultadoVisita)
						: null;
				return {
					...f,
					tipo: f.tipo as TipoVisita,
					evidencias: conUrl.filter((e) => e.visitaId === f.id && e.url),
					pasos,
					falta: {
						promesa: !!pasos?.promesa && !f.promesaContactoId,
						entrega: !!pasos?.entrega && !f.recuperacionId,
					},
				};
			});
			// Las programadas arriba (son lo que hay que hacer), la más próxima
			// primero; después el resto, lo más reciente primero.
			const programadas = visitas
				.filter((v) => v.estado === "programada")
				.sort(
					(a, b) =>
						(a.fechaProgramada?.getTime() ?? 0) -
						(b.fechaProgramada?.getTime() ?? 0),
				);
			const resto = visitas
				.filter((v) => v.estado !== "programada")
				.sort(
					(a, b) =>
						(b.fechaVisita ?? b.canceladaAt ?? b.createdAt).getTime() -
						(a.fechaVisita ?? a.canceladaAt ?? a.createdAt).getTime(),
				);
			return [...programadas, ...resto];
		}),

	getResponsablesVisita: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const { numeroSifco } = await casoConAcceso(input.casoCobroId, context);
			return responsablesPosiblesVisita({ numeroSifco, actor: context });
		}),

	/**
	 * El trabajo del cliente, como lo declaró en la Solicitud de Crédito del
	 * titular (lo único en el monorepo que guarda la dirección del trabajo).
	 * Solo lectura: es lo que firmó el cliente, no se edita desde cobros.
	 */
	getDatosLaboralesCaso: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const ctx = await resolverContextoCaso(input.casoCobroId);
			if (!ctx.opportunityId) return null;
			const [solicitud] = await db
				.select({
					empresa: creditApplications.empresa,
					puesto: creditApplications.puesto,
					direccion: creditApplications.direccionTrabajo,
					telefono: creditApplications.telTrabajo,
					horario: creditApplications.horarios,
				})
				.from(creditApplications)
				.where(
					and(
						eq(creditApplications.opportunityId, ctx.opportunityId),
						// La del titular. NULL = solicitud anterior a la 0015, cuando
						// había una sola por oportunidad (mismo criterio que CB-036).
						or(
							eq(creditApplications.personType, "lead"),
							isNull(creditApplications.personType),
						),
					),
				)
				.orderBy(desc(creditApplications.updatedAt))
				.limit(1);
			if (!solicitud) return null;
			const limpio = (v: string | null) => v?.trim() || null;
			const datos = {
				empresa: limpio(solicitud.empresa),
				puesto: limpio(solicitud.puesto),
				direccion: limpio(solicitud.direccion),
				telefono: limpio(solicitud.telefono),
				horario: limpio(solicitud.horario),
			};
			return Object.values(datos).some(Boolean) ? datos : null;
		}),

	programarVisitaCobro: cobrosProcedure
		.input(
			programarVisitaSchema.superRefine((v, ctx) => {
				const error = erroresProgramacionVisita(v);
				if (error)
					ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
			}),
		)
		.handler(async ({ input, context }) => {
			const { numeroSifco } = await casoConAcceso(input.casoCobroId, context);
			await exigirBucketDeVisita(numeroSifco);
			assertResponsablePosible(
				input.responsableId,
				await responsablesPosiblesVisita({ numeroSifco, actor: context }),
			);
			const [visita] = await db
				.insert(visitasCobros)
				.values({
					casoCobroId: input.casoCobroId,
					tipo: input.tipo,
					estado: "programada",
					direccion: input.direccion,
					referencia: input.referencia ?? null,
					empresa: input.tipo === "trabajo" ? (input.empresa ?? null) : null,
					responsableId: input.responsableId,
					fechaProgramada: input.fechaProgramada,
					notasProgramacion: input.notas ?? null,
					programadaPor: context.userId,
				})
				.returning({ id: visitasCobros.id });
			await avisarVisitaProgramada({
				visitaId: visita.id,
				casoCobroId: input.casoCobroId,
				numeroSifco,
				tipo: input.tipo,
				fechaProgramada: input.fechaProgramada,
				direccion: input.direccion,
				responsableId: input.responsableId,
				programadaPorId: context.userId,
				esHoy: false,
			});
			return { visitaId: visita.id };
		}),

	registrarVisitaCobro: cobrosProcedure
		.input(
			registrarVisitaSchema.superRefine((v, ctx) => {
				const error = erroresRegistroVisita(v);
				if (error)
					ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
			}),
		)
		.handler(async ({ input, context }) => {
			const { numeroSifco } = await casoConAcceso(input.casoCobroId, context);

			// Completar una programada no mira el bucket (la visita ocurrió aunque
			// el crédito se haya movido después); una visita nueva, sí.
			let programada: {
				responsableId: string;
			} | null = null;
			if (input.visitaId) {
				const [fila] = await db
					.select({
						casoCobroId: visitasCobros.casoCobroId,
						estado: visitasCobros.estado,
						responsableId: visitasCobros.responsableId,
					})
					.from(visitasCobros)
					.where(eq(visitasCobros.id, input.visitaId))
					.limit(1);
				if (!fila || fila.casoCobroId !== input.casoCobroId) {
					throw new ORPCError("NOT_FOUND", {
						message: "No se encontró la visita programada.",
					});
				}
				if (fila.estado !== "programada") {
					throw new ORPCError("CONFLICT", {
						message:
							"Esa visita ya no está programada: se registró o se canceló.",
					});
				}
				programada = { responsableId: fila.responsableId };
			}
			const bucket = programada
				? await bucketActualTolerante(numeroSifco)
				: await exigirBucketDeVisita(numeroSifco);

			// El responsable que ya tenía la programada vale como "quién fue" aunque
			// hoy no lleve el crédito (el motor pudo reasignarlo): la registra quien
			// sí trabaja el caso (el dueño de hoy, su cobertura o un supervisor). Al
			// responsable anterior no se le abre la ficha por tener la visita: el
			// permiso lo da cartera, no un registro del CRM (review de Codex, PR
			// #1777). El aviso del día ya le llega al dueño de hoy.
			if (programada?.responsableId !== input.responsableId) {
				assertResponsablePosible(
					input.responsableId,
					await responsablesPosiblesVisita({ numeroSifco, actor: context }),
				);
			}
			const evidencias = await verificarEvidencias(
				input.casoCobroId,
				input.evidencias,
			);
			if (evidencias.length > 0) {
				const usadas = await db
					.select({ key: visitasCobrosEvidencias.r2Key })
					.from(visitasCobrosEvidencias)
					.where(
						inArray(
							visitasCobrosEvidencias.r2Key,
							evidencias.map((e) => e.key),
						),
					)
					.limit(1);
				if (usadas.length > 0) {
					throw new ORPCError("BAD_REQUEST", {
						message: "Una de las fotos ya está en otra visita.",
					});
				}
			}

			const valoresVisita = {
				tipo: input.tipo,
				estado: "realizada" as const,
				direccion: input.direccion,
				referencia: input.referencia ?? null,
				empresa: input.tipo === "trabajo" ? (input.empresa ?? null) : null,
				responsableId: input.responsableId,
				fechaVisita: input.fechaVisita,
				resultado: input.resultado,
				motivoSinContacto: input.motivoSinContacto ?? null,
				montoRecibido:
					input.montoRecibido !== undefined
						? input.montoRecibido.toFixed(2)
						: null,
				comentarios: input.comentarios ?? null,
				proximoPaso: input.proximoPaso ?? null,
				ubicacionLat: input.ubicacion ? String(input.ubicacion.lat) : null,
				ubicacionLng: input.ubicacion ? String(input.ubicacion.lng) : null,
				ubicacionPrecisionM: input.ubicacion?.precisionM ?? null,
				registradaPor: context.userId,
				updatedAt: new Date(),
			};
			const metodo = metodoContactoDeVisita(input.tipo);

			const resultado = await db.transaction(async (tx) => {
				let visitaId: string;
				if (input.visitaId) {
					// El WHERE sobre el estado es la garantía bajo doble clic o dos
					// personas a la vez: solo una encuentra la visita programada.
					const [fila] = await tx
						.update(visitasCobros)
						.set(valoresVisita)
						.where(
							and(
								eq(visitasCobros.id, input.visitaId),
								eq(visitasCobros.estado, "programada"),
							),
						)
						.returning({ id: visitasCobros.id });
					if (!fila) return null;
					visitaId = fila.id;
				} else {
					const [fila] = await tx
						.insert(visitasCobros)
						.values({ casoCobroId: input.casoCobroId, ...valoresVisita })
						.returning({ id: visitasCobros.id });
					visitaId = fila.id;
				}

				// La gestión: que la visita cuente en el historial, la agenda y el
				// cierre diario como cualquier otra. `realizadoPor` es quien fue.
				const [contacto] = await tx
					.insert(contactosCobros)
					.values({
						casoCobroId: input.casoCobroId,
						fechaContacto: input.fechaVisita,
						metodoContacto: metodo,
						estadoContacto: estadoContactoDeResultado(input.resultado),
						comentarios: textoGestionVisita(input),
						proximoPaso: input.proximoPaso ?? null,
						realizadoPor: input.responsableId,
						bucketSnapshot: bucket,
					})
					.returning({ id: contactosCobros.id });

				await tx
					.update(visitasCobros)
					.set({ contactoCobroId: contacto.id })
					.where(eq(visitasCobros.id, visitaId));

				if (evidencias.length > 0) {
					await tx.insert(visitasCobrosEvidencias).values(
						evidencias.map((e) => ({
							visitaId,
							r2Key: e.key,
							nombreArchivo: e.nombreArchivo,
							mimeType: e.mimeType,
							tamanoBytes: e.tamanoBytes,
							subidoPor: context.userId,
						})),
					);
				}

				return { visitaId, contactoId: contacto.id };
			});
			if (!resultado) {
				throw new ORPCError("CONFLICT", {
					message:
						"Esa visita ya no está programada: se registró o se canceló.",
				});
			}
			if (input.visitaId) await resolverAvisosDeVisita(input.visitaId);

			return {
				...resultado,
				siguientes: siguientesPasos(input.resultado),
				/** Para el formulario de entrega: si ahí traslada o solo registra. */
				bucket,
				permiteVisitasNuevas: visitaPermitidaEnBucket(bucket),
			};
		}),

	cancelarVisitaCobro: cobrosProcedure
		.input(
			z.object({
				visitaId: z.string().uuid(),
				motivo: z
					.string()
					.trim()
					.min(
						5,
						"Indique por qué no se realizó la visita (mínimo 5 caracteres)",
					)
					.max(1000),
			}),
		)
		.handler(async ({ input, context }) => {
			const [visita] = await db
				.select({ casoCobroId: visitasCobros.casoCobroId })
				.from(visitasCobros)
				.where(eq(visitasCobros.id, input.visitaId))
				.limit(1);
			// Sin visita o sin acceso al caso responden igual: no se confirma la
			// existencia de una visita ajena.
			if (!visita) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró la visita programada.",
				});
			}
			await casoConAcceso(visita.casoCobroId, context);
			const [fila] = await db
				.update(visitasCobros)
				.set({
					estado: "cancelada",
					motivoCancelacion: input.motivo,
					canceladaPor: context.userId,
					canceladaAt: new Date(),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(visitasCobros.id, input.visitaId),
						eq(visitasCobros.estado, "programada"),
					),
				)
				.returning({ id: visitasCobros.id });
			if (!fila) {
				throw new ORPCError("CONFLICT", {
					message:
						"Esa visita ya no está programada: se registró o se canceló.",
				});
			}
			await resolverAvisosDeVisita(input.visitaId);
			return { visitaId: fila.id };
		}),
};
