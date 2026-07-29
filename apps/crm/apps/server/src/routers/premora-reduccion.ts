/**
 * CB-010 — Módulo del Gerente de Cobros: reducción de recordatorios premora.
 *
 * El sistema PROPONE (tracking `elegible = racha >= 4`); el Gerente APLICA
 * manualmente qué pasos del embudo (D-5/D-3/D-1) quitarle a cada crédito. D-0
 * nunca se quita (monitoreo preventivo). El auto-revoke lo maneja el job diario
 * (refresh-premora-elegibilidad.ts), no estos endpoints.
 *
 * Todo gateado a `cobrosSupervisorProcedure` (= admin | cobros_supervisor, el
 * Gerente de Cobros).
 */

import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	premoraPagoTracking,
	premoraReduccionConfig,
} from "../db/schema/premora-reduccion";
import { cobrosSupervisorProcedure } from "../lib/orpc";
import { refreshPremoraElegibilidad } from "../services/refresh-premora-elegibilidad";

// Pasos del embudo que el gerente PUEDE quitar. D-0 (0) queda excluido a
// propósito: es el monitoreo preventivo que nunca se retira.
const PASOS_QUITABLES = [5, 3, 1] as const;
const MAX_PASOS_QUITABLES = 2;

const pasosSchema = z
	.array(z.number().int())
	.min(1, "Debes quitar al menos un recordatorio")
	.max(MAX_PASOS_QUITABLES, `Máximo ${MAX_PASOS_QUITABLES} recordatorios`)
	.transform((arr) => [...new Set(arr)])
	.refine(
		(arr) =>
			arr.every((d) => (PASOS_QUITABLES as readonly number[]).includes(d)),
		{ message: "Solo se pueden quitar D-5, D-3 o D-1 (D-0 nunca se quita)" },
	);

// Datos del crédito cacheados en el tracking (nombre de cartera, cuota mensual,
// próximo pago) — se refrescan con el job diario, no se consulta cartera aquí.
const datosCredito = {
	cliente: premoraPagoTracking.cliente,
	cuotaMensual: premoraPagoTracking.cuotaMensual,
	proximaFechaPago: premoraPagoTracking.proximaFechaPago,
};

export const premoraReduccionRouter = {
	// Elegibles SIN reducción activa: los que el gerente puede configurar.
	getCreditosElegiblesReduccion: cobrosSupervisorProcedure.handler(async () => {
		try {
			const cfgActiva = db
				.select({ sifco: premoraReduccionConfig.numeroCreditoSifco })
				.from(premoraReduccionConfig)
				.where(eq(premoraReduccionConfig.activo, true));

			const creditos = await db
				.select({
					numeroCreditoSifco: premoraPagoTracking.numeroCreditoSifco,
					creditoId: premoraPagoTracking.creditoId,
					racha: premoraPagoTracking.cuotasAlDiaConsecutivas,
					ultimaCuotaEvaluada: premoraPagoTracking.ultimaCuotaEvaluada,
					calculadoAt: premoraPagoTracking.calculadoAt,
					...datosCredito,
				})
				.from(premoraPagoTracking)
				.where(
					and(
						eq(premoraPagoTracking.elegible, true),
						sql`${premoraPagoTracking.numeroCreditoSifco} NOT IN (${cfgActiva})`,
					),
				)
				.orderBy(desc(premoraPagoTracking.cuotasAlDiaConsecutivas));

			return { success: true, creditos };
		} catch (error) {
			console.error("[getCreditosElegiblesReduccion] Error:", error);
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "No se pudieron obtener los créditos elegibles",
			});
		}
	}),

	// Reducciones ACTIVAS (configuradas por el gerente): ver / editar / revocar.
	getReduccionesConfiguradas: cobrosSupervisorProcedure.handler(async () => {
		try {
			const reducciones = await db
				.select({
					numeroCreditoSifco: premoraReduccionConfig.numeroCreditoSifco,
					pasosRemovidos: premoraReduccionConfig.pasosRemovidos,
					configuradoAt: premoraReduccionConfig.configuradoAt,
					configuradoPorNombre: user.name,
					racha: premoraPagoTracking.cuotasAlDiaConsecutivas,
					elegible: premoraPagoTracking.elegible,
					...datosCredito,
				})
				.from(premoraReduccionConfig)
				.leftJoin(user, eq(premoraReduccionConfig.configuradoPor, user.id))
				.leftJoin(
					premoraPagoTracking,
					eq(
						premoraReduccionConfig.numeroCreditoSifco,
						premoraPagoTracking.numeroCreditoSifco,
					),
				)
				.where(eq(premoraReduccionConfig.activo, true))
				.orderBy(desc(premoraReduccionConfig.configuradoAt));

			return { success: true, reducciones };
		} catch (error) {
			console.error("[getReduccionesConfiguradas] Error:", error);
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "No se pudieron obtener las reducciones configuradas",
			});
		}
	}),

	// Historial de reducciones RETIRADAS por el sistema (dejaron de pagar bien).
	getReduccionesAutoRevocadas: cobrosSupervisorProcedure.handler(async () => {
		try {
			const revocadas = await db
				.select({
					numeroCreditoSifco: premoraReduccionConfig.numeroCreditoSifco,
					pasosRemovidos: premoraReduccionConfig.pasosRemovidos,
					revocadoAt: premoraReduccionConfig.revocadoAt,
					racha: premoraPagoTracking.cuotasAlDiaConsecutivas,
					...datosCredito,
				})
				.from(premoraReduccionConfig)
				.leftJoin(
					premoraPagoTracking,
					eq(
						premoraReduccionConfig.numeroCreditoSifco,
						premoraPagoTracking.numeroCreditoSifco,
					),
				)
				.where(
					and(
						eq(premoraReduccionConfig.activo, false),
						eq(premoraReduccionConfig.revocadoMotivo, "auto"),
					),
				)
				.orderBy(desc(premoraReduccionConfig.revocadoAt))
				.limit(100);

			return { success: true, revocadas };
		} catch (error) {
			console.error("[getReduccionesAutoRevocadas] Error:", error);
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "No se pudo obtener el historial",
			});
		}
	}),

	// Configura (o edita) la reducción de UNO O VARIOS créditos con la MISMA
	// config (el gerente selecciona varios elegibles y los configura de un solo).
	// Upsert por crédito. Solo aplica a los que son elegibles AHORA (paga bien);
	// los no elegibles se omiten y se reportan. Un crédito ya configurado se
	// re-configura (edición) con los nuevos pasos.
	configurarReduccion: cobrosSupervisorProcedure
		.input(
			z.object({
				numerosCreditoSifco: z
					.array(z.string().min(1).max(100))
					.min(1, "Selecciona al menos un crédito")
					.max(500, "Máximo 500 créditos por lote")
					.transform((arr) => [...new Set(arr)]),
				pasosRemovidos: pasosSchema,
			}),
		)
		.handler(async ({ input, context }) => {
			// Solo los elegibles del lote (la config solo aplica a quien paga bien).
			const elegibles = await db
				.select({ sifco: premoraPagoTracking.numeroCreditoSifco })
				.from(premoraPagoTracking)
				.where(
					and(
						inArray(
							premoraPagoTracking.numeroCreditoSifco,
							input.numerosCreditoSifco,
						),
						eq(premoraPagoTracking.elegible, true),
					),
				);
			const elegibleSet = new Set(elegibles.map((e) => e.sifco));
			const aAplicar = input.numerosCreditoSifco.filter((s) =>
				elegibleSet.has(s),
			);

			if (aAplicar.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Ninguno de los créditos seleccionados es elegible: solo se puede reducir a clientes que pagan al día (4 cuotas consecutivas).",
				});
			}

			await db
				.insert(premoraReduccionConfig)
				.values(
					aAplicar.map((sifco) => ({
						numeroCreditoSifco: sifco,
						pasosRemovidos: input.pasosRemovidos,
						activo: true,
						origen: "manual",
						configuradoPor: context.userId,
					})),
				)
				.onConflictDoUpdate({
					target: premoraReduccionConfig.numeroCreditoSifco,
					set: {
						pasosRemovidos: input.pasosRemovidos,
						activo: true,
						origen: "manual",
						configuradoPor: context.userId,
						configuradoAt: sql`now()`,
						// Reconfigurar limpia una revocación previa (manual o auto).
						revocadoAt: null,
						revocadoMotivo: null,
						updatedAt: sql`now()`,
					},
				});

			return {
				success: true,
				aplicados: aAplicar.length,
				omitidos: input.numerosCreditoSifco.length - aAplicar.length,
			};
		}),

	// Revoca MANUALMENTE la reducción de un crédito (vuelve al embudo completo).
	revocarReduccion: cobrosSupervisorProcedure
		.input(z.object({ numeroCreditoSifco: z.string().min(1).max(100) }))
		.handler(async ({ input }) => {
			const res = await db
				.update(premoraReduccionConfig)
				.set({
					activo: false,
					revocadoAt: sql`now()`,
					revocadoMotivo: "manual",
					updatedAt: sql`now()`,
				})
				.where(
					and(
						eq(
							premoraReduccionConfig.numeroCreditoSifco,
							input.numeroCreditoSifco,
						),
						eq(premoraReduccionConfig.activo, true),
					),
				)
				.returning({ id: premoraReduccionConfig.id });

			if (res.length === 0) {
				throw new ORPCError("NOT_FOUND", {
					message: "No hay una reducción activa para ese crédito",
				});
			}
			return { success: true };
		}),

	// Recalcula la elegibilidad AHORA (refresca la foto de pago desde cartera +
	// auto-revoke). El job corre solo a diario; esto deja al gerente forzar el
	// refresco cuando quiere ver datos al instante.
	recalcularElegibilidad: cobrosSupervisorProcedure.handler(async () => {
		const resumen = await refreshPremoraElegibilidad();
		return { success: true, resumen };
	}),
};
