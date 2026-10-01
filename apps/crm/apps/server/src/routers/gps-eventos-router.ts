/**
 * CB-119 · Historial de eventos GPS (desconexión de energía, ignición, GPS
 * sin reportar) y ubicaciones clave (D-15) para la Ficha 360.
 *
 * Módulo aparte de wialon.ts y gps-integracion.ts: mismo motivo de siempre
 * (D-03 en docs/features/cobros-02/09-integracion-gps-wialon.md) — evitar
 * que TS7056 trunque el tipo inferido hacia apps/web al agregar procedures
 * a un router ya grande.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros } from "../db/schema/cobros";
import { gpsConsultaLogs } from "../db/schema/gps-consulta-logs";
import { gpsEventos, gpsUbicacionesClave } from "../db/schema/gps-eventos";
import { vehicles } from "../db/schema/vehicles";
import { calcularUbicacionesUnidadBajoDemanda } from "../jobs/gps-ubicaciones-clave";
import { assertCreditoAsignadoEnCarteraPorSifco } from "../lib/credito-cartera-ownership";
import { cobrosProcedure } from "../lib/orpc";
import { agruparConsultasGps } from "../services/wialon/gps-consultas-agrupar";
import {
	calcularUbicacionesClaveCasoInputSchema,
	calcularUbicacionesClaveCasoOutputSchema,
	gpsConsultasCasoInputSchema,
	gpsConsultasCasoOutputSchema,
	gpsEventosCasoInputSchema,
	gpsEventosCasoOutputSchema,
	gpsVehiculoOutputSchema,
	ubicacionesClaveCasoInputSchema,
	ubicacionesClaveCasoOutputSchema,
	ubicacionesClaveSnapshotSchema,
	ubicacionesConsultasCasoOutputSchema,
} from "../services/wialon/wialon-types";
import { assertAccesoCasoCobro } from "./cobros";
import { resolverCasoParaGps } from "./wialon";

/**
 * El snapshot viaja como JSON: las fechas de la telemetría llegan como texto
 * ISO y el schema de salida espera `Date`. Un snapshot que no cumple el schema
 * (formato viejo, dato corrupto) se descarta en lugar de tumbar el historial.
 */
function leerSnapshotGps(valor: unknown) {
	if (!valor || typeof valor !== "object") return null;
	const crudo = valor as Record<string, unknown>;
	const tel = crudo.telemetria;
	const aFecha = (v: unknown) =>
		typeof v === "string" || typeof v === "number" ? new Date(v) : null;
	const candidato =
		tel && typeof tel === "object"
			? {
					...crudo,
					telemetria: {
						...(tel as Record<string, unknown>),
						ultimaSenalAt: aFecha(
							(tel as Record<string, unknown>).ultimaSenalAt,
						),
						ultimaPosicionAt: aFecha(
							(tel as Record<string, unknown>).ultimaPosicionAt,
						),
					},
				}
			: crudo;
	const parsed = gpsVehiculoOutputSchema.safeParse(candidato);
	return parsed.success ? parsed.data : null;
}

/** Mismo criterio que `leerSnapshotGps`: un snapshot inválido se descarta. */
function leerSnapshotUbicaciones(valor: unknown) {
	const parsed = ubicacionesClaveSnapshotSchema.safeParse(valor);
	return parsed.success ? parsed.data : null;
}

export const gpsEventosRouter = {
	/**
	 * Historial de eventos GPS de un caso, para la Ficha 360.
	 *
	 * La fuente autoritativa de "de quién es este crédito" es CARTERA, no el
	 * caso local (mismo hallazgo de Codex corregido en `routers/wialon.ts`).
	 * `assertAccesoCasoCobro` ya la consulta; la lectura SIN cache de
	 * `assertCreditoAsignadoEnCarteraPorSifco` la repite antes de devolver
	 * lat/lon histórica.
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
	 * Historial de consultas GPS del vehículo (quién, cuándo, con qué motivo).
	 *
	 * Mismo gate de acceso que `getGpsVehiculo` (`resolverCasoParaGps`: acceso
	 * al caso, vehículo del caso y cartera), pero NO registra auditoría ni pide
	 * motivo: leer el historial no consulta Wialon.
	 *
	 * OJO: cada consulta de telemetría trae su `snapshot`, que incluye
	 * coordenadas y velocidad. Quien abre el historial ve esa ubicación sin dar
	 * un motivo nuevo ni dejar rastro de la vista. Es deliberado (ver la consulta
	 * anterior sin repetirla), pero si producto exige auditar esa vista, el
	 * control va aquí.
	 *
	 * Las consultas de telemetría con la misma ubicación se devuelven agrupadas
	 * en una entrada (ver `agruparConsultasGps`); la auditoría no se modifica.
	 *
	 * Se acota al vehículo Y al crédito del caso: un vehículo puede pasar a otro
	 * crédito y su historial no debe verse desde el nuevo.
	 */
	getGpsConsultasCaso: cobrosProcedure
		.input(gpsConsultasCasoInputSchema)
		.output(gpsConsultasCasoOutputSchema)
		.handler(async ({ input, context }) => {
			const { numeroCreditoSifco } = await resolverCasoParaGps(
				input.casoCobroId,
				input.vehicleId,
				context.userId,
				context.userRole,
				context.user?.email || context.session?.user?.email,
			);

			const filas = await db
				.select({
					id: gpsConsultaLogs.id,
					motivo: gpsConsultaLogs.motivo,
					origen: gpsConsultaLogs.origen,
					unitName: gpsConsultaLogs.unitName,
					userNombre: user.name,
					createdAt: gpsConsultaLogs.createdAt,
					snapshot: gpsConsultaLogs.snapshot,
				})
				.from(gpsConsultaLogs)
				.leftJoin(user, eq(gpsConsultaLogs.userId, user.id))
				.where(
					and(
						eq(gpsConsultaLogs.vehicleId, input.vehicleId),
						numeroCreditoSifco == null
							? isNull(gpsConsultaLogs.numeroCreditoSifco)
							: eq(gpsConsultaLogs.numeroCreditoSifco, numeroCreditoSifco),
					),
				)
				.orderBy(desc(gpsConsultaLogs.createdAt))
				.limit(input.limit);

			return agruparConsultasGps(
				filas.map((f) => ({ ...f, userNombre: f.userNombre ?? null })),
			).map((e) => ({ ...e, snapshot: leerSnapshotGps(e.snapshot) }));
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

			let consultaLogId: string;
			try {
				const [fila] = await db
					.insert(gpsConsultaLogs)
					.values({
						vehicleId: input.vehicleId,
						numeroCreditoSifco,
						motivo: input.motivo,
						unitId: null,
						unitName: null,
						origen: "ubicaciones_clave",
						userId,
					})
					.returning({ id: gpsConsultaLogs.id });
				consultaLogId = fila.id;
			} catch (error) {
				console.error("GPS_CONSULTA_LOG_FALLIDO", {
					vehicleId: input.vehicleId,
					origen: "getUbicacionesClaveCaso",
					message: error instanceof Error ? error.message : String(error),
				});
				return { auditada: false, ubicaciones: [] };
			}

			// Las ubicaciones clave aplican a cualquier bucket. Sin SIFCO no hay
			// crédito al que atar las filas calculadas: fail closed.
			if (!numeroCreditoSifco) {
				return { auditada: true, ubicaciones: [] };
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

			// Se guarda lo que se muestra para poder verlo después desde el
			// historial sin repetir la consulta. Best-effort: la auditoría ya
			// quedó registrada, y sin snapshot el historial solo muestra el motivo.
			await db
				.update(gpsConsultaLogs)
				.set({ snapshot: { ubicaciones } })
				.where(eq(gpsConsultaLogs.id, consultaLogId))
				.catch((error) => {
					console.error("GPS_CONSULTA_SNAPSHOT_FALLIDO", {
						vehicleId: input.vehicleId,
						origen: "getUbicacionesClaveCaso",
						message: error instanceof Error ? error.message : String(error),
					});
				});

			return { auditada: true, ubicaciones };
		}),

	/**
	 * Calcula YA las ubicaciones clave de un vehículo (botón "Calcular ahora").
	 * El job nocturno reparte el backfill de 60 días en varias noches cuando hay
	 * muchos vehículos; esto deja que alguien no espere su turno. Mismo gate de
	 * acceso que la consulta (`resolverCasoParaGps`). No devuelve ubicaciones ni
	 * revela nada: solo las calcula y guarda, y verlas sigue pidiendo motivo y
	 * quedando auditado en `getUbicacionesClaveCaso`.
	 */
	calcularUbicacionesClaveCaso: cobrosProcedure
		.input(calcularUbicacionesClaveCasoInputSchema)
		.output(calcularUbicacionesClaveCasoOutputSchema)
		.handler(async ({ input, context }) => {
			const { numeroCreditoSifco } = await resolverCasoParaGps(
				input.casoCobroId,
				input.vehicleId,
				context.userId,
				context.userRole,
				context.user?.email || context.session?.user?.email,
			);

			const [vehiculo] = await db
				.select({ wialonUnitId: vehicles.wialonUnitId })
				.from(vehicles)
				.where(eq(vehicles.id, input.vehicleId))
				.limit(1);
			if (!vehiculo?.wialonUnitId || !numeroCreditoSifco) {
				return { estado: "sin_unidad" as const, ubicaciones: 0 };
			}

			const resultado = await calcularUbicacionesUnidadBajoDemanda(
				vehiculo.wialonUnitId,
				[numeroCreditoSifco],
			);
			return {
				estado: resultado.estado,
				ubicaciones:
					resultado.estado === "calculado" ? resultado.ubicaciones : 0,
			};
		}),

	/**
	 * Historial de consultas de ubicaciones clave de un vehículo: quién, cuándo,
	 * con qué motivo y lo que se mostró (snapshot). Mismo gate de acceso que
	 * `getUbicacionesClaveCaso` (`resolverCasoParaGps`) pero, como
	 * `getGpsConsultasCaso`, ver una consulta anterior no es una consulta nueva:
	 * no pide motivo ni registra auditoría. Es deliberado (ver lo ya consultado
	 * sin repetirlo); si producto exige auditar esta vista, el control va aquí.
	 */
	getUbicacionesConsultasCaso: cobrosProcedure
		.input(gpsConsultasCasoInputSchema)
		.output(ubicacionesConsultasCasoOutputSchema)
		.handler(async ({ input, context }) => {
			const { numeroCreditoSifco } = await resolverCasoParaGps(
				input.casoCobroId,
				input.vehicleId,
				context.userId,
				context.userRole,
				context.user?.email || context.session?.user?.email,
			);

			if (!numeroCreditoSifco) return [];

			const filas = await db
				.select({
					id: gpsConsultaLogs.id,
					motivo: gpsConsultaLogs.motivo,
					userNombre: user.name,
					createdAt: gpsConsultaLogs.createdAt,
					snapshot: gpsConsultaLogs.snapshot,
				})
				.from(gpsConsultaLogs)
				.leftJoin(user, eq(gpsConsultaLogs.userId, user.id))
				.where(
					and(
						eq(gpsConsultaLogs.vehicleId, input.vehicleId),
						eq(gpsConsultaLogs.numeroCreditoSifco, numeroCreditoSifco),
						eq(gpsConsultaLogs.origen, "ubicaciones_clave"),
					),
				)
				.orderBy(desc(gpsConsultaLogs.createdAt))
				.limit(input.limit);

			return filas.map((f) => ({
				id: f.id,
				motivo: f.motivo,
				userNombre: f.userNombre ?? null,
				createdAt: f.createdAt,
				snapshot: leerSnapshotUbicaciones(f.snapshot),
			}));
		}),
};
