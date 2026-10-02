/**
 * CB-119 · Historial de eventos GPS (desconexión de energía, ignición, GPS
 * sin reportar) y ubicaciones clave (D-15) para la Ficha 360.
 *
 * Módulo aparte de wialon.ts y gps-integracion.ts: mismo motivo de siempre
 * (D-03 en docs/features/cobros-02/09-integracion-gps-wialon.md) — evitar
 * que TS7056 trunque el tipo inferido hacia apps/web al agregar procedures
 * a un router ya grande.
 */

import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { creditApplications } from "../db/schema/client-forms";
import { casosCobros } from "../db/schema/cobros";
import { leads } from "../db/schema/crm";
import { gpsConsultaLogs } from "../db/schema/gps-consulta-logs";
import {
	gpsDomicilioDeclarado,
	gpsEventos,
	gpsUbicacionesClave,
} from "../db/schema/gps-eventos";
import { vehicles } from "../db/schema/vehicles";
import { calcularUbicacionesUnidadBajoDemanda } from "../jobs/gps-ubicaciones-clave";
import { assertCreditoAsignadoEnCarteraPorSifco } from "../lib/credito-cartera-ownership";
import { cobrosProcedure } from "../lib/orpc";
import { resolverContextoCaso } from "../services/referencias-cobros-datos";
import {
	confirmaDomicilio,
	distanciaMetros,
	parsearCoordenadas,
} from "../services/wialon/geo";
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

type TipoDomicilio = "casa" | "trabajo";

const UBICACION_A_DOMICILIO: Record<string, TipoDomicilio | undefined> = {
	probable_casa: "casa",
	probable_trabajo: "trabajo",
};

type DireccionesDeclaradas = Record<TipoDomicilio, string | null>;

/**
 * Direcciones que el cliente declaró, las mismas que muestra el Resumen de la
 * ficha, para que lo que el asesor busca en Maps sea lo que ve en pantalla.
 * - casa: la del lead; si no la tiene, la residencia de la última solicitud.
 * - trabajo: la del trabajo de la última solicitud (solo viene de ahí).
 * Resuelve el contexto del caso una sola vez para las dos.
 */
async function direccionesDeclaradasDelCaso(
	casoCobroId: string,
): Promise<DireccionesDeclaradas> {
	const ctx = await resolverContextoCaso(casoCobroId);
	const limpio = (v: string | null | undefined) => v?.trim() || null;

	let casa: string | null = null;
	if (ctx.leadId) {
		const [lead] = await db
			.select({ direccion: leads.direccion })
			.from(leads)
			.where(eq(leads.id, ctx.leadId))
			.limit(1);
		casa = limpio(lead?.direccion);
	}
	if (!ctx.opportunityId) return { casa, trabajo: null };

	const [solicitud] = await db
		.select({
			residencia: creditApplications.direccionResidencia,
			trabajo: creditApplications.direccionTrabajo,
		})
		.from(creditApplications)
		.where(
			and(
				eq(creditApplications.opportunityId, ctx.opportunityId),
				// La del titular; NULL = solicitud anterior a la 0015.
				or(
					eq(creditApplications.personType, "lead"),
					isNull(creditApplications.personType),
				),
			),
		)
		.orderBy(desc(creditApplications.updatedAt))
		.limit(1);
	return {
		casa: casa ?? limpio(solicitud?.residencia),
		trabajo: limpio(solicitud?.trabajo),
	};
}

// ¿El punto que ubicó el asesor sigue valiendo contra la dirección actual del
// cliente? Compara ignorando mayúsculas y espacios de más. Sin dirección actual
// no vale: no hay contra qué verificar, y dos direcciones vacías no son "la
// misma" (si no, un punto pegado sin dirección declarada saldría confirmado).
function direccionVigente(
	guardada: string | null,
	actual: string | null,
): boolean {
	const norm = (v: string | null) =>
		(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
	return norm(actual) !== "" && norm(guardada) === norm(actual);
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

			// Direcciones declaradas ubicadas por el asesor: la probable casa se
			// compara con la residencia y el probable trabajo con el trabajo. Se
			// calcula al leer porque el job nocturno reemplaza las filas.
			const puntos = await db
				.select({
					tipo: gpsDomicilioDeclarado.tipo,
					lat: gpsDomicilioDeclarado.lat,
					lon: gpsDomicilioDeclarado.lon,
					direccionTexto: gpsDomicilioDeclarado.direccionTexto,
				})
				.from(gpsDomicilioDeclarado)
				.where(eq(gpsDomicilioDeclarado.casoCobroId, input.casoCobroId));
			// Solo si hay puntos ubicados: si la dirección del cliente cambió desde
			// entonces, el punto ya no confirma nada.
			const direccionesActuales =
				puntos.length > 0
					? await direccionesDeclaradasDelCaso(input.casoCobroId)
					: null;
			const ubicacionesConDomicilio = ubicaciones.map((u) => {
				const tipoDomicilio = UBICACION_A_DOMICILIO[u.tipo];
				const punto = puntos.find((p) => p.tipo === tipoDomicilio);
				if (!punto || !tipoDomicilio) {
					return {
						...u,
						distanciaDomicilioM: null,
						confirmadaDomicilio: null,
						domicilioDesactualizado: null,
					};
				}
				const distanciaDomicilioM = distanciaMetros(
					u.lat,
					u.lon,
					punto.lat,
					punto.lon,
				);
				const desactualizado = !direccionVigente(
					punto.direccionTexto,
					direccionesActuales?.[tipoDomicilio] ?? null,
				);
				return {
					...u,
					distanciaDomicilioM,
					confirmadaDomicilio:
						!desactualizado && confirmaDomicilio(distanciaDomicilioM, u.radioM),
					domicilioDesactualizado: desactualizado,
				};
			});

			// Se guarda lo que se muestra para poder verlo después desde el
			// historial sin repetir la consulta. Best-effort: la auditoría ya
			// quedó registrada, y sin snapshot el historial solo muestra el motivo.
			await db
				.update(gpsConsultaLogs)
				.set({ snapshot: { ubicaciones: ubicacionesConDomicilio } })
				.where(eq(gpsConsultaLogs.id, consultaLogId))
				.catch((error) => {
					console.error("GPS_CONSULTA_SNAPSHOT_FALLIDO", {
						vehicleId: input.vehicleId,
						origen: "getUbicacionesClaveCaso",
						message: error instanceof Error ? error.message : String(error),
					});
				});

			return { auditada: true, ubicaciones: ubicacionesConDomicilio };
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

	/**
	 * Direcciones declaradas del cliente (residencia y trabajo, tal como las
	 * muestra la ficha) y, si el asesor ya las ubicó en el mapa, sus
	 * coordenadas. No audita: no expone la posición del vehículo, solo datos del
	 * cliente que la ficha ya muestra.
	 */
	getDomicilioDeclaradoCaso: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const [direcciones, filas] = await Promise.all([
				direccionesDeclaradasDelCaso(input.casoCobroId),
				db
					.select({
						tipo: gpsDomicilioDeclarado.tipo,
						lat: gpsDomicilioDeclarado.lat,
						lon: gpsDomicilioDeclarado.lon,
						direccionTexto: gpsDomicilioDeclarado.direccionTexto,
						registradoAt: gpsDomicilioDeclarado.registradoAt,
						registradoPorNombre: user.name,
					})
					.from(gpsDomicilioDeclarado)
					.leftJoin(user, eq(user.id, gpsDomicilioDeclarado.registradoPor))
					.where(eq(gpsDomicilioDeclarado.casoCobroId, input.casoCobroId)),
			]);
			const ubicado = (tipo: TipoDomicilio) => {
				const fila = filas.find((f) => f.tipo === tipo);
				return fila
					? {
							lat: fila.lat,
							lon: fila.lon,
							registradoAt: fila.registradoAt,
							registradoPorNombre: fila.registradoPorNombre ?? null,
							// La dirección del cliente cambió (o ya no hay) desde que se
							// ubicó el punto.
							desactualizado: !direccionVigente(
								fila.direccionTexto,
								direcciones[tipo],
							),
						}
					: null;
			};
			return {
				casa: { direccion: direcciones.casa, ubicado: ubicado("casa") },
				trabajo: {
					direccion: direcciones.trabajo,
					ubicado: ubicado("trabajo"),
				},
			};
		}),

	/**
	 * Guarda las coordenadas de la dirección declarada (casa o trabajo). Acepta
	 * lo que el asesor pega desde Google Maps ("lat, lon" o un link).
	 */
	setDomicilioDeclaradoCaso: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				tipo: z.enum(["casa", "trabajo"]),
				entrada: z.string().trim().min(3).max(2000),
			}),
		)
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const coords = parsearCoordenadas(input.entrada);
			if (!coords) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"No se encontraron coordenadas. Pegue «latitud, longitud» o el link de Google Maps.",
				});
			}
			const userId = context.userId ?? context.user?.id ?? null;
			const direccionTexto = (
				await direccionesDeclaradasDelCaso(input.casoCobroId)
			)[input.tipo];
			// Sin dirección declarada no hay contra qué verificar el punto: se
			// rechaza en vez de guardar uno que luego saldría "Confirmado".
			if (!direccionTexto) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						input.tipo === "casa"
							? "El cliente no tiene dirección de residencia registrada: no hay contra qué verificar este punto."
							: "El cliente no tiene dirección de trabajo registrada: no hay contra qué verificar este punto.",
				});
			}
			await db
				.insert(gpsDomicilioDeclarado)
				.values({
					casoCobroId: input.casoCobroId,
					tipo: input.tipo,
					lat: coords.lat,
					lon: coords.lon,
					direccionTexto,
					registradoPor: userId,
				})
				.onConflictDoUpdate({
					target: [
						gpsDomicilioDeclarado.casoCobroId,
						gpsDomicilioDeclarado.tipo,
					],
					set: {
						lat: coords.lat,
						lon: coords.lon,
						direccionTexto,
						registradoPor: userId,
						registradoAt: new Date(),
						updatedAt: new Date(),
					},
				});
			return coords;
		}),

	borrarDomicilioDeclaradoCaso: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				tipo: z.enum(["casa", "trabajo"]),
			}),
		)
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			await db
				.delete(gpsDomicilioDeclarado)
				.where(
					and(
						eq(gpsDomicilioDeclarado.casoCobroId, input.casoCobroId),
						eq(gpsDomicilioDeclarado.tipo, input.tipo),
					),
				);
			return { ok: true };
		}),
};
