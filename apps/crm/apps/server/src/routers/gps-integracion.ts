/**
 * CB-121 · Bitácora técnica, salud y alertas de la integración GPS/Wialon.
 *
 * Módulo aparte, no en wialon.ts: mismo motivo que pagalo-supervision.ts —
 * wialon.ts (1700+ líneas) ya está en el límite donde TS7056 trunca el tipo
 * inferido hacia apps/web al agregar estos 4 endpoints. Distinta bitácora de
 * gps_consulta_logs (CB-118, en wialon.ts): esta registra qué pasó con CADA
 * llamada HTTP a Wialon (solicitudes, errores, reintentos, tiempos), no quién
 * vio qué ubicación y por qué.
 */

import { ORPCError } from "@orpc/server";
import {
	and,
	asc,
	count,
	desc,
	eq,
	getTableColumns,
	gte,
	ilike,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	gpsIntegracionAlertas,
	gpsIntegracionLogs,
} from "../db/schema/gps-integracion-logs";
import { adminProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import { esIntentoExitoso } from "../services/wialon/wialon-clasificacion";
import { getWialonClient } from "../services/wialon/wialon-client";
import {
	gpsAlertasOutputSchema,
	gpsIntegracionLogsInputSchema,
	gpsIntegracionLogsOutputSchema,
	gpsIntegracionSaludOutputSchema,
	resolverGpsAlertaInputSchema,
} from "../services/wialon/wialon-types";

export const gpsIntegracionRouter = {
	/**
	 * Bitácora TÉCNICA de la integración (CB-121): cada intento HTTP a Wialon,
	 * con su duración, error y si se reintentó. Distinta de getGpsBitacora
	 * (CB-118, en wialon.ts), que audita la intención de negocio (quién vio
	 * qué ubicación y por qué). Solo admin: es diagnóstico de infraestructura.
	 */
	getGpsIntegracionLogs: adminProcedure
		.input(gpsIntegracionLogsInputSchema)
		.output(gpsIntegracionLogsOutputSchema)
		.handler(async ({ input }) => {
			const offset = (input.page - 1) * input.perPage;
			const sifco = input.numeroCreditoSifco?.replace(/[\\%_]/g, "\\$&");
			const condiciones = [
				input.resultado
					? eq(gpsIntegracionLogs.resultado, input.resultado)
					: undefined,
				input.severidad
					? eq(gpsIntegracionLogs.severidad, input.severidad)
					: undefined,
				input.errorCode
					? eq(gpsIntegracionLogs.errorCode, input.errorCode)
					: undefined,
				input.operacion
					? eq(gpsIntegracionLogs.operacion, input.operacion)
					: undefined,
				input.correlationId
					? eq(gpsIntegracionLogs.correlationId, input.correlationId)
					: undefined,
				sifco
					? ilike(gpsIntegracionLogs.numeroCreditoSifco, `%${sifco}%`)
					: undefined,
			].filter((c): c is NonNullable<typeof c> => c !== undefined);
			const filtro = condiciones.length > 0 ? and(...condiciones) : undefined;

			const [filas, totalRows] = await Promise.all([
				db
					.select({
						...getTableColumns(gpsIntegracionLogs),
						userNombre: user.name,
						userEmail: user.email,
					})
					.from(gpsIntegracionLogs)
					.leftJoin(user, eq(gpsIntegracionLogs.userId, user.id))
					.where(filtro)
					.orderBy(desc(gpsIntegracionLogs.createdAt))
					.limit(input.perPage)
					.offset(offset),
				db.select({ total: count() }).from(gpsIntegracionLogs).where(filtro),
			]);

			return {
				total: totalRows[0]?.total ?? 0,
				page: input.page,
				perPage: input.perPage,
				items: filas.map((f) => ({
					...f,
					userNombre: f.userNombre ?? null,
					userEmail: f.userEmail ?? null,
				})),
			};
		}),

	/**
	 * Salud de la integración (CB-121): disponibilidad/latencia de la última
	 * hora contra el SLA (ver docs/features/cobros-02/09-integracion-gps-wialon.md)
	 * y estado del circuit breaker del WialonClient de ESTE proceso — en un
	 * despliegue con varias instancias, cada una tiene su propio circuito.
	 */
	getGpsIntegracionSalud: adminProcedure
		.output(gpsIntegracionSaludOutputSchema)
		.handler(async () => {
			const desde = new Date(Date.now() - 60 * 60 * 1000);
			const hasta = new Date();

			const filas = await db
				.select({
					resultado: gpsIntegracionLogs.resultado,
					errorCode: gpsIntegracionLogs.errorCode,
					duracionMs: gpsIntegracionLogs.duracionMs,
				})
				.from(gpsIntegracionLogs)
				.where(gte(gpsIntegracionLogs.createdAt, desde));

			const fallos = filas.filter((f) => !esIntentoExitoso(f)).length;
			const duraciones = filas.map((f) => f.duracionMs).sort((a, b) => a - b);
			const percentil = (p: number): number | null => {
				if (duraciones.length === 0) return null;
				const idx = Math.min(
					duraciones.length - 1,
					Math.ceil(duraciones.length * p) - 1,
				);
				return duraciones[idx] ?? null;
			};

			const [alertasAbiertasRows, ultimoCriticoRows] = await Promise.all([
				db
					.select({ total: count() })
					.from(gpsIntegracionAlertas)
					.where(eq(gpsIntegracionAlertas.estado, "abierta")),
				db
					.select({
						errorCode: gpsIntegracionLogs.errorCode,
						operacion: gpsIntegracionLogs.operacion,
						createdAt: gpsIntegracionLogs.createdAt,
					})
					.from(gpsIntegracionLogs)
					.where(eq(gpsIntegracionLogs.severidad, "critical"))
					.orderBy(desc(gpsIntegracionLogs.createdAt))
					.limit(1),
			]);

			const circuito = getWialonClient().getEstadoCircuito();

			return {
				ventana: {
					desde,
					hasta,
					totalIntentos: filas.length,
					fallos,
					tasaError: filas.length > 0 ? fallos / filas.length : null,
					p50Ms: percentil(0.5),
					p95Ms: percentil(0.95),
				},
				circuito,
				alertasAbiertas: alertasAbiertasRows[0]?.total ?? 0,
				ultimoErrorCritico: ultimoCriticoRows[0] ?? null,
			};
		}),

	/**
	 * Alertas de falla de la integración (CB-121). Un supervisor de cobros
	 * también las ve (necesita saber si el GPS no es confiable ahora mismo),
	 * pero el `detalle` técnico completo (con códigos de error internos) es
	 * el mismo para ambos roles — no hay hoy un campo separado "para
	 * supervisor" porque el detalle ya es una oración legible, no un payload.
	 */
	getGpsAlertas: cobrosSupervisorProcedure
		.output(gpsAlertasOutputSchema)
		.handler(async () => {
			const items = await db
				.select()
				.from(gpsIntegracionAlertas)
				.orderBy(
					// Orden del enum: abierta < resuelta → asc deja las abiertas arriba.
					asc(gpsIntegracionAlertas.estado),
					desc(gpsIntegracionAlertas.ultimaVez),
				)
				.limit(100);
			return { items };
		}),

	/**
	 * Cierra manualmente una alerta (CB-121). Solo admin: las de tipo
	 * "error_critico" NO se auto-resuelven (ver jobs/gps-integracion-salud.ts),
	 * así que sin esto quedarían abiertas para siempre incluso después de
	 * arreglar el problema real.
	 */
	resolverGpsAlerta: adminProcedure
		.input(resolverGpsAlertaInputSchema)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			const userId = context.user?.id;
			if (!userId) {
				throw new ORPCError("UNAUTHORIZED");
			}
			const actualizada = await db
				.update(gpsIntegracionAlertas)
				.set({
					estado: "resuelta",
					resueltaPor: userId,
					resueltaAt: new Date(),
					notaResolucion: input.nota,
				})
				.where(
					and(
						eq(gpsIntegracionAlertas.id, input.alertaId),
						eq(gpsIntegracionAlertas.estado, "abierta"),
					),
				)
				.returning({ id: gpsIntegracionAlertas.id });

			if (actualizada.length === 0) {
				throw new ORPCError("NOT_FOUND", {
					message: "La alerta no existe o ya estaba resuelta.",
				});
			}
			return { success: true };
		}),
};
