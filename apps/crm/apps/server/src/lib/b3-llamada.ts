/**
 * CB-035 — Tarea de llamada al supervisor en los primeros 3 días de ingreso a B3.
 *
 * Lógica PURA de la regla (sin DB ni cartera-back) para poder probarla aislada;
 * la orquestación vive en services/check-b3-llamada.ts.
 *
 * Regla:
 *  - "Ingresar a B3" = evento SUBIDA con `bucket_nuevo = 3` en el historial de
 *    cartera-back. Una BAJADA B4→B3 no cuenta: el crédito viene mejorando, no
 *    entrando a Rescate.
 *  - Plazo: 3 días hábiles (regla de oro de cobros, igual que sin_contacto_3d)
 *    contados desde el día SIGUIENTE a la subida. La subida se sella a las
 *    23:59 GT, así que ese día no le dio tiempo a nadie de gestionar.
 *  - Cumplida: hay una `llamada` registrada en el caso desde la subida
 *    (contestada o no — el ticket pide la gestión, no el resultado).
 *  - Obsoleta: el crédito ya tuvo otro evento de bucket posterior (bajó, subió a
 *    B4, volvió a entrar a B3 con un episodio nuevo). La tarea deja de tener
 *    sentido y se cierra sin alerta.
 */

import {
	finDelDiaGT,
	siguienteDiaGT,
	sumarDiasHabilesGT,
} from "./business-days-gt";

export const BUCKET_INGRESO_B3 = 3;
export const DIAS_HABILES_TAREA_B3 = 3;

/** Campos del evento de `buckets_historial` que usa la regla. */
export interface EventoBucketB3 {
	tipo_evento: string;
	bucket_nuevo: number;
}

/** ¿Este evento del historial es un ingreso a B3? */
export function esIngresoB3(evento: EventoBucketB3): boolean {
	return (
		evento.tipo_evento === "SUBIDA" && evento.bucket_nuevo === BUCKET_INGRESO_B3
	);
}

/**
 * Vencimiento de la tarea: fin (23:59:59.999 GT) del tercer día hábil contado
 * desde el día siguiente a la subida. El job de las 08:00 GT la ve vencida la
 * mañana posterior a ese día — el mismo momento en que sin_contacto_3d escala.
 */
export function fechaVencimientoB3(fechaSubida: Date): Date {
	return finDelDiaGT(
		sumarDiasHabilesGT(siguienteDiaGT(fechaSubida), DIAS_HABILES_TAREA_B3),
	);
}

/** Llave del episodio de la tarea (`uq_notifications_cobros_dedup`). */
export function dedupKeyTareaB3(historialId: number): string {
	return `b3:${historialId}`;
}

/** Llave de la alerta de vencimiento, derivada de la de su tarea. */
export function dedupKeyVencidaB3(dedupKeyTarea: string): string {
	return `vencida:${dedupKeyTarea}`;
}

/** Recupera el `historial_id` de una llave `b3:<id>`; null si no tiene ese formato. */
export function historialIdDeDedupKeyB3(
	dedupKey: string | null,
): number | null {
	const m = /^b3:(\d+)$/.exec(dedupKey ?? "");
	return m ? Number(m[1]) : null;
}

export type EstadoTareaB3 =
	/** Sigue en plazo y sin llamada: no se hace nada. */
	| "abierta"
	/** Hay una llamada desde la subida: se cierra como resuelta. */
	| "cumplida"
	/** El crédito ya tuvo otro evento de bucket: se cierra sin alerta. */
	| "obsoleta"
	/** Venció sin llamada: se genera la alerta (la tarea sigue abierta). */
	| "vencida";

export interface EntradaEstadoTareaB3 {
	ahora: Date;
	fechaVencimiento: Date;
	/**
	 * Fecha del evento de ingreso (SUBIDA a B3). Null si ese evento ya no está en
	 * la ventana del historial que trae el job (tarea de hace más de ~60 días).
	 */
	fechaIngreso: Date | null;
	/**
	 * ¿El evento de ingreso sigue siendo el ÚLTIMO del crédito? `false` si hubo
	 * otro después; `null` si no se pudo ubicar el evento en la ventana.
	 */
	ingresoEsUltimoEvento: boolean | null;
	/** Última `llamada` registrada en el caso (cualquier fecha); null si no hay. */
	ultimaLlamada: Date | null;
}

/**
 * Decide qué hacer con una tarea abierta. El orden importa: una llamada hecha
 * cierra la tarea aunque el crédito ya haya cambiado de bucket o vencido el
 * plazo (el supervisor sí cumplió); después, lo obsoleto no debe alertar.
 */
export function estadoTareaB3(e: EntradaEstadoTareaB3): EstadoTareaB3 {
	if (
		e.fechaIngreso &&
		e.ultimaLlamada &&
		e.ultimaLlamada.getTime() >= e.fechaIngreso.getTime()
	) {
		return "cumplida";
	}
	// Sin el evento en la ventana no se puede juzgar el episodio: la alerta ya
	// salió hace semanas, así que la tarea se retira en vez de quedar zombi.
	if (e.fechaIngreso === null || e.ingresoEsUltimoEvento !== true) {
		return "obsoleta";
	}
	if (e.fechaVencimiento.getTime() < e.ahora.getTime()) return "vencida";
	return "abierta";
}

/** `cobros_tipo` que son TAREAS del supervisor (no alertas). Espejo en el web: `COBROS_TIPOS_TAREA`. */
export const COBROS_TIPOS_TAREA = ["b3_llamada_supervisor"] as const;

export type EstadoPlazoTarea = "vencida" | "vence_hoy" | "en_plazo";

function diaGT(d: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
	}).format(d);
}

/**
 * Estado del plazo de una tarea para pintar la sección "Mis tareas". Se compara
 * por DÍA calendario GT: `fechaVencimiento` es el último instante (23:59:59 GT)
 * del día límite, así que durante ese día la tarea "vence hoy" y recién al día
 * siguiente está "vencida" (mismo momento en que el job emite la alerta).
 */
export function estadoPlazoTarea(
	fechaVencimiento: Date,
	ahora: Date,
): EstadoPlazoTarea {
	const vence = diaGT(fechaVencimiento);
	const hoy = diaGT(ahora);
	if (vence < hoy) return "vencida";
	if (vence === hoy) return "vence_hoy";
	return "en_plazo";
}
