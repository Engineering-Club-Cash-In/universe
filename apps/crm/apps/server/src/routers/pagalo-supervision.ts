/**
 * CB-127 · Procedures oRPC de supervisión Págalo (invalidar/regenerar/
 * reintentar). Módulo aparte de cobros.ts (5000+ líneas) importando
 * `cobrosSupervisorProcedure` directo de `../lib/orpc` — mismo patrón que
 * `pagalo-grupo-activo.ts` para no engordar `cobrosAppRouter` y evitar
 * TS7056 al inferir su tipo en el web.
 */
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { casosCobros } from "../db/schema/cobros";
import {
	pagaloPaymentEvents,
	pagaloPaymentGroups,
	pagaloPaymentLinks,
} from "../db/schema/pagalo-payments";
import { reclamarYProcesarGrupo } from "../jobs/pagalo-dispatch";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import {
	invalidarGrupo,
	PagaloReemplazoInvalido,
} from "../services/pagalo-group-lifecycle";
import { regenerarGrupo } from "../services/pagalo-link-orchestrator";
import { assertAccesoCasoCobro } from "./cobros";

const motivoSchema = z.string().trim().min(10).max(500);

export const pagaloSupervisionRouter = {
	invalidarGrupoPagalo: cobrosSupervisorProcedure
		.input(z.object({ groupId: z.string().uuid(), motivo: motivoSchema }))
		.handler(async ({ input, context }) => {
			try {
				return await invalidarGrupo({
					groupId: input.groupId,
					actorUserId: context.userId,
					source: "SUPERVISOR",
					motivo: input.motivo,
				});
			} catch (error) {
				if (error instanceof PagaloReemplazoInvalido) {
					throw new ORPCError("CONFLICT", {
						message:
							"El grupo cambió: ya tiene un pago registrado o fue cerrado. Recargá el historial.",
					});
				}
				throw error;
			}
		}),

	regenerarGrupoPagalo: cobrosSupervisorProcedure
		.input(z.object({ groupId: z.string().uuid(), motivo: motivoSchema }))
		.handler(async ({ input, context }) => {
			try {
				return await regenerarGrupo({
					groupId: input.groupId,
					actorUserId: context.userId,
					motivo: input.motivo,
				});
			} catch (error) {
				if (error instanceof PagaloReemplazoInvalido) {
					throw new ORPCError("CONFLICT", {
						message:
							"El grupo cambió: ya tiene un pago registrado o fue cerrado. Recargá el historial.",
					});
				}
				throw error;
			}
		}),

	// Solo APPLICATION_FAILED (y READY_TO_APPLY con nextDispatchAt vencido,
	// que reclamarYProcesarGrupo ya reclama sin backoff porque ese predicado
	// también matchea NULL/pasado) — REVIEW_REQUIRED no se reintenta: el
	// dispatch es determinístico, si falló por un motivo de negocio (pago mal
	// aplicado, crédito no encontrado) reintentarlo sin cambiar nada falla
	// exactamente igual. Ahí el supervisor invalida o resuelve en cartera.
	reintentarDispatchPagalo: cobrosSupervisorProcedure
		.input(z.object({ groupId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const [grupo] = await db
				.select({
					status: pagaloPaymentGroups.status,
					dispatchAttemptCount: pagaloPaymentGroups.dispatchAttemptCount,
				})
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
			if (grupo.status !== "APPLICATION_FAILED") {
				throw new ORPCError("BAD_REQUEST", {
					message: `El grupo está en ${grupo.status}: solo se reintenta un grupo en APPLICATION_FAILED.`,
				});
			}
			// reclamarGrupo (pagalo-dispatch.ts) respeta nextDispatchAt — el
			// backoff exponencial del intento fallido anterior podía dejar el
			// reintento manual del supervisor sin efecto hasta que ese backoff
			// venciera solo. Limpiarlo acá es la forma explícita de "ahora,
			// no cuando toque".
			//
			// El UPDATE era incondicional (solo WHERE id) — si el dispatcher
			// programado reclamaba este grupo (status→APPLYING, lease real)
			// entre el SELECT de arriba y este UPDATE, pisaba ese lease a
			// null. reclamarGrupo trata cualquier APPLYING con
			// dispatchClaimedAt null como reclamable, así que un segundo
			// worker (este mismo reclamarYProcesarGrupo de abajo, u otro)
			// podía reclamarlo de nuevo mientras el primero seguía en vuelo
			// — dos POSTs de importación concurrentes (hallazgo de code
			// review). Condicionado a que siga APPLICATION_FAILED; si ya no
			// lo está (alguien más lo reclamó o lo movió), no hay nada que
			// reintentar acá.
			const [limpiado] = await db
				.update(pagaloPaymentGroups)
				.set({ nextDispatchAt: null, dispatchClaimedAt: null })
				.where(
					and(
						eq(pagaloPaymentGroups.id, input.groupId),
						eq(pagaloPaymentGroups.status, "APPLICATION_FAILED"),
					),
				)
				.returning({ id: pagaloPaymentGroups.id });
			if (!limpiado) {
				throw new ORPCError("CONFLICT", {
					message:
						"El grupo cambió justo antes del reintento — recargá el historial.",
				});
			}
			await db.insert(pagaloPaymentEvents).values({
				groupId: input.groupId,
				eventType: "DISPATCH_RETRY_FORCED",
				source: "SUPERVISOR",
				actorUserId: context.userId,
				fromStatus: "APPLICATION_FAILED",
				payload: { intentosPrevios: grupo.dispatchAttemptCount },
			});
			const resultado = await reclamarYProcesarGrupo(input.groupId);
			return { resultado };
		}),

	// allocationsSnapshot bajo demanda, no en getPagaloHistorial: hasta 24
	// cuotas × 4 rubros por grupo, no tiene sentido cargarlo si el supervisor
	// no expande el detalle "Links por cuota".
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
				if (!grupo.casoCobroId) {
					throw new ORPCError("NOT_FOUND", {
						message: "Grupo Págalo sin caso de cobro asociado.",
					});
				}
				await assertAccesoCasoCobro(
					grupo.casoCobroId,
					context.userId,
					context.userRole,
				);
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
