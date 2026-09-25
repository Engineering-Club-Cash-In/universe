/**
 * CB-119 (D-15) — Cálculo nocturno de "ubicaciones clave" (casa, trabajo,
 * lugares recurrentes) para vehículos con caso de cobro activo en B4, a
 * partir del historial de posiciones de Wialon de los últimos 60 días.
 *
 * Reemplaza el enfoque de "salida de geocerca" (D-14, retirado): el alcance
 * real de la historia es identificar dónde suele estar el vehículo para
 * orientar al equipo de recuperación, no detectar un cruce de frontera.
 *
 * Reutiliza `sifcosEnB4` y `unidadesConCasoActivo` de `gps-eventos-poll.ts`
 * (mismo universo B4, mismo fail-closed ante SIFCO ambiguo — D-14) para no
 * duplicar esa lógica.
 *
 * Snapshot, no acumulativo: cada corrida REEMPLAZA las filas de cada
 * (unidad, SIFCO) en `gps_ubicaciones_clave`, sobre la ventana completa de
 * 60 días — no se van sumando corridas viejas.
 */

import { and, eq, or } from "drizzle-orm";
import { db } from "../db";
import { gpsUbicacionesClave } from "../db/schema/gps-eventos";
import { resolverVehiculoYCaso } from "../services/wialon/gps-eventos";
import { calcularUbicacionesClave } from "../services/wialon/ubicaciones-clave";
import { getWialonClient } from "../services/wialon/wialon-client";
import { conContextoGps } from "../services/wialon/wialon-contexto";
import { sifcosEnB4, unidadesConCasoActivo } from "./gps-eventos-poll";

const LOG_PREFIX = "[GpsUbicacionesClave]";

// Ventana de historial a analizar — confirmada en el spike de D-15 contra
// la retención real de la cuenta de Wialon (ver docs/features/cobros-02).
const VENTANA_DIAS = 60;

export async function ejecutarCalculoUbicacionesClave(): Promise<{
	unidadesProcesadas: number;
	unidadesConError: number;
	ubicacionesCalculadas: number;
}> {
	const sifcosB4 = await sifcosEnB4();
	if (sifcosB4 === null) {
		console.warn(
			`${LOG_PREFIX} Se saltó la corrida: no se pudo obtener el universo B4 de cartera-back`,
		);
		return {
			unidadesProcesadas: 0,
			unidadesConError: 0,
			ubicacionesCalculadas: 0,
		};
	}

	const unidades = await unidadesConCasoActivo(sifcosB4);
	if (unidades.length === 0) {
		return {
			unidadesProcesadas: 0,
			unidadesConError: 0,
			ubicacionesCalculadas: 0,
		};
	}

	const ahora = new Date();
	const ventanaDesde = new Date(
		ahora.getTime() - VENTANA_DIAS * 24 * 60 * 60 * 1000,
	);

	let unidadesProcesadas = 0;
	let unidadesConError = 0;
	let ubicacionesCalculadas = 0;

	// Secuencial, no en paralelo: son llamadas pesadas a Wialon (hasta 9
	// tramos de 7 días cada una) para potencialmente decenas de unidades —
	// correrlas en paralelo saturaría la sesión/circuit breaker del cliente
	// compartido. El job corre una vez por noche, la latencia total no es
	// crítica.
	for (const { wialonUnitId, numeroCreditoSifco } of unidades) {
		try {
			const historial = await conContextoGps(
				{ origen: "gps-ubicaciones-clave" },
				() =>
					getWialonClient().getHistorialPosiciones(
						wialonUnitId,
						ventanaDesde,
						ahora,
					),
			);

			if (!historial.completo) {
				unidadesConError++;
				console.warn(
					`${LOG_PREFIX} No se pudo obtener el historial completo de 60 días para la unidad ${wialonUnitId} (SIFCO ${numeroCreditoSifco}): ${historial.tramosCompletados}/${historial.tramosTotal} tramos completados. Se preserva el snapshot previo.`,
				);
				continue;
			}

			const ubicaciones = calcularUbicacionesClave(historial.mensajes);

			const { vehicleId, casoCobroId } = await resolverVehiculoYCaso(
				wialonUnitId,
				numeroCreditoSifco,
			);

			// Reemplazo transaccional: se borran las filas viejas de este
			// (unidad, SIFCO) y de este caso (si existe) para no dejar huérfanos
			// si la unidad o el vehículo cambiaron de vínculo, y se insertan las
			// nuevas juntas — un observador nunca ve un estado intermedio "sin
			// ubicaciones" para una unidad que sí las tenía calculadas.
			await db.transaction(async (tx) => {
				const condicionesBorrado = [
					and(
						eq(gpsUbicacionesClave.wialonUnitId, wialonUnitId),
						eq(gpsUbicacionesClave.numeroCreditoSifco, numeroCreditoSifco),
					),
				];
				if (casoCobroId) {
					condicionesBorrado.push(
						eq(gpsUbicacionesClave.casoCobroId, casoCobroId),
					);
				}

				await tx
					.delete(gpsUbicacionesClave)
					.where(
						condicionesBorrado.length > 1
							? or(...condicionesBorrado)
							: condicionesBorrado[0]!,
					);

				if (ubicaciones.length > 0) {
					await tx.insert(gpsUbicacionesClave).values(
						ubicaciones.map((u) => ({
							wialonUnitId,
							numeroCreditoSifco,
							vehicleId,
							casoCobroId,
							lat: u.lat,
							lon: u.lon,
							radioM: u.radioM,
							tipo: u.tipo,
							horasTotales: u.horasTotales,
							diasDistintos: u.diasDistintos,
							visitas: u.visitas,
							patron: u.patron,
							primeraVisita: u.primeraVisita,
							ultimaVisita: u.ultimaVisita,
							ventanaDesde,
							ventanaHasta: ahora,
							calculadoAt: ahora,
						})),
					);
				}
			});

			unidadesProcesadas++;
			ubicacionesCalculadas += ubicaciones.length;
		} catch (error) {
			unidadesConError++;
			console.error(
				`${LOG_PREFIX} Error calculando ubicaciones clave de la unidad ${wialonUnitId} (SIFCO ${numeroCreditoSifco}):`,
				error,
			);
		}
	}

	return { unidadesProcesadas, unidadesConError, ubicacionesCalculadas };
}

// Guarda de ejecución en memoria — mismo criterio que
// gps-eventos-poll.ts::correrDeteccionEventosGps: si una corrida se demora
// más que el intervalo (acá, más de un día), el siguiente disparo no debe
// arrancar en paralelo.
let corridaEnCurso = false;

export async function correrCalculoUbicacionesClave(): Promise<void> {
	if (corridaEnCurso) {
		console.warn(
			`${LOG_PREFIX} Corrida anterior aún en curso, se salta este disparo`,
		);
		return;
	}
	corridaEnCurso = true;
	try {
		const resultado = await ejecutarCalculoUbicacionesClave();
		console.log(
			`${LOG_PREFIX} ${resultado.unidadesProcesadas} unidades procesadas · ${resultado.ubicacionesCalculadas} ubicaciones · ${resultado.unidadesConError} con error`,
		);
	} catch (error) {
		console.error(`${LOG_PREFIX} Error en la corrida:`, error);
	} finally {
		corridaEnCurso = false;
	}
}
