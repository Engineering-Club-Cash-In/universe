/**
 * Solicitudes que nacen en el Workspace de cobros (issue #1873) y se deciden en
 * la bandeja del supervisor. Hoy: rebaja de mora (W2). W3 (escalar a Jurídico)
 * irá aquí también.
 *
 * Archivo aparte por TS7056 (el MergedRouter de la web está cerca del límite),
 * como los demás routers de la ficha. Lógica en services/rebaja-mora.ts.
 */
import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { solicitudesRebajaMoraCobros } from "../db/schema/cobros";
import { assertCreditoAsignadoEnCarteraPorSifco } from "../lib/credito-cartera-ownership";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import {
	aCentavos,
	ESTADOS_SIN_REBAJA,
	quetzalesRebaja,
} from "../lib/rebaja-mora-reglas";
import { PERMISSIONS } from "../lib/roles";
import { carteraBackClient } from "../services/cartera-back-client";
import { nombresClientePorSifco } from "../services/nombre-cliente-sifco";
import {
	aplicarRebajaEnCartera,
	avisarDecisionRebaja,
	avisarRebajaPendiente,
	creditoDelCasoRebaja,
	ESTADOS_APROBABLES,
	ESTADOS_REBAJA_ABIERTA,
	ESTADOS_RECHAZABLES,
	leerCreditoVivo,
	leerSolicitudRebaja,
} from "../services/rebaja-mora";
import { assertAccesoCasoCobro } from "./cobros";

const MIN_NOTAS_REBAJA = 10;
const MONTO_REGEX = /^\d+(\.\d{1,2})?$/;

const solicitante = alias(user, "solicitante");
const decisor = alias(user, "decisor");

export const solicitudesWorkspaceRouter = {
	/**
	 * W2 · El asesor pide rebajar hasta la mora acumulada del caso. La mora se
	 * lee EN VIVO de cartera: no se acepta una cifra del cliente.
	 */
	solicitarRebajaMora: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				monto: z.string().regex(MONTO_REGEX, "Formato de monto inválido"),
				notas: z
					.string()
					.trim()
					.min(
						MIN_NOTAS_REBAJA,
						`Escriba el motivo de la rebaja (mínimo ${MIN_NOTAS_REBAJA} caracteres): es lo que va a leer el supervisor.`,
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
				accion: "solicitar una rebaja de mora",
			});

			let mora: string;
			let statusCredit: string | null;
			try {
				({ mora, statusCredit } = await leerCreditoVivo(caso.numeroSifco));
			} catch (error) {
				console.error("[rebaja-mora] no se leyó la mora de cartera:", error);
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message:
						"No se pudo confirmar la mora del crédito. Intente de nuevo en un momento.",
				});
			}
			// Un estado con régimen propio (convenio, incobrable…) no se pide: no se
			// le pide al supervisor aprobar algo que cartera va a rechazar.
			if (
				statusCredit &&
				(ESTADOS_SIN_REBAJA as readonly string[]).includes(statusCredit)
			) {
				throw new ORPCError("BAD_REQUEST", {
					message: `El crédito está en ${statusCredit}: su mora no se rebaja desde aquí.`,
				});
			}
			if (aCentavos(input.monto) <= 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El monto a rebajar debe ser mayor que cero.",
				});
			}
			if (aCentavos(mora) <= 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El crédito no tiene mora activa que rebajar.",
				});
			}
			if (aCentavos(input.monto) > aCentavos(mora)) {
				throw new ORPCError("BAD_REQUEST", {
					message: `La rebaja (${quetzalesRebaja(input.monto)}) no puede pasar de la mora acumulada (${quetzalesRebaja(mora)}).`,
				});
			}

			const [abierta] = await db
				.select({ id: solicitudesRebajaMoraCobros.id })
				.from(solicitudesRebajaMoraCobros)
				.where(
					and(
						eq(solicitudesRebajaMoraCobros.casoCobroId, input.casoCobroId),
						inArray(solicitudesRebajaMoraCobros.estado, [
							...ESTADOS_REBAJA_ABIERTA,
						]),
					),
				)
				.limit(1);
			if (abierta) {
				throw new ORPCError("CONFLICT", {
					message:
						"Este caso ya tiene una solicitud de rebaja abierta. Espere la decisión del supervisor.",
				});
			}

			const [creada] = await db
				.insert(solicitudesRebajaMoraCobros)
				.values({
					casoCobroId: input.casoCobroId,
					numeroCreditoSifco: caso.numeroSifco,
					moraSnapshot: mora,
					montoSolicitado: input.monto,
					notas: input.notas,
					estado: "pendiente",
					solicitadoPor: context.userId,
				})
				.returning();
			if (!creada) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "No se pudo registrar la solicitud.",
				});
			}

			await avisarRebajaPendiente({
				solicitudId: creada.id,
				casoCobroId: input.casoCobroId,
				solicitanteId: context.userId,
				monto: input.monto,
				mora,
				notas: input.notas,
			});

			return {
				id: creada.id,
				estado: creada.estado,
				moraSnapshot: mora,
				montoSolicitado: input.monto,
			};
		}),

	/** W2 · Bandeja del supervisor: solicitudes de rebaja, abiertas primero. */
	getSolicitudesRebajaMora: cobrosSupervisorProcedure
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
			if (input.estado) {
				filtros.push(eq(solicitudesRebajaMoraCobros.estado, input.estado));
			}
			if (input.casoCobroId) {
				filtros.push(
					eq(solicitudesRebajaMoraCobros.casoCobroId, input.casoCobroId),
				);
			}
			const filas = await db
				.select({
					id: solicitudesRebajaMoraCobros.id,
					casoCobroId: solicitudesRebajaMoraCobros.casoCobroId,
					numeroCreditoSifco: solicitudesRebajaMoraCobros.numeroCreditoSifco,
					estado: solicitudesRebajaMoraCobros.estado,
					moraSnapshot: solicitudesRebajaMoraCobros.moraSnapshot,
					montoSolicitado: solicitudesRebajaMoraCobros.montoSolicitado,
					montoAplicado: solicitudesRebajaMoraCobros.montoAplicado,
					notas: solicitudesRebajaMoraCobros.notas,
					solicitadoEn: solicitudesRebajaMoraCobros.solicitadoEn,
					solicitadoPorId: solicitudesRebajaMoraCobros.solicitadoPor,
					solicitadoPor: solicitante.name,
					resueltoEn: solicitudesRebajaMoraCobros.resueltoEn,
					resueltoPor: decisor.name,
					notaResolucion: solicitudesRebajaMoraCobros.notaResolucion,
				})
				.from(solicitudesRebajaMoraCobros)
				.leftJoin(
					solicitante,
					eq(solicitante.id, solicitudesRebajaMoraCobros.solicitadoPor),
				)
				.leftJoin(
					decisor,
					eq(decisor.id, solicitudesRebajaMoraCobros.resueltoPor),
				)
				.where(filtros.length > 0 ? and(...filtros) : undefined)
				// Abiertas primero: con `limite`, el historial resuelto más nuevo no
				// puede dejar fuera una solicitud que espera acción.
				.orderBy(
					sql`CASE WHEN ${inArray(solicitudesRebajaMoraCobros.estado, [...ESTADOS_REBAJA_ABIERTA])} THEN 0 ELSE 1 END`,
					desc(solicitudesRebajaMoraCobros.solicitadoEn),
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
	 * W2 · El supervisor aprueba (se aplica en cartera) o rechaza con nota. Quien
	 * la pidió no la decide: cuatro ojos, igual que la recuperación.
	 */
	decidirSolicitudRebajaMora: cobrosSupervisorProcedure
		.input(
			z
				.object({
					solicitudId: z.string().uuid(),
					decision: z.enum(["aprobar", "rechazar"]),
					nota: z.string().trim().max(1000).optional(),
				})
				.superRefine((v, ctx) => {
					if (
						v.decision === "rechazar" &&
						(v.nota?.length ?? 0) < MIN_NOTAS_REBAJA
					) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							message: `El rechazo necesita una nota (mínimo ${MIN_NOTAS_REBAJA} caracteres): es lo que va a leer el asesor.`,
						});
					}
				}),
		)
		.handler(async ({ input, context }) => {
			const solicitud = await leerSolicitudRebaja(input.solicitudId);
			if (!solicitud) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró la solicitud de rebaja.",
				});
			}
			if (solicitud.solicitadoPor === context.userId) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"No puede aprobar ni rechazar su propia solicitud: debe decidirla otro supervisor o administrador.",
				});
			}

			if (input.decision === "rechazar") {
				if (!ESTADOS_RECHAZABLES.includes(solicitud.estado)) {
					throw new ORPCError("CONFLICT", {
						message:
							"Esta solicitud ya no se puede rechazar: revise su estado.",
					});
				}
				// Un error_aplicacion puede ser ambiguo (timeout: cartera pudo descontar
				// igual). Antes de cerrarla como rechazada se confirma en cartera.
				if (solicitud.estado === "error_aplicacion") {
					const casoRechazo = await creditoDelCasoRebaja(solicitud.casoCobroId);
					if (!casoRechazo || casoRechazo.creditoId == null) {
						throw new ORPCError("NOT_FOUND", {
							message: "No se encontró el crédito en cartera para este caso.",
						});
					}
					let previa: Awaited<
						ReturnType<typeof carteraBackClient.consultarRebajaMoraParcial>
					>;
					try {
						previa = await carteraBackClient.consultarRebajaMoraParcial(
							casoRechazo.creditoId,
							solicitud.id,
						);
					} catch (error) {
						console.error("[rebaja-mora] no se confirmó en cartera:", error);
						throw new ORPCError("SERVICE_UNAVAILABLE", {
							message:
								"No se pudo confirmar en cartera si la rebaja ya se aplicó. Intente rechazar de nuevo en un momento.",
						});
					}
					if (previa.aplicada) {
						const [conciliada] = await db
							.update(solicitudesRebajaMoraCobros)
							.set({
								estado: "aplicada",
								montoAplicado: solicitud.montoSolicitado,
								carteraCondonacionId: previa.condonacionId,
							})
							.where(
								and(
									eq(solicitudesRebajaMoraCobros.id, solicitud.id),
									eq(solicitudesRebajaMoraCobros.estado, "error_aplicacion"),
								),
							)
							.returning({ id: solicitudesRebajaMoraCobros.id });
						if (conciliada) {
							await avisarDecisionRebaja({
								solicitudId: solicitud.id,
								casoCobroId: solicitud.casoCobroId,
								decision: "aplicada",
								solicitanteId: solicitud.solicitadoPor,
								decidioPorId: context.userId,
								monto: solicitud.montoSolicitado,
								nota: null,
							});
						}
						throw new ORPCError("CONFLICT", {
							message:
								"Cartera ya había aplicado esta rebaja: la solicitud quedó como aplicada y no se puede rechazar.",
						});
					}
				}
				const [cerrada] = await db
					.update(solicitudesRebajaMoraCobros)
					.set({
						estado: "rechazada",
						resueltoPor: context.userId,
						resueltoEn: new Date(),
						notaResolucion: input.nota ?? null,
					})
					.where(
						and(
							eq(solicitudesRebajaMoraCobros.id, solicitud.id),
							inArray(solicitudesRebajaMoraCobros.estado, [
								...ESTADOS_RECHAZABLES,
							]),
						),
					)
					.returning({ id: solicitudesRebajaMoraCobros.id });
				if (!cerrada) {
					throw new ORPCError("CONFLICT", {
						message:
							"La solicitud cambió mientras la decidía. Actualice la vista.",
					});
				}
				await avisarDecisionRebaja({
					solicitudId: solicitud.id,
					casoCobroId: solicitud.casoCobroId,
					decision: "rechazada",
					solicitanteId: solicitud.solicitadoPor,
					decidioPorId: context.userId,
					monto: solicitud.montoSolicitado,
					nota: input.nota ?? null,
				});
				return { decision: "rechazada" as const };
			}

			if (!ESTADOS_APROBABLES.includes(solicitud.estado)) {
				throw new ORPCError("CONFLICT", {
					message:
						"Esta solicitud ya no está esperando aprobación: ya se decidió o se canceló. Actualice la vista.",
				});
			}
			const caso = await creditoDelCasoRebaja(solicitud.casoCobroId);
			if (!caso || caso.creditoId == null) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró el crédito en cartera para este caso.",
				});
			}

			// La mora pudo bajar desde que se pidió (pagó, o se aplicó otra rebaja).
			// Sin esa mora la rebaja no cabe: no se aprueba y el supervisor la rechaza.
			let mora: string;
			let statusCredit: string | null;
			try {
				({ mora, statusCredit } = await leerCreditoVivo(caso.numeroSifco));
			} catch (error) {
				console.error("[rebaja-mora] no se leyó la mora de cartera:", error);
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message:
						"No se pudo confirmar la mora del crédito. Intente de nuevo en un momento.",
				});
			}
			// Sin aprobar lo que cartera va a rechazar: se deja la decisión al supervisor.
			if (
				statusCredit &&
				(ESTADOS_SIN_REBAJA as readonly string[]).includes(statusCredit)
			) {
				throw new ORPCError("CONFLICT", {
					message: `El crédito ahora está en ${statusCredit}: su mora no se rebaja desde aquí. Rechácela para cerrar la solicitud.`,
				});
			}
			if (aCentavos(solicitud.montoSolicitado) > aCentavos(mora)) {
				throw new ORPCError("CONFLICT", {
					message: `La mora ahora es ${quetzalesRebaja(mora)} y la rebaja pedida es ${quetzalesRebaja(solicitud.montoSolicitado)}. Rechácela para que el asesor pida una nueva.`,
				});
			}

			// Se reclama la solicitud antes de tocar cartera: dos aprobaciones a la
			// vez no descuentan dos veces (y cartera lo garantiza igual por id).
			const [reclamada] = await db
				.update(solicitudesRebajaMoraCobros)
				.set({
					estado: "aprobada",
					resueltoPor: context.userId,
					resueltoEn: new Date(),
					notaResolucion: input.nota ?? null,
				})
				.where(
					and(
						eq(solicitudesRebajaMoraCobros.id, solicitud.id),
						inArray(solicitudesRebajaMoraCobros.estado, [
							...ESTADOS_APROBABLES,
						]),
					),
				)
				.returning({ id: solicitudesRebajaMoraCobros.id });
			if (!reclamada) {
				throw new ORPCError("CONFLICT", {
					message:
						"La solicitud cambió mientras la decidía. Actualice la vista.",
				});
			}

			const resultado = await aplicarRebajaEnCartera({
				solicitud: {
					id: solicitud.id,
					montoSolicitado: solicitud.montoSolicitado,
					notas: solicitud.notas,
				},
				creditoId: caso.creditoId,
				emailSupervisor: context.session.user.email,
			});

			if (!resultado.ok) {
				if (resultado.definitivo) {
					// Repetir la aprobación no cambiaría nada: la solicitud se cierra como
					// rechazada con el motivo de cartera, y el asesor lo ve.
					// Solo desde `aprobada`: no pisa una solicitud que otro cierre ya aplicó.
					const [cerrada] = await db
						.update(solicitudesRebajaMoraCobros)
						.set({
							estado: "rechazada",
							notaResolucion: `No se aplicó en cartera: ${resultado.motivo}`,
						})
						.where(
							and(
								eq(solicitudesRebajaMoraCobros.id, solicitud.id),
								eq(solicitudesRebajaMoraCobros.estado, "aprobada"),
							),
						)
						.returning({ id: solicitudesRebajaMoraCobros.id });
					if (cerrada) {
						await avisarDecisionRebaja({
							solicitudId: solicitud.id,
							casoCobroId: solicitud.casoCobroId,
							decision: "rechazada",
							solicitanteId: solicitud.solicitadoPor,
							decidioPorId: context.userId,
							monto: solicitud.montoSolicitado,
							nota: resultado.motivo,
						});
					}
					throw new ORPCError("CONFLICT", {
						message: `La rebaja no se aplicó y quedó rechazada: ${resultado.motivo}`,
					});
				}
				// Transitorio: queda en error_aplicacion y se puede repetir la aprobación.
				await db
					.update(solicitudesRebajaMoraCobros)
					.set({ estado: "error_aplicacion", notaResolucion: resultado.motivo })
					.where(
						and(
							eq(solicitudesRebajaMoraCobros.id, solicitud.id),
							eq(solicitudesRebajaMoraCobros.estado, "aprobada"),
						),
					);
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message: resultado.motivo,
				});
			}

			// Cartera ya descontó: `aplicada` gana sobre un `error_aplicacion` que el
			// job de colgadas haya puesto mientras tanto, pero no sobre un cierre final.
			const [cerradaAplicada] = await db
				.update(solicitudesRebajaMoraCobros)
				.set({
					estado: "aplicada",
					montoAplicado: solicitud.montoSolicitado,
					carteraCondonacionId: resultado.condonacionId,
				})
				.where(
					and(
						eq(solicitudesRebajaMoraCobros.id, solicitud.id),
						inArray(solicitudesRebajaMoraCobros.estado, [
							"aprobada",
							"error_aplicacion",
						]),
					),
				)
				.returning({ id: solicitudesRebajaMoraCobros.id });
			if (!cerradaAplicada) {
				// Cartera descontó pero la fila ya estaba cerrada por otro lado: no se
				// avisa como aplicada algo que el CRM no registró.
				console.error(
					`[rebaja-mora] cartera aplicó la solicitud ${solicitud.id} pero ya estaba cerrada en el CRM`,
				);
				throw new ORPCError("CONFLICT", {
					message:
						"Cartera aplicó la rebaja, pero la solicitud ya figuraba cerrada. Avise a sistemas para conciliarla.",
				});
			}

			await avisarDecisionRebaja({
				solicitudId: solicitud.id,
				casoCobroId: solicitud.casoCobroId,
				decision: "aplicada",
				solicitanteId: solicitud.solicitadoPor,
				decidioPorId: context.userId,
				monto: solicitud.montoSolicitado,
				nota: input.nota ?? null,
			});
			return { decision: "aplicada" as const, moraNueva: resultado.moraNueva };
		}),

	/**
	 * W2 · Quien la pidió (o un supervisor) la retira mientras espera decisión.
	 * Una solicitud ya aprobada o con error no se cancela: se decide.
	 */
	cancelarSolicitudRebajaMora: cobrosProcedure
		.input(z.object({ solicitudId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const solicitud = await leerSolicitudRebaja(input.solicitudId);
			if (!solicitud) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró la solicitud de rebaja.",
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
				.update(solicitudesRebajaMoraCobros)
				.set({
					estado: "cancelada",
					resueltoPor: context.userId,
					resueltoEn: new Date(),
				})
				.where(
					and(
						eq(solicitudesRebajaMoraCobros.id, solicitud.id),
						eq(solicitudesRebajaMoraCobros.estado, "pendiente"),
					),
				)
				.returning({ id: solicitudesRebajaMoraCobros.id });
			if (!cancelada) {
				throw new ORPCError("CONFLICT", {
					message:
						"Solo se puede cancelar una solicitud que todavía espera decisión.",
				});
			}
			await avisarDecisionRebaja({
				solicitudId: solicitud.id,
				casoCobroId: solicitud.casoCobroId,
				decision: "cancelada",
				solicitanteId: solicitud.solicitadoPor,
				decidioPorId: context.userId,
				monto: solicitud.montoSolicitado,
				nota: null,
			});
			return { cancelada: true as boolean };
		}),
};
