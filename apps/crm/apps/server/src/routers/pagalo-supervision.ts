/**
 * CB-127 · Procedures oRPC de supervisión Págalo (invalidar/regenerar/
 * reintentar). Módulo aparte de cobros.ts (5000+ líneas) importando
 * `cobrosSupervisorProcedure` directo de `../lib/orpc` — mismo patrón que
 * `pagalo-grupo-activo.ts` para no engordar `cobrosAppRouter` y evitar
 * TS7056 al inferir su tipo en el web.
 */
import { ORPCError } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
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
			await db
				.update(pagaloPaymentGroups)
				.set({ nextDispatchAt: null, dispatchClaimedAt: null })
				.where(eq(pagaloPaymentGroups.id, input.groupId));
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
		.input(z.object({ groupId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const [grupo] = await db
				.select({
					casoCobroId: pagaloPaymentGroups.casoCobroId,
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
