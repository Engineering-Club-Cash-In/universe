/**
 * Job de salud de la integración GPS/Wialon (CB-121).
 *
 * Dos responsabilidades, cada 5 minutos:
 *  1. Evaluar umbrales sobre una ventana reciente de gps_integracion_logs
 *     (tasa de error, latencia p95) y abrir/reforzar/resolver alertas.
 *  2. Purgar bitácora técnica vieja (retención: 90 días). Es una obligación
 *     de retención de un log de alto volumen, no una limpieza de orden —
 *     mismo criterio que bot-cobros-purga.ts.
 *
 * Las alertas de tipo "error_critico" NO se auto-resuelven acá: requieren que
 * un admin las cierre a mano desde /admin/gps (resolverGpsAlerta), porque su
 * causa típica (token mal configurado, credenciales, acceso denegado) no se
 * arregla sola con que pase el tiempo — que deje de aparecer en los logs
 * recientes no confirma que el problema de fondo se resolvió.
 */

import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { gpsIntegracionAlertas, gpsIntegracionLogs } from "../db/schema";
import { abrirOReforzarAlerta } from "../services/wialon/gps-integracion-log-writer";
import { esIntentoExitoso } from "../services/wialon/wialon-clasificacion";

const VENTANA_SALUD_MS = 15 * 60 * 1000;
const RETENCION_LOGS_MS = 90 * 24 * 60 * 60 * 1000;

// Umbrales del SLA (ver docs/features/cobros-02/09-integracion-gps-wialon.md).
const MIN_MUESTRAS_PARA_TASA_ERROR = 5;
const UMBRAL_TASA_ERROR = 0.2; // 20% de fallos en la ventana
const UMBRAL_LATENCIA_P95_MS = 5000;

export async function evaluarSaludGpsIntegracion(): Promise<void> {
	const desde = new Date(Date.now() - VENTANA_SALUD_MS);

	const filas = await db
		.select({
			resultado: gpsIntegracionLogs.resultado,
			errorCode: gpsIntegracionLogs.errorCode,
			duracionMs: gpsIntegracionLogs.duracionMs,
		})
		.from(gpsIntegracionLogs)
		.where(gte(gpsIntegracionLogs.createdAt, desde));

	if (filas.length >= MIN_MUESTRAS_PARA_TASA_ERROR) {
		const fallos = filas.filter((f) => !esIntentoExitoso(f)).length;
		const tasaError = fallos / filas.length;

		if (tasaError >= UMBRAL_TASA_ERROR) {
			await abrirOReforzarAlerta({
				tipo: "tasa_error",
				errorCode: null,
				detalle: `Tasa de error de ${(tasaError * 100).toFixed(0)}% en los últimos 15 min (${fallos}/${filas.length} intentos).`,
			});
		} else {
			await resolverAlertaDeUmbral("tasa_error");
		}

		const p95 = percentil95(filas.map((f) => f.duracionMs));
		if (p95 !== null && p95 > UMBRAL_LATENCIA_P95_MS) {
			await abrirOReforzarAlerta({
				tipo: "latencia_sla",
				errorCode: null,
				detalle: `Latencia p95 de ${p95}ms en los últimos 15 min (SLA: ${UMBRAL_LATENCIA_P95_MS}ms).`,
			});
		} else if (p95 !== null) {
			await resolverAlertaDeUmbral("latencia_sla");
		}
	}

	// fallos_consecutivos se evalúa en caliente en gps-integracion-log-writer;
	// acá solo se auto-resuelve cuando el intento MÁS RECIENTE fue exitoso.
	// Un ok anterior dentro de la ventana no alcanza: en plena caída cerraría
	// la alerta y la siguiente falla la reabriría notificando otra vez.
	const [ultimo] = await db
		.select({
			resultado: gpsIntegracionLogs.resultado,
			errorCode: gpsIntegracionLogs.errorCode,
		})
		.from(gpsIntegracionLogs)
		.orderBy(desc(gpsIntegracionLogs.createdAt))
		.limit(1);
	if (ultimo && esIntentoExitoso(ultimo)) {
		await resolverAlertaDeUmbral("fallos_consecutivos");
	}
}

function percentil95(valores: number[]): number | null {
	if (valores.length === 0) return null;
	const ordenados = [...valores].sort((a, b) => a - b);
	const idx = Math.min(
		ordenados.length - 1,
		Math.ceil(ordenados.length * 0.95) - 1,
	);
	return ordenados[idx] ?? null;
}

async function resolverAlertaDeUmbral(
	tipo: "tasa_error" | "latencia_sla" | "fallos_consecutivos",
): Promise<void> {
	try {
		await db
			.update(gpsIntegracionAlertas)
			.set({
				estado: "resuelta",
				resueltaAt: new Date(),
				notaResolucion:
					"Auto-resuelta: la métrica volvió a estar dentro del umbral.",
			})
			.where(
				and(
					eq(gpsIntegracionAlertas.tipo, tipo),
					eq(gpsIntegracionAlertas.estado, "abierta"),
					isNull(gpsIntegracionAlertas.errorCode),
				),
			);
	} catch (error) {
		console.error("GPS_INTEGRACION_ALERTA_NO_AUTO_RESUELTA", {
			tipo,
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

export async function purgarGpsIntegracionLogs(): Promise<number> {
	const limite = new Date(Date.now() - RETENCION_LOGS_MS);
	const borradas = await db
		.delete(gpsIntegracionLogs)
		.where(lt(gpsIntegracionLogs.createdAt, limite))
		.returning({ id: gpsIntegracionLogs.id });
	return borradas.length;
}

export async function correrSaludGpsIntegracion(): Promise<void> {
	try {
		await evaluarSaludGpsIntegracion();
	} catch (error) {
		console.error("Error evaluando salud de la integración GPS:", error);
	}
}

export async function correrPurgaGpsIntegracionLogs(): Promise<void> {
	try {
		const borradas = await purgarGpsIntegracionLogs();
		if (borradas > 0) {
			console.log(`[GpsIntegracionSalud] Purgadas ${borradas} filas > 90 días`);
		}
	} catch (error) {
		console.error("Error en la purga de gps_integracion_logs:", error);
	}
}

// Exportado para tests de umbral.
export const _INTERNOS = { percentil95, sql };
