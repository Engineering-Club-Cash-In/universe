import { ORPCError } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { casosCobros, seguimientosProgramados } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import { procesarSeguimientosRecurrentes } from "../jobs/cobros-notifications";
import { PERMISSIONS } from "../lib/roles";
import { gtDateStrToDate, toDateStrGT } from "../lib/guatemala-month-window";

/** Verifica que el usuario tenga acceso al caso de cobro. Lanza FORBIDDEN si no. */
async function verifyCaseAccess(casoCobroId: string, userId: string, userRole: string) {
	const [caso] = await db
		.select({ id: casosCobros.id, responsableCobros: casosCobros.responsableCobros })
		.from(casosCobros)
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);

	if (!caso) {
		throw new ORPCError("NOT_FOUND", { message: "Caso de cobro no encontrado" });
	}

	if (!PERMISSIONS.canViewAllCasosCobros(userRole) && caso.responsableCobros !== userId) {
		throw new ORPCError("FORBIDDEN", { message: "No tienes acceso a este caso de cobro" });
	}

	return caso;
}

export const seguimientosRouter = {
	runSeguimientosJob: cobrosSupervisorProcedure
		.handler(async () => {
			await procesarSeguimientosRecurrentes();
			return { success: true };
		}),

	createSeguimiento: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				metodoContacto: z.enum([
					"llamada",
					"whatsapp",
					"email",
					"visita_domicilio",
					"carta_notarial",
				]),
				intervaloDias: z.number().int().min(1),
				ocurrenciasMaximas: z.number().int().optional().nullable(),
				fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
				presetOriginal: z.string().optional().nullable(),
			}),
		)
		.handler(async ({ input, context }) => {
			await verifyCaseAccess(input.casoCobroId, context.userId, context.userRole);

			const result = await db
				.insert(seguimientosProgramados)
				.values({
					casoCobroId: input.casoCobroId,
					agenteId: context.userId,
					metodoContacto: input.metodoContacto,
					intervaloDias: input.intervaloDias,
					ocurrenciasMaximas: input.ocurrenciasMaximas ?? null,
					fechaInicio: gtDateStrToDate(input.fechaInicio),
					fechaFin: input.fechaFin ? gtDateStrToDate(input.fechaFin) : null,
					presetOriginal: input.presetOriginal ?? null,
				})
				.returning();

			const fechaInicio = gtDateStrToDate(input.fechaInicio);

			// Actualizar proximoContacto de inmediato con la fechaInicio
			// para que la card "Próximo Contacto" muestre la fecha sin esperar el job.
			const [caso] = await db
				.select()
				.from(casosCobros)
				.where(eq(casosCobros.id, input.casoCobroId))
				.limit(1);

			if (caso) {
				const hoyStr = toDateStrGT(new Date());
				const inicioStr = toDateStrGT(fechaInicio);
				const isToday = inicioStr === hoyStr;

				// Solo actualizar proximoContacto si no hay uno previo más temprano.
				const shouldUpdateProximo =
					!caso.proximoContacto || fechaInicio < caso.proximoContacto;

				const ops: Promise<unknown>[] = [];

				if (shouldUpdateProximo) {
					ops.push(
						db.update(casosCobros)
							.set({
								proximoContacto: fechaInicio,
								metodoContactoProximo: input.metodoContacto,
								updatedAt: new Date(),
							})
							.where(eq(casosCobros.id, input.casoCobroId)),
					);
				}

				if (isToday) {
					// Si fechaInicio es hoy, crear notificación inmediata y marcar ocurrencia 0
					// como realizada para que el job nocturno no duplique la notificación.
					ops.push(
						db.insert(notifications).values({
							titulo: "Seguimiento programado para hoy",
							descripcion: `Tienes un contacto vía ${input.metodoContacto} pendiente hoy para el crédito ${caso.numeroCreditoSifco || caso.id.slice(0, 8)}`,
							type: "reminder",
							status: "pending",
							createdBy: context.userId,
							createdByRole: "cobros",
							assignedToRole: "cobros",
							assignedTo: caso.responsableCobros,
							relatedEntityType: "collection_case",
							relatedEntityId: caso.id,
							redirectPage: "cobros_detail",
						}),
						db.update(seguimientosProgramados)
							.set({ ocurrenciasRealizadas: 1, updatedAt: new Date() })
							.where(eq(seguimientosProgramados.id, result[0].id)),
					);
				}

				if (ops.length > 0) await Promise.all(ops);
			}

			return result[0];
		}),

	getSeguimientosActivos: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			await verifyCaseAccess(input.casoCobroId, context.userId, context.userRole);

			const seguimientos = await db
				.select()
				.from(seguimientosProgramados)
				.where(
					and(
						eq(seguimientosProgramados.casoCobroId, input.casoCobroId),
						eq(seguimientosProgramados.activo, true)
					)
				);
			return seguimientos;
		}),

	updateSeguimiento: cobrosProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				activo: z.boolean(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [seguimiento] = await db
				.select({ casoCobroId: seguimientosProgramados.casoCobroId })
				.from(seguimientosProgramados)
				.where(eq(seguimientosProgramados.id, input.id))
				.limit(1);

			if (!seguimiento) {
				throw new ORPCError("NOT_FOUND", { message: "Seguimiento no encontrado" });
			}

			await verifyCaseAccess(seguimiento.casoCobroId, context.userId, context.userRole);

			const result = await db
				.update(seguimientosProgramados)
				.set({
					activo: input.activo,
					updatedAt: new Date(),
				})
				.where(eq(seguimientosProgramados.id, input.id))
				.returning();
			return result[0];
		}),

	deleteSeguimiento: cobrosProcedure
		.input(
			z.object({
				id: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [seguimiento] = await db
				.select({ casoCobroId: seguimientosProgramados.casoCobroId })
				.from(seguimientosProgramados)
				.where(eq(seguimientosProgramados.id, input.id))
				.limit(1);

			if (!seguimiento) {
				throw new ORPCError("NOT_FOUND", { message: "Seguimiento no encontrado" });
			}

			await verifyCaseAccess(seguimiento.casoCobroId, context.userId, context.userRole);

			const result = await db
				.delete(seguimientosProgramados)
				.where(eq(seguimientosProgramados.id, input.id))
				.returning();

			// Recompute proximo_contacto del caso: el seguimiento eliminado podía ser la fuente
			// del próximo contacto mostrado en la card. Sin actualización, queda una fecha fantasma.
			const remaining = await db
				.select({
					fechaInicio: seguimientosProgramados.fechaInicio,
					intervaloDias: seguimientosProgramados.intervaloDias,
					ocurrenciasRealizadas: seguimientosProgramados.ocurrenciasRealizadas,
					metodoContacto: seguimientosProgramados.metodoContacto,
				})
				.from(seguimientosProgramados)
				.where(
					and(
						eq(seguimientosProgramados.casoCobroId, seguimiento.casoCobroId),
						eq(seguimientosProgramados.activo, true),
					)
				)
				.orderBy(asc(seguimientosProgramados.fechaInicio));

			let nextContacto: Date | null = null;
			let nextMetodo: string | null = null;
			for (const seg of remaining) {
				// Próxima fecha = fechaInicio + intervaloDias * ocurrenciasRealizadas
				// Cuando ocurrenciasRealizadas=0, nextDate = fechaInicio (podría ser hoy o atrasada).
				const nextDate = new Date(
					seg.fechaInicio.getTime() + seg.intervaloDias * seg.ocurrenciasRealizadas * 86_400_000,
				);
				if (!nextContacto || nextDate < nextContacto) {
					nextContacto = nextDate;
					nextMetodo = seg.metodoContacto;
				}
			}

			await db.update(casosCobros)
				.set({
					proximoContacto: nextContacto,
					metodoContactoProximo: nextMetodo as typeof casosCobros.$inferInsert["metodoContactoProximo"],
					updatedAt: new Date(),
				})
				.where(eq(casosCobros.id, seguimiento.casoCobroId));

			return result[0];
		}),
};
