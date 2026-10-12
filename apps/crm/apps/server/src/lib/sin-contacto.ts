/**
 * Regla ÚNICA de «sin contacto» de cobros (tarea S2, docs/features/cobros-02/23).
 *
 * Antes había tres umbrales: 3 días hábiles en la alerta, más de 5 días
 * calendario en la cola del día y 48 horas en la cartera. Queda uno:
 *
 *   un crédito está «sin contacto» cuando lleva al menos
 *   `UMBRAL_DIAS_HABILES_SIN_CONTACTO` días hábiles COMPLETOS sin una gestión
 *   MANUAL (no cuentan `link_pago_generado` ni los envíos automáticos).
 *
 * Los días se cuentan desde el día siguiente a la última gestión hasta ayer
 * (el día en curso todavía no terminó), con la regla de oro de cobros
 * (`lib/business-days-gt.ts`). Es el mismo conteo que usa la alerta
 * `sin_contacto_3d`.
 */

import {
	contarDiasHabilesGT,
	esDiaHabilGT,
	siguienteDiaGT,
} from "./business-days-gt";
import { gtDateStrToDate, toDateStrGT } from "./guatemala-month-window";

export const UMBRAL_DIAS_HABILES_SIN_CONTACTO = 3;

const MS_DIA = 24 * 60 * 60 * 1000;

/** Días hábiles completos transcurridos desde la última gestión manual. */
export function diasHabilesSinContacto(
	ultimaGestion: Date,
	ahora: Date,
): number {
	return contarDiasHabilesGT(siguienteDiaGT(ultimaGestion), ahora);
}

export function estaSinContacto(
	diasHabiles: number | null | undefined,
	umbral: number = UMBRAL_DIAS_HABILES_SIN_CONTACTO,
): boolean {
	return diasHabiles != null && diasHabiles >= umbral;
}

/**
 * Inicio (medianoche GT) de la ventana «con contacto reciente»: una gestión
 * hecha en o después de este instante deja al crédito FUERA de «sin contacto»;
 * una anterior ya lleva `umbral` días hábiles completos.
 */
export function inicioVentanaConContacto(
	ahora: Date,
	umbral: number = UMBRAL_DIAS_HABILES_SIN_CONTACTO,
): Date {
	const hoyMs = gtDateStrToDate(toDateStrGT(ahora)).getTime();
	// Se camina hacia atrás desde ayer hasta juntar `umbral` días hábiles.
	let habiles = 0;
	let dia = hoyMs - MS_DIA;
	for (let i = 0; i < 400; i++) {
		// mediodía del día GT para que esDiaHabilGT no caiga en el borde
		if (esDiaHabilGT(new Date(dia + 12 * 60 * 60 * 1000))) habiles++;
		if (habiles >= umbral) break;
		dia -= MS_DIA;
	}
	// `dia` es el día donde se junta el último de los `umbral` hábiles: una
	// gestión de ese día todavía deja `umbral - 1` completos, así que la
	// ventana «reciente» arranca en él.
	return new Date(dia);
}
