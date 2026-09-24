import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { gpsIntegracionAlertas, gpsIntegracionLogs } from "../../db/schema";
import { resolverUsuarioSistemaCobros } from "../cobros-notif-helpers";
import { insertarNotificacionAdminGps } from "./gps-alertas-notificaciones";
import {
	esIntentoExitoso,
	sanitizarPayloadWialon,
} from "./wialon-clasificacion";
import type { WialonFallaSeveridad, WialonIntentoEvento } from "./wialon-types";

/**
 * Escribe cada evento de intento en gps_integracion_logs y evalúa si abre o
 * refuerza una alerta (CB-121). Nunca lanza: un fallo acá nunca debe romper
 * la operación real contra Wialon, a diferencia de gps_consulta_logs (CB-118),
 * que sí es fail-closed a propósito porque audita intención de negocio.
 *
 * No usa cola/batch en memoria: los eventos de Wialon son de bajo volumen
 * comparado con el resto del CRM (decenas por minuto, no miles), así que un
 * insert por evento es simple y suficientemente rápido; evita la complejidad
 * de un flush a destiempo perdiendo eventos si el proceso se reinicia.
 */
export async function registrarIntentoWialon(
	evento: WialonIntentoEvento,
): Promise<void> {
	try {
		await db.insert(gpsIntegracionLogs).values({
			correlationId: evento.contexto.correlationId,
			intento: evento.intento,
			operacion: evento.operacion,
			origen: evento.contexto.origen,
			resultado: evento.resultado,
			errorCode: evento.errorCode,
			wialonErrorCode: evento.wialonErrorCode,
			httpStatus: evento.httpStatus,
			severidad: evento.severidad,
			duracionMs: evento.duracionMs,
			requestResumen: evento.requestResumen
				? sanitizarPayloadWialon(evento.requestResumen)
				: null,
			responseResumen: evento.responseResumen
				? sanitizarPayloadWialon(evento.responseResumen)
				: null,
			userId: evento.contexto.userId ?? null,
			vehicleId: evento.contexto.vehicleId ?? null,
			numeroCreditoSifco: evento.contexto.numeroCreditoSifco ?? null,
			gpsConsultaLogId: evento.contexto.gpsConsultaLogId ?? null,
		});
	} catch (error) {
		console.error("GPS_INTEGRACION_LOG_FALLIDO", {
			operacion: evento.operacion,
			message: error instanceof Error ? error.message : String(error),
		});
	}

	if (evento.severidad === "critical") {
		await abrirOReforzarAlerta({
			tipo: "error_critico",
			errorCode: evento.errorCode ?? "DESCONOCIDO",
			detalle: `${evento.operacion}: código ${evento.errorCode ?? "desconocido"}${
				evento.wialonErrorCode ? ` (Wialon ${evento.wialonErrorCode})` : ""
			}`,
		});
	}

	if (!esIntentoExitoso({ ...evento, errorCode: evento.errorCode ?? null })) {
		await evaluarFallosConsecutivos(evento);
	}
}

/**
 * Fallos consecutivos: mira los últimos N intentos de CUALQUIER operación
 * (no solo la actual) para detectar que la integración entera dejó de
 * responder, no solo un endpoint puntual.
 */
const VENTANA_FALLOS_CONSECUTIVOS = 5;

async function evaluarFallosConsecutivos(
	evento: WialonIntentoEvento,
): Promise<void> {
	try {
		const ultimos = await db
			.select({
				resultado: gpsIntegracionLogs.resultado,
				errorCode: gpsIntegracionLogs.errorCode,
			})
			.from(gpsIntegracionLogs)
			.orderBy(sql`${gpsIntegracionLogs.createdAt} desc`)
			.limit(VENTANA_FALLOS_CONSECUTIVOS);

		// Cuenta también los intentos fallidos que quedaron como "reintentado":
		// en una caída con timeouts, 2 de cada 3 filas son de ese tipo.
		const todosFallaron =
			ultimos.length === VENTANA_FALLOS_CONSECUTIVOS &&
			ultimos.every((f) => !esIntentoExitoso(f));

		if (todosFallaron) {
			await abrirOReforzarAlerta({
				tipo: "fallos_consecutivos",
				errorCode: null,
				detalle: `${VENTANA_FALLOS_CONSECUTIVOS} intentos consecutivos fallidos contra Wialon. Último: ${evento.operacion} (${evento.errorCode ?? "sin código"}).`,
			});
		}
	} catch (error) {
		console.error("GPS_INTEGRACION_FALLOS_CONSECUTIVOS_NO_EVALUADO", {
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Abre una alerta nueva o refuerza (ocurrencias++, ultima_vez) la que ya
 * estaba abierta para este tipo+errorCode. Solo notifica a admin la PRIMERA
 * vez que se abre: el índice único parcial de gps_integracion_alertas
 * (estado = 'abierta') es la dedup, no una tabla de notificaciones aparte.
 */
export async function abrirOReforzarAlerta(params: {
	tipo: "error_critico" | "tasa_error" | "fallos_consecutivos" | "latencia_sla";
	errorCode: string | null;
	detalle: string;
	severidadNotificacion?: WialonFallaSeveridad;
}): Promise<void> {
	try {
		const actualizada = await db
			.update(gpsIntegracionAlertas)
			.set({
				ultimaVez: new Date(),
				ocurrencias: sql`${gpsIntegracionAlertas.ocurrencias} + 1`,
				detalle: params.detalle,
			})
			.where(
				and(
					eq(gpsIntegracionAlertas.tipo, params.tipo),
					params.errorCode
						? eq(gpsIntegracionAlertas.errorCode, params.errorCode)
						: isNull(gpsIntegracionAlertas.errorCode),
					eq(gpsIntegracionAlertas.estado, "abierta"),
				),
			)
			.returning({ id: gpsIntegracionAlertas.id });

		if (actualizada.length > 0) {
			// Ya estaba abierta: se reforzó, no se notifica de nuevo.
			return;
		}

		// Si otro evento simultáneo ya la abrió, el índice único parcial choca:
		// no se inserta ni se notifica de nuevo.
		const insertada = await db
			.insert(gpsIntegracionAlertas)
			.values({
				tipo: params.tipo,
				errorCode: params.errorCode,
				detalle: params.detalle,
			})
			.onConflictDoNothing()
			.returning({ id: gpsIntegracionAlertas.id });
		if (insertada.length === 0) return;

		const usuarioSistema = await resolverUsuarioSistemaCobros();
		if (usuarioSistema) {
			await insertarNotificacionAdminGps({
				createdBy: usuarioSistema,
				titulo: "Falla en la integración GPS (Wialon)",
				descripcion: params.detalle,
			});
		}
	} catch (error) {
		console.error("GPS_INTEGRACION_ALERTA_NO_REGISTRADA", {
			tipo: params.tipo,
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

/** Solo para tests de umbral en jobs/gps-integracion-salud.ts. */
export const _INTERNOS = {
	VENTANA_FALLOS_CONSECUTIVOS,
	gte,
};
