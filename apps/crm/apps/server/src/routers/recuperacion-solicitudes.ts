/**
 * CB-043 · Solicitudes de recuperación de vehículo.
 *
 *  · `getChecklistRecuperacion`       — el checklist del caso, con la evidencia
 *    que el CRM encontró, para llenar la solicitud.
 *  · `getSolicitudesRecuperacion`     — la bandeja del supervisor: las que
 *    esperan aprobación y las ya decididas.
 *  · `decidirSolicitudRecuperacion`   — aprobar (traslada a B4) o rechazar.
 *  · `cancelarSolicitudRecuperacion`  — quien la pidió la retira.
 *
 * La solicitud se CREA desde `enviarCreditoARecuperacion` (routers/cobros.ts),
 * el mismo punto de entrada de siempre: así ningún camino a B4 se saltea la
 * aprobación.
 *
 * Archivo aparte por TS7056, como los demás routers de la ficha; se monta como
 * router propio en index.ts y en el MergedRouter de la web.
 */

import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { carteraBackReferences } from "../db/schema/cartera-back";
import {
	casosCobros,
	contratosFinanciamiento,
	recuperacionesVehiculo,
} from "../db/schema/cobros";
import { clients } from "../db/schema/crm";
import { assertCreditoAsignadoEnCarteraPorSifco } from "../lib/credito-cartera-ownership";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import { leerCatalogoJustificaciones } from "../services/recuperacion-justificaciones";
import {
	definicionPaso,
	leerChecklistGuardado,
	MIN_MOTIVO_RECHAZO,
	motivoSolicitudSinEfecto,
} from "../lib/recuperacion-solicitud";
import { carteraBackClient } from "../services/cartera-back-client";
import { checklistDelCaso } from "../services/recuperacion-checklist";
import {
	aprobarSolicitudRecuperacion,
	cancelarSolicitudRecuperacion,
	leerSolicitud,
	marcarSolicitudSinEfecto,
	rechazarSolicitudRecuperacion,
} from "../services/recuperacion-solicitud";
import {
	assertAccesoCasoCobro,
	marcarInmovilizacionEnviadaARecuperacion,
} from "./cobros";

/** SIFCO y `credito_id` de cartera del caso; lanza si el caso no tiene crédito. */
async function creditoDelCaso(
	casoCobroId: string,
): Promise<{ numeroSifco: string; creditoId: number }> {
	const [fila] = await db
		.select({
			numeroSifco: casosCobros.numeroCreditoSifco,
			creditoId: carteraBackReferences.carteraCreditoId,
		})
		.from(casosCobros)
		.leftJoin(
			carteraBackReferences,
			eq(
				carteraBackReferences.numeroCreditoSifco,
				casosCobros.numeroCreditoSifco,
			),
		)
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	if (!fila?.numeroSifco) {
		throw new ORPCError("BAD_REQUEST", {
			message: "El caso no tiene crédito de cartera asociado.",
		});
	}
	if (!fila.creditoId) {
		throw new ORPCError("NOT_FOUND", {
			message:
				"No se encontró el crédito en cartera para este caso. Abra la ficha del crédito e intente de nuevo.",
		});
	}
	return { numeroSifco: fila.numeroSifco, creditoId: fila.creditoId };
}

const solicitante = alias(user, "solicitante");
const decisor = alias(user, "decisor");

/** Lo que la bandeja muestra de cada solicitud: el pedido completo, sin ir a la ficha. */
function consultaBandeja() {
	return db
		.select({
			id: recuperacionesVehiculo.id,
			casoCobroId: recuperacionesVehiculo.casoCobroId,
			numeroSifco: casosCobros.numeroCreditoSifco,
			cliente: clients.contactPerson,
			estadoSolicitud: recuperacionesVehiculo.estadoSolicitud,
			bucketOrigen: recuperacionesVehiculo.bucketOrigen,
			bucketDestino: recuperacionesVehiculo.bucketDestino,
			motivos: recuperacionesVehiculo.motivos,
			motivoDetalle: recuperacionesVehiculo.motivoDetalle,
			observaciones: recuperacionesVehiculo.observaciones,
			checklist: recuperacionesVehiculo.checklist,
			ubicacionDireccion: recuperacionesVehiculo.ubicacionDireccion,
			ubicacionEnlace: recuperacionesVehiculo.ubicacionEnlace,
			ubicacionLat: recuperacionesVehiculo.ubicacionLat,
			ubicacionLng: recuperacionesVehiculo.ubicacionLng,
			estadoVehiculo: recuperacionesVehiculo.estadoVehiculo,
			saldoPendiente: recuperacionesVehiculo.saldoPendiente,
			cuotasVencidas: recuperacionesVehiculo.cuotasVencidas,
			montoVencido: recuperacionesVehiculo.montoVencido,
			montoMora: recuperacionesVehiculo.montoMora,
			totalParaPonerseAlDia: recuperacionesVehiculo.totalParaPonerseAlDia,
			solicitante: solicitante.name,
			solicitanteId: recuperacionesVehiculo.registradoPor,
			solicitadoAt: recuperacionesVehiculo.createdAt,
			decidioPor: decisor.name,
			decididoAt: recuperacionesVehiculo.decididoAt,
			motivoDecision: recuperacionesVehiculo.motivoDecision,
		})
		.from(recuperacionesVehiculo)
		.innerJoin(
			casosCobros,
			eq(recuperacionesVehiculo.casoCobroId, casosCobros.id),
		)
		.leftJoin(
			contratosFinanciamiento,
			eq(casosCobros.contratoId, contratosFinanciamiento.id),
		)
		.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
		.leftJoin(
			solicitante,
			eq(recuperacionesVehiculo.registradoPor, solicitante.id),
		)
		.leftJoin(decisor, eq(recuperacionesVehiculo.decididoPor, decisor.id));
}

type FilaBandeja = Awaited<ReturnType<typeof consultaBandeja>>[number];

/** La fila para la web: checklist leído y si la pidió quien mira (no la puede decidir). */
const paraLaBandeja =
	(userId: string) =>
	({ solicitanteId, ...f }: FilaBandeja) => ({
		...f,
		checklist: leerChecklistGuardado(f.checklist) ?? [],
		esMia: solicitanteId === userId,
	});

/** Cuántas decididas trae el historial de la bandeja. */
const LIMITE_HISTORIAL = 100;

export const recuperacionSolicitudesRouter = {
	getChecklistRecuperacion: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const { numeroSifco, creditoId } = await creditoDelCaso(
				input.casoCobroId,
			);
			await assertCreditoAsignadoEnCarteraPorSifco({
				numeroSifco,
				emailUsuario: context.session.user.email,
				userRole: context.userRole,
				accion: "solicitar su recuperación",
			});
			const [{ desde, pasos }, catalogo] = await Promise.all([
				checklistDelCaso({ casoCobroId: input.casoCobroId, creditoId }),
				leerCatalogoJustificaciones(),
			]);
			return {
				desde,
				pasos: pasos.map((p) => {
					const opciones = catalogo[p.paso] ?? [];
					return {
						...p,
						titulo: definicionPaso(p.paso)?.titulo ?? p.paso,
						ayuda: definicionPaso(p.paso)?.ayuda ?? "",
						pregunta: definicionPaso(p.paso)?.pregunta ?? "",
						opciones,
						// La sugerencia solo sirve si el catálogo todavía la tiene.
						sugerencia: opciones.some((o) => o.clave === p.sugerencia)
							? p.sugerencia
							: null,
					};
				}),
			};
		}),

	getSolicitudesRecuperacion: cobrosSupervisorProcedure.handler(
		async ({ context }) => {
			const [pendientes, historial] = await Promise.all([
				consultaBandeja()
					.where(eq(recuperacionesVehiculo.estadoSolicitud, "pendiente"))
					// Las más viejas primero: son las que más esperan.
					.orderBy(asc(recuperacionesVehiculo.createdAt)),
				consultaBandeja()
					.where(
						and(
							isNotNull(recuperacionesVehiculo.estadoSolicitud),
							inArray(recuperacionesVehiculo.estadoSolicitud, [
								"aprobada",
								"rechazada",
								"cancelada",
								"sin_efecto",
							]),
						),
					)
					.orderBy(
						desc(recuperacionesVehiculo.decididoAt),
						desc(recuperacionesVehiculo.createdAt),
					)
					.limit(LIMITE_HISTORIAL),
			]);
			const fila = paraLaBandeja(context.userId);
			return {
				pendientes: pendientes.map(fila),
				historial: historial.map(fila),
			};
		},
	),

	decidirSolicitudRecuperacion: cobrosSupervisorProcedure
		.input(
			z
				.object({
					recuperacionId: z.string().uuid(),
					decision: z.enum(["aprobar", "rechazar"]),
					motivo: z.string().trim().max(1000).optional(),
				})
				.superRefine((v, ctx) => {
					if (
						v.decision === "rechazar" &&
						(v.motivo?.length ?? 0) < MIN_MOTIVO_RECHAZO
					) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							message: `El rechazo necesita un motivo (mínimo ${MIN_MOTIVO_RECHAZO} caracteres): es lo que va a leer el asesor.`,
						});
					}
				}),
		)
		.handler(async ({ input, context }) => {
			const solicitud = await leerSolicitud(input.recuperacionId);
			if (!solicitud) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró la solicitud de recuperación.",
				});
			}
			if (solicitud.estadoSolicitud !== "pendiente") {
				throw new ORPCError("CONFLICT", {
					message:
						"Esta solicitud ya no está esperando aprobación: ya se decidió o se canceló. Actualice la vista.",
				});
			}
			// Cuatro ojos: la decide OTRA persona, así al menos un supervisor o
			// admin más se entera antes de que el crédito se mueva (decisión del
			// 2026-09-30). Quien la pidió, si ya no aplica, la cancela.
			if (solicitud.registradoPor === context.userId) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"No puede aprobar ni rechazar su propia solicitud: debe decidirla otro supervisor o administrador. Si ya no aplica, cancélela.",
				});
			}

			if (input.decision === "rechazar") {
				await rechazarSolicitudRecuperacion({
					solicitud,
					supervisorId: context.userId,
					motivo: input.motivo as string,
				});
				return { decision: "rechazada" as const };
			}

			const { numeroSifco, creditoId } = await creditoDelCaso(
				solicitud.casoCobroId,
			);
			// El bucket de HOY, sin cache y fallando cerrado. Si el crédito ya no
			// está en B2–B3 (pagó y bajó, llegó solo a B4, entró en convenio), la
			// solicitud no se aprueba: queda sin efecto y se avisa.
			let bucketActual: Awaited<
				ReturnType<typeof carteraBackClient.getBucketActualCredito>
			>;
			try {
				bucketActual =
					await carteraBackClient.getBucketActualCredito(numeroSifco);
			} catch (error) {
				console.error(
					`[recuperacion-solicitud] No se pudo leer el bucket de ${numeroSifco}:`,
					error,
				);
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message:
						"No se pudo confirmar el bucket del crédito. Intente de nuevo en un momento.",
				});
			}
			const sinEfecto = motivoSolicitudSinEfecto(
				bucketActual?.bucket ?? null,
				bucketActual?.prefijo,
			);
			if (sinEfecto) {
				await marcarSolicitudSinEfecto({
					solicitud,
					motivo: sinEfecto,
					actorId: context.userId,
				});
				throw new ORPCError("CONFLICT", { message: sinEfecto });
			}

			const traslado = await aprobarSolicitudRecuperacion({
				solicitud,
				numeroSifco,
				creditoId,
				supervisorId: context.userId,
				supervisorEmail: context.session.user.email,
			});
			// El cierre "no pagó" de un apagado (CB-041) queda como enviado a
			// recuperación, igual que con el envío directo.
			await marcarInmovilizacionEnviadaARecuperacion({
				casoCobroId: solicitud.casoCobroId,
				usuarioId: context.userId,
				motivo: `Recuperación aprobada por ${context.session.user.email}`,
			});
			return {
				decision: "aprobada" as const,
				bucketNuevo: traslado.bucket_nuevo,
				asesorSinCambio: traslado.asesor_sin_cambio,
			};
		}),

	cancelarSolicitudRecuperacion: cobrosProcedure
		.input(z.object({ recuperacionId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await cancelarSolicitudRecuperacion({
				registroId: input.recuperacionId,
				usuarioId: context.userId,
			});
			return { ok: true };
		}),
};
