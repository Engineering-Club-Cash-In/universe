/**
 * CB-127 · Acciones de supervisor sobre grupos/links Págalo (invalidar,
 * regenerar, reintentar aplicación) + lectura de allocations por cuota.
 *
 * Módulo aparte, no en cobros.ts: mismo motivo que pagalo-grupo-activo.ts —
 * cobrosAppRouter ya está en el límite donde TS7056 trunca el tipo inferido
 * en el web (comentario en ese archivo). Importa `cobrosSupervisorProcedure`
 * directo de ../lib/orpc para no engordar el router principal.
 *
 * La bandeja de supervisión (getPagaloSupervision) vive en un archivo
 * aparte (pagalo-supervision.ts) — mismo motivo de PRs separados: este
 * archivo es lo que consume la Ficha 360, esa es lo que consume la bandeja
 * `/cobros/pagalo`.
 */

import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { casosCobros } from "../db/schema/cobros";
import {
	pagaloPaymentGroups,
	pagaloPaymentLinks,
} from "../db/schema/pagalo-payments";
import { reclamarYProcesarGrupo } from "../jobs/pagalo-dispatch";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import {
	invalidarGrupo,
	invalidarLink,
	PagaloReemplazoInvalido,
} from "../services/pagalo-group-lifecycle";
import {
	regenerarGrupo as regenerarGrupoPagaloService,
	regenerarLinkIndividual,
} from "../services/pagalo-link-orchestrator";
import { assertAccesoCasoCobro } from "./cobros";

const motivoSchema = z.string().trim().min(10).max(500);

function traducirReemplazoInvalido(error: unknown): never {
	if (error instanceof PagaloReemplazoInvalido) {
		throw new ORPCError("CONFLICT", {
			message:
				"El grupo cambió: ya tiene un pago registrado o fue cerrado. Recargá el historial.",
		});
	}
	throw error;
}

export const pagaloLinkActionsRouter = {
	invalidarGrupoPagalo: cobrosSupervisorProcedure
		.input(
			z.object({
				groupId: z.string().uuid(),
				motivo: motivoSchema,
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const resultado = await invalidarGrupo({
					groupId: input.groupId,
					actorUserId: context.userId,
					source: "SUPERVISOR",
					motivo: input.motivo,
				});
				return { linksReemplazados: resultado.linksReemplazados.length };
			} catch (error) {
				traducirReemplazoInvalido(error);
			}
		}),

	regenerarGrupoPagalo: cobrosSupervisorProcedure
		.input(
			z.object({
				groupId: z.string().uuid(),
				motivo: motivoSchema,
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				return await regenerarGrupoPagaloService({
					groupId: input.groupId,
					actorUserId: context.userId,
					motivo: input.motivo,
				});
			} catch (error) {
				traducirReemplazoInvalido(error);
			}
		}),

	// CB-127: invalida UN link vivo sin cancelar el grupo — a diferencia de
	// invalidarGrupoPagalo, que cancela el grupo entero. Ver
	// pagalo-group-lifecycle.ts (invalidarLinkEnTx) para el criterio de
	// escalada del grupo a REVIEW_REQUIRED.
	invalidarLinkPagalo: cobrosSupervisorProcedure
		.input(
			z.object({
				linkId: z.string().uuid(),
				motivo: motivoSchema,
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				return await invalidarLink({
					linkId: input.linkId,
					actorUserId: context.userId,
					motivo: input.motivo,
				});
			} catch (error) {
				traducirReemplazoInvalido(error);
			}
		}),

	// CB-127: regenera UN link dentro del MISMO grupo — a diferencia de
	// regenerarGrupoPagalo, que cancela el grupo y crea uno nuevo. Solo para
	// un link ya cerrado sin pago (REPLACED/EXPIRED/CANCELLED/ERROR).
	regenerarLinkPagalo: cobrosSupervisorProcedure
		.input(
			z.object({
				linkId: z.string().uuid(),
				motivo: motivoSchema,
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				return await regenerarLinkIndividual({
					linkId: input.linkId,
					actorUserId: context.userId,
					motivo: input.motivo,
				});
			} catch (error) {
				traducirReemplazoInvalido(error);
			}
		}),

	reintentarDispatchPagalo: cobrosSupervisorProcedure
		.input(z.object({ groupId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const [grupo] = await db
				.select({ status: pagaloPaymentGroups.status })
				.from(pagaloPaymentGroups)
				.where(eq(pagaloPaymentGroups.id, input.groupId))
				.limit(1);
			if (!grupo) {
				throw new ORPCError("NOT_FOUND", {
					message: "Grupo Págalo no encontrado.",
				});
			}
			if (grupo.status === "REVIEW_REQUIRED") {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Un grupo en revisión no se reintenta: el comando es determinístico. Invalidá el grupo o resolvé en cartera.",
				});
			}
			if (
				grupo.status !== "APPLICATION_FAILED" &&
				grupo.status !== "READY_TO_APPLY"
			) {
				throw new ORPCError("BAD_REQUEST", {
					message: `El grupo está en ${grupo.status}: no hay aplicación pendiente que reintentar.`,
				});
			}
			// El backoff normal (`nextDispatchAt`) sigue vigente para el ciclo
			// automático; el supervisor lo salta a propósito, así que se limpia
			// antes de reclamar — reclamarGrupo respeta ese campo (pagalo-dispatch.ts).
			await db.transaction((tx) =>
				tx
					.update(pagaloPaymentGroups)
					.set({ nextDispatchAt: null, dispatchClaimedAt: null })
					.where(
						and(
							eq(pagaloPaymentGroups.id, input.groupId),
							eq(pagaloPaymentGroups.status, grupo.status),
						),
					),
			);
			const resultado = await reclamarYProcesarGrupo(input.groupId);
			return { resultado };
		}),

	getPagaloAllocations: cobrosProcedure
		.input(
			z.object({
				groupId: z.string().uuid(),
				/**
				 * Caso DESDE EL QUE se mira. El historial de la ficha es del
				 * crédito, así que lista grupos de casos anteriores —de otro
				 * asesor incluso—; autorizar solo contra el caso viejo del grupo
				 * rechazaba justo esos y el detalle quedaba mudo (Codex, #1498).
				 * Opcional: sin él se cae al criterio de siempre.
				 */
				casoCobroId: z.string().uuid().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [grupo] = await db
				.select({
					casoCobroId: pagaloPaymentGroups.casoCobroId,
					numeroCreditoSifco: pagaloPaymentGroups.numeroCreditoSifco,
					allocationsSnapshot: pagaloPaymentGroups.allocationsSnapshot,
				})
				.from(pagaloPaymentGroups)
				.where(eq(pagaloPaymentGroups.id, input.groupId))
				.limit(1);
			if (!grupo) {
				throw new ORPCError("NOT_FOUND", {
					message: "Grupo Págalo no encontrado.",
				});
			}

			// Mismo alcance que getPagaloHistorial: se autoriza por un caso al
			// que el usuario SÍ tiene acceso, y el grupo tiene que ser del MISMO
			// crédito que ese caso. El crédito no se recibe del cliente: sale del
			// caso, que es lo que impide pedir el grupo de un crédito ajeno.
			let autorizado = false;
			if (input.casoCobroId) {
				await assertAccesoCasoCobro(
					input.casoCobroId,
					context.userId,
					context.userRole,
				);
				const [caso] = await db
					.select({ numeroCreditoSifco: casosCobros.numeroCreditoSifco })
					.from(casosCobros)
					.where(eq(casosCobros.id, input.casoCobroId))
					.limit(1);
				autorizado =
					!!caso?.numeroCreditoSifco &&
					caso.numeroCreditoSifco === grupo.numeroCreditoSifco;
			}

			if (!autorizado) {
				// Sin casoCobroId (grupo del bot, sin gestión de asesor asociada) no
				// hay "dueño" a quien verificarle propiedad — la única regla posible
				// es exigir supervisor. Antes esta rama no verificaba nada: cualquier
				// usuario de cobros con el groupId podía leer el desglose financiero
				// completo de un grupo del bot (hallazgo de code review).
				if (!grupo.casoCobroId) {
					if (!PERMISSIONS.canAssignCobros(context.userRole)) {
						throw new ORPCError("FORBIDDEN", {
							message:
								"Este grupo no tiene caso asociado: solo un supervisor puede verlo.",
						});
					}
				} else {
					await assertAccesoCasoCobro(
						grupo.casoCobroId,
						context.userId,
						context.userRole,
					);
				}
			}
			const links = await db
				.select({
					id: pagaloPaymentLinks.id,
					linkType: pagaloPaymentLinks.linkType,
					status: pagaloPaymentLinks.status,
					generation: pagaloPaymentLinks.generation,
				})
				.from(pagaloPaymentLinks)
				.where(eq(pagaloPaymentLinks.groupId, input.groupId));
			return {
				allocationsSnapshot: grupo.allocationsSnapshot,
				links,
			};
		}),
};
