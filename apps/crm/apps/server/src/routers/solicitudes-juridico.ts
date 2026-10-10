/**
 * W3 (Workspace de cobros, issue #1873) · Escalar a Jurídico: el asesor lo pide
 * desde B3 o B4; el supervisor lo aprueba (cartera-back clava el crédito en B5 y
 * lo saca de la cartera del asesor) o lo rechaza. Lógica en
 * services/juridico-solicitud.ts. Archivo aparte por TS7056.
 */
import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { solicitudesJuridicoCobros } from "../db/schema/cobros";
import { isUniqueViolation } from "../lib/db-errors";
import { assertCreditoAsignadoEnCarteraPorSifco } from "../lib/credito-cartera-ownership";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import { carteraBackClient } from "../services/cartera-back-client";
import {
	aplicarEscalamientoEnCartera,
	avisarDecisionJuridico,
	avisarEscalamientoPendiente,
	ESTADOS_JURIDICO_ABIERTA,
	MOTIVOS_JURIDICO,
} from "../services/juridico-solicitud";
import { nombresClientePorSifco } from "../services/nombre-cliente-sifco";
import { creditoDelCasoRebaja } from "../services/rebaja-mora";
import { assertAccesoCasoCobro } from "./cobros";

const MIN_NOTA = 10;
/** Bucket desde el que se puede escalar (B3 y B4; la regla final vive en cartera). */
const BUCKET_MIN = 3;
const BUCKET_MAX = 4;

const solicitanteJ = alias(user, "solicitante_juridico");
const decisorJ = alias(user, "decisor_juridico");

export const solicitudesJuridicoRouter = {
	/** W3 · El asesor pide escalar el caso a Jurídico. */
	solicitarEscalarJuridico: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				motivo: z.enum(MOTIVOS_JURIDICO, {
					errorMap: () => ({ message: "Seleccione un motivo" }),
				}),
				notaJuridico: z
					.string()
					.trim()
					.min(
						MIN_NOTA,
						`La nota para Jurídico necesita al menos ${MIN_NOTA} caracteres.`,
					)
					.max(1000),
			}),
		)
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const caso = await creditoDelCasoRebaja(input.casoCobroId);
			if (!caso) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El caso no tiene crédito de cartera asociado.",
				});
			}
			await assertCreditoAsignadoEnCarteraPorSifco({
				numeroSifco: caso.numeroSifco,
				emailUsuario: context.session.user.email,
				userRole: context.userRole,
				accion: "escalar el caso a Jurídico",
			});

			let bucket: number | null = null;
			try {
				bucket =
					(await carteraBackClient.getBucketActualCredito(caso.numeroSifco))
						?.bucket ?? null;
			} catch (error) {
				console.error("[juridico] no se leyó el bucket de cartera:", error);
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message:
						"No se pudo confirmar el bucket del crédito. Intente de nuevo en un momento.",
				});
			}
			if (bucket === null || bucket < BUCKET_MIN || bucket > BUCKET_MAX) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Escalar a Jurídico aplica solo desde B${BUCKET_MIN} a B${BUCKET_MAX}${bucket === null ? "" : `; el crédito está en B${bucket}`}.`,
				});
			}

			const [abierta] = await db
				.select({ id: solicitudesJuridicoCobros.id })
				.from(solicitudesJuridicoCobros)
				.where(
					and(
						eq(solicitudesJuridicoCobros.casoCobroId, input.casoCobroId),
						inArray(solicitudesJuridicoCobros.estado, [
							...ESTADOS_JURIDICO_ABIERTA,
						]),
					),
				)
				.limit(1);
			if (abierta) {
				throw new ORPCError("CONFLICT", {
					message:
						"Este caso ya tiene una solicitud de escalado abierta. Espere la decisión del supervisor.",
				});
			}

			let creada: typeof solicitudesJuridicoCobros.$inferSelect | undefined;
			try {
				[creada] = await db
					.insert(solicitudesJuridicoCobros)
					.values({
						casoCobroId: input.casoCobroId,
						numeroCreditoSifco: caso.numeroSifco,
						bucketSnapshot: bucket,
						motivo: input.motivo,
						notaJuridico: input.notaJuridico,
						estado: "pendiente",
						solicitadoPor: context.userId,
					})
					.returning();
			} catch (error) {
				// Dos envíos a la vez (doble clic): el índice único de solicitud abierta
				// deja pasar uno; el otro recibe el mismo conflicto que el chequeo de arriba.
				if (isUniqueViolation(error)) {
					throw new ORPCError("CONFLICT", {
						message:
							"Este caso ya tiene una solicitud de escalado abierta. Espere la decisión del supervisor.",
					});
				}
				throw error;
			}
			if (!creada) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "No se pudo registrar la solicitud.",
				});
			}

			await avisarEscalamientoPendiente({
				solicitudId: creada.id,
				casoCobroId: input.casoCobroId,
				solicitanteId: context.userId,
				motivo: input.motivo,
				notaJuridico: input.notaJuridico,
				bucket,
			});

			return { id: creada.id, estado: creada.estado, bucketSnapshot: bucket };
		}),

	/** W3 · Bandeja del supervisor: escalados, abiertos primero. */
	getSolicitudesJuridico: cobrosSupervisorProcedure
		.input(
			z.object({
				estado: z
					.enum([
						"pendiente",
						"aprobada",
						"aplicada",
						"error_aplicacion",
						"rechazada",
						"cancelada",
					])
					.optional(),
				casoCobroId: z.string().uuid().optional(),
				limite: z.number().int().min(1).max(200).default(100),
			}),
		)
		.handler(async ({ input }) => {
			const filtros = [];
			if (input.estado)
				filtros.push(eq(solicitudesJuridicoCobros.estado, input.estado));
			if (input.casoCobroId) {
				filtros.push(
					eq(solicitudesJuridicoCobros.casoCobroId, input.casoCobroId),
				);
			}
			const filas = await db
				.select({
					id: solicitudesJuridicoCobros.id,
					casoCobroId: solicitudesJuridicoCobros.casoCobroId,
					numeroCreditoSifco: solicitudesJuridicoCobros.numeroCreditoSifco,
					bucketSnapshot: solicitudesJuridicoCobros.bucketSnapshot,
					motivo: solicitudesJuridicoCobros.motivo,
					notaJuridico: solicitudesJuridicoCobros.notaJuridico,
					estado: solicitudesJuridicoCobros.estado,
					solicitadoEn: solicitudesJuridicoCobros.solicitadoEn,
					solicitadoPorId: solicitudesJuridicoCobros.solicitadoPor,
					solicitadoPor: solicitanteJ.name,
					resueltoEn: solicitudesJuridicoCobros.resueltoEn,
					resueltoPor: decisorJ.name,
					notaResolucion: solicitudesJuridicoCobros.notaResolucion,
				})
				.from(solicitudesJuridicoCobros)
				.leftJoin(
					solicitanteJ,
					eq(solicitanteJ.id, solicitudesJuridicoCobros.solicitadoPor),
				)
				.leftJoin(
					decisorJ,
					eq(decisorJ.id, solicitudesJuridicoCobros.resueltoPor),
				)
				.where(filtros.length > 0 ? and(...filtros) : undefined)
				// Abiertas primero: con `limite`, el historial resuelto más nuevo no
				// puede dejar fuera una solicitud que espera acción.
				.orderBy(
					sql`CASE WHEN ${inArray(solicitudesJuridicoCobros.estado, [...ESTADOS_JURIDICO_ABIERTA])} THEN 0 ELSE 1 END`,
					desc(solicitudesJuridicoCobros.solicitadoEn),
				)
				.limit(input.limite);
			const nombres = await nombresClientePorSifco(
				filas.map((f) => f.numeroCreditoSifco),
			);
			return filas.map((f) => ({
				...f,
				clienteNombre: nombres.get(f.numeroCreditoSifco) ?? null,
			}));
		}),

	/**
	 * W3 · El supervisor aprueba (cartera clava B5 y saca el caso del asesor) o
	 * rechaza con nota. Quien lo pidió no lo decide.
	 */
	decidirSolicitudJuridico: cobrosSupervisorProcedure
		.input(
			z
				.object({
					solicitudId: z.string().uuid(),
					decision: z.enum(["aprobar", "rechazar"]),
					nota: z.string().trim().max(1000).optional(),
				})
				.superRefine((v, ctx) => {
					if (v.decision === "rechazar" && (v.nota?.length ?? 0) < MIN_NOTA) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							message: `El rechazo necesita una nota (mínimo ${MIN_NOTA} caracteres): es lo que va a leer el asesor.`,
						});
					}
				}),
		)
		.handler(async ({ input, context }) => {
			const [solicitud] = await db
				.select()
				.from(solicitudesJuridicoCobros)
				.where(eq(solicitudesJuridicoCobros.id, input.solicitudId))
				.limit(1);
			if (!solicitud) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró la solicitud de Jurídico.",
				});
			}
			if (solicitud.solicitadoPor === context.userId) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"No puede aprobar ni rechazar su propia solicitud: debe decidirla otro supervisor o administrador.",
				});
			}

			if (input.decision === "rechazar") {
				if (!["pendiente", "error_aplicacion"].includes(solicitud.estado)) {
					throw new ORPCError("CONFLICT", {
						message:
							"Esta solicitud ya no se puede rechazar: revise su estado.",
					});
				}
				if (solicitud.estado === "error_aplicacion") {
					// El error pudo ser un timeout con cartera ya commiteada: antes de
					// cerrarla como rechazada se concilia con el estado vivo del crédito.
					const caso = await creditoDelCasoRebaja(solicitud.casoCobroId);
					let vivo: string | null;
					try {
						vivo =
							(await carteraBackClient.getBucketActualCredito(
								caso?.numeroSifco ?? solicitud.numeroCreditoSifco,
							))?.status_credito ?? null;
					} catch (error) {
						console.error("[juridico] no se concilió con cartera:", error);
						throw new ORPCError("SERVICE_UNAVAILABLE", {
							message:
								"No se pudo confirmar en cartera si el escalado ya se aplicó. Intente de nuevo en un momento.",
						});
					}
					if (vivo === "EN_JURIDICO") {
						await db
							.update(solicitudesJuridicoCobros)
							.set({ estado: "aplicada" })
							.where(
								and(
									eq(solicitudesJuridicoCobros.id, solicitud.id),
									eq(solicitudesJuridicoCobros.estado, "error_aplicacion"),
								),
							);
						throw new ORPCError("CONFLICT", {
							message:
								"El escalado ya estaba aplicado en cartera: la solicitud se marcó como aplicada y no se puede rechazar.",
						});
					}
				}
				const [cerrada] = await db
					.update(solicitudesJuridicoCobros)
					.set({
						estado: "rechazada",
						resueltoPor: context.userId,
						resueltoEn: new Date(),
						notaResolucion: input.nota ?? null,
					})
					.where(
						and(
							eq(solicitudesJuridicoCobros.id, solicitud.id),
							inArray(solicitudesJuridicoCobros.estado, [
								"pendiente",
								"error_aplicacion",
							]),
						),
					)
					.returning({ id: solicitudesJuridicoCobros.id });
				if (!cerrada) {
					throw new ORPCError("CONFLICT", {
						message:
							"La solicitud cambió mientras la decidía. Actualice la vista.",
					});
				}
				await avisarDecisionJuridico({
					solicitudId: solicitud.id,
					casoCobroId: solicitud.casoCobroId,
					decision: "rechazada",
					solicitanteId: solicitud.solicitadoPor,
					decidioPorId: context.userId,
					nota: input.nota ?? null,
				});
				return { decision: "rechazada" as const };
			}

			if (
				!["pendiente", "error_aplicacion"].includes(solicitud.estado)
			) {
				throw new ORPCError("CONFLICT", {
					message:
						"Esta solicitud ya no está esperando aprobación. Actualice la vista.",
				});
			}
			const caso = await creditoDelCasoRebaja(solicitud.casoCobroId);
			if (!caso || caso.creditoId == null) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró el crédito en cartera para este caso.",
				});
			}

			// Se reclama antes de tocar cartera: dos aprobaciones a la vez no mandan
			// dos escalados. `aprobada` NO se reclama: es una aplicación en vuelo; si
			// el proceso se cayó, el job la devuelve a `error_aplicacion` y ahí sí.
			const [reclamada] = await db
				.update(solicitudesJuridicoCobros)
				.set({
					estado: "aprobada",
					resueltoPor: context.userId,
					resueltoEn: new Date(),
					notaResolucion: input.nota ?? null,
				})
				.where(
					and(
						eq(solicitudesJuridicoCobros.id, solicitud.id),
						inArray(solicitudesJuridicoCobros.estado, [
							"pendiente",
							"error_aplicacion",
						]),
					),
				)
				.returning({ id: solicitudesJuridicoCobros.id });
			if (!reclamada) {
				throw new ORPCError("CONFLICT", {
					message:
						"La solicitud cambió mientras la decidía. Actualice la vista.",
				});
			}

			const resultado = await aplicarEscalamientoEnCartera({
				creditoId: caso.creditoId,
				motivo: `Escalado a Jurídico aprobado por ${context.session.user.email}: ${solicitud.motivo} — ${solicitud.notaJuridico}`,
				emailSupervisor: context.session.user.email,
			});

			if (!resultado.ok) {
				// Solo si la fila sigue siendo la aprobación en vuelo de esta llamada: si
				// el job la devolvió y otro supervisor ya la rechazó o la aplicó, un
				// fallo tardío no pisa esa decisión.
				await db
					.update(solicitudesJuridicoCobros)
					.set({ estado: "error_aplicacion", notaResolucion: resultado.motivo })
					.where(
						and(
							eq(solicitudesJuridicoCobros.id, solicitud.id),
							eq(solicitudesJuridicoCobros.estado, "aprobada"),
							eq(solicitudesJuridicoCobros.resueltoPor, context.userId),
						),
					);
				if (resultado.definitivo) {
					throw new ORPCError("CONFLICT", { message: resultado.motivo });
				}
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message: resultado.motivo,
				});
			}

			await db
				.update(solicitudesJuridicoCobros)
				.set({ estado: "aplicada" })
				.where(
					and(
						eq(solicitudesJuridicoCobros.id, solicitud.id),
						eq(solicitudesJuridicoCobros.estado, "aprobada"),
						eq(solicitudesJuridicoCobros.resueltoPor, context.userId),
					),
				);
			await avisarDecisionJuridico({
				solicitudId: solicitud.id,
				casoCobroId: solicitud.casoCobroId,
				decision: "aplicada",
				solicitanteId: solicitud.solicitadoPor,
				decidioPorId: context.userId,
				nota: input.nota ?? null,
			});
			return { decision: "aplicada" as const };
		}),

	/** W3 · Quien lo pidió (o un supervisor) lo retira mientras espera decisión. */
	cancelarSolicitudJuridico: cobrosProcedure
		.input(z.object({ solicitudId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const [solicitud] = await db
				.select()
				.from(solicitudesJuridicoCobros)
				.where(eq(solicitudesJuridicoCobros.id, input.solicitudId))
				.limit(1);
			if (!solicitud) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró la solicitud de Jurídico.",
				});
			}
			await assertAccesoCasoCobro(
				solicitud.casoCobroId,
				context.userId,
				context.userRole,
			);
			const esSupervisor = PERMISSIONS.canAssignCobros(context.userRole ?? "");
			if (solicitud.solicitadoPor !== context.userId && !esSupervisor) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"Solo quien la pidió o un supervisor puede cancelar esta solicitud.",
				});
			}
			const [cancelada] = await db
				.update(solicitudesJuridicoCobros)
				.set({
					estado: "cancelada",
					resueltoPor: context.userId,
					resueltoEn: new Date(),
				})
				.where(
					and(
						eq(solicitudesJuridicoCobros.id, solicitud.id),
						eq(solicitudesJuridicoCobros.estado, "pendiente"),
					),
				)
				.returning({ id: solicitudesJuridicoCobros.id });
			if (!cancelada) {
				throw new ORPCError("CONFLICT", {
					message:
						"Solo se puede cancelar una solicitud que todavía espera decisión.",
				});
			}
			await avisarDecisionJuridico({
				solicitudId: solicitud.id,
				casoCobroId: solicitud.casoCobroId,
				decision: "cancelada",
				solicitanteId: solicitud.solicitadoPor,
				decidioPorId: context.userId,
				nota: null,
			});
			return { cancelada: true as boolean };
		}),
};
