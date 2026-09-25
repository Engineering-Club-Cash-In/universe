/**
 * CB-119 · Historial de eventos GPS (desconexión de energía, ignición, GPS
 * sin reportar) y ubicaciones clave (D-15) para la Ficha 360.
 *
 * Módulo aparte de wialon.ts y gps-integracion.ts: mismo motivo de siempre
 * (D-03 en docs/features/cobros-02/09-integracion-gps-wialon.md) — evitar
 * que TS7056 trunque el tipo inferido hacia apps/web al agregar procedures
 * a un router ya grande.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { casosCobros } from "../db/schema/cobros";
import { gpsConsultaLogs } from "../db/schema/gps-consulta-logs";
import { gpsEventos, gpsUbicacionesClave } from "../db/schema/gps-eventos";
import { assertCreditoAsignadoEnCarteraPorSifco } from "../lib/credito-cartera-ownership";
import { cobrosProcedure } from "../lib/orpc";
import {
	gpsEventosCasoInputSchema,
	gpsEventosCasoOutputSchema,
	ubicacionesClaveCasoInputSchema,
	ubicacionesClaveCasoOutputSchema,
} from "../services/wialon/wialon-types";
import { carteraBackClient } from "../services/cartera-back-client";
import { assertAccesoCasoCobro } from "./cobros";
import { resolverCasoParaGps } from "./wialon";

export const gpsEventosRouter = {
	/**
	 * Historial de eventos GPS de un caso, para la Ficha 360.
	 *
	 * `assertAccesoCasoCobro` NO alcanza como autorización completa:
	 * `getDetallesCreditoCarteraBack` auto-crea un caso con
	 * `responsableCobros = quien consulta` cuando el crédito no tenía uno
	 * activo — un asesor puede fabricarse el acceso abriendo el SIFCO de
	 * otro (mismo hallazgo de Codex ya corregido en `routers/wialon.ts` vía
	 * `assertCreditoAsignadoEnCarteraPorSifco`, la fuente autoritativa es
	 * CARTERA, no el caso local). Acá se aplica el mismo guard antes de
	 * devolver lat/lon histórica.
	 */
	getGpsEventosCaso: cobrosProcedure
		.input(gpsEventosCasoInputSchema)
		.output(gpsEventosCasoOutputSchema)
		.handler(async ({ input, context }) => {
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

			if (caso?.numeroCreditoSifco) {
				await assertCreditoAsignadoEnCarteraPorSifco({
					numeroSifco: caso.numeroCreditoSifco,
					emailUsuario: context.user?.email || context.session?.user?.email,
					userRole: context.userRole,
					accion: "ver el historial de eventos GPS de este vehículo",
				});
			}

			const filas = await db
				.select({
					id: gpsEventos.id,
					tipo: gpsEventos.tipo,
					wialonUnitId: gpsEventos.wialonUnitId,
					ocurridoAt: gpsEventos.ocurridoAt,
					lat: gpsEventos.lat,
					lon: gpsEventos.lon,
					velocidadKmh: gpsEventos.velocidadKmh,
					notificado: gpsEventos.notificado,
				})
				.from(gpsEventos)
				.where(eq(gpsEventos.casoCobroId, input.casoCobroId))
				.orderBy(desc(gpsEventos.ocurridoAt))
				.limit(input.limit);

			return filas;
		}),

	/**
	 * Ubicaciones clave del vehículo (D-15): casa, trabajo, lugares
	 * recurrentes, calculadas por el job nocturno a partir del historial de
	 * Wialon. Revela dónde vive/trabaja el cliente — mismo gate de acceso Y
	 * motivo auditado que `getGpsVehiculo` (CB-118): `resolverCasoParaGps`
	 * cubre acceso al caso + que `vehicleId` sea el del caso +
	 * `assertCreditoAsignadoEnCarteraPorSifco`, y la consulta se registra en
	 * `gps_consulta_logs` ANTES de responder. Fail-closed: si no se pudo
	 * auditar, no se devuelven ubicaciones (mismo criterio que
	 * `AUDITORIA_NO_DISPONIBLE` en `getGpsVehiculo`).
	 */
	getUbicacionesClaveCaso: cobrosProcedure
		.input(ubicacionesClaveCasoInputSchema)
		.output(ubicacionesClaveCasoOutputSchema)
		.handler(async ({ input, context }) => {
			const { numeroCreditoSifco } = await resolverCasoParaGps(
				input.casoCobroId,
				input.vehicleId,
				context.userId,
				context.userRole,
				context.user?.email || context.session?.user?.email,
			);

			const userId = context.userId ?? context.user?.id;
			if (!userId) {
				console.error("GPS_CONSULTA_LOG_SIN_USUARIO", {
					vehicleId: input.vehicleId,
					origen: "getUbicacionesClaveCaso",
				});
				return { auditada: false, ubicaciones: [] };
			}

			try {
				await db.insert(gpsConsultaLogs).values({
					vehicleId: input.vehicleId,
					numeroCreditoSifco,
					motivo: input.motivo,
					unitId: null,
					unitName: null,
					userId,
				});
			} catch (error) {
				console.error("GPS_CONSULTA_LOG_FALLIDO", {
					vehicleId: input.vehicleId,
					origen: "getUbicacionesClaveCaso",
					message: error instanceof Error ? error.message : String(error),
				});
				return { auditada: false, ubicaciones: [] };
			}

			// CB-119 / D-15: Las ubicaciones clave son EXCLUSIVAMENTE para casos
			// en B4 / recuperación. Si el crédito salió de B4 (regularizó o cambió
			// de bucket entre corridas del job nocturno), se purgan las filas
			// huérfanas de este caso y no se exponen ubicaciones.
			if (numeroCreditoSifco) {
				const bucketActual = await carteraBackClient
					.getBucketActualCredito(numeroCreditoSifco)
					.catch(() => null);

				if (bucketActual && bucketActual.bucket !== 4) {
					await db
						.delete(gpsUbicacionesClave)
						.where(eq(gpsUbicacionesClave.casoCobroId, input.casoCobroId))
						.catch(() => {});
					return { auditada: true, ubicaciones: [] };
				}
			}

			const ubicaciones = await db
				.select({
					id: gpsUbicacionesClave.id,
					lat: gpsUbicacionesClave.lat,
					lon: gpsUbicacionesClave.lon,
					radioM: gpsUbicacionesClave.radioM,
					tipo: gpsUbicacionesClave.tipo,
					horasTotales: gpsUbicacionesClave.horasTotales,
					diasDistintos: gpsUbicacionesClave.diasDistintos,
					visitas: gpsUbicacionesClave.visitas,
					patron: gpsUbicacionesClave.patron,
					primeraVisita: gpsUbicacionesClave.primeraVisita,
					ultimaVisita: gpsUbicacionesClave.ultimaVisita,
					calculadoAt: gpsUbicacionesClave.calculadoAt,
				})
				.from(gpsUbicacionesClave)
				.where(
					and(
						eq(gpsUbicacionesClave.casoCobroId, input.casoCobroId),
						eq(gpsUbicacionesClave.vehicleId, input.vehicleId),
					),
				)
				.orderBy(desc(gpsUbicacionesClave.horasTotales));

			return { auditada: true, ubicaciones };
		}),
};
