/**
 * Reglas puras de la Ficha 360 rediseñada (Figma «CRM Ventas» › Asesor Junior ›
 * 04 · Consulta · Ficha 360). Sin DB: se prueban en `ficha-cobros.test.ts`.
 *
 * Franja superior del Resumen: "Contactabilidad Alta · Días sin gestión 3".
 */

import { gtDateStrToDate, toDateStrGT } from "./guatemala-month-window";
import type { EstadoGestion } from "./seguimiento-cobros";

export type NivelContactabilidad = "alta" | "media" | "baja";

/**
 * Chip de estado de gestión del encabezado de la ficha. Cartera pone el
 * crédito en EN_CONVENIO apenas el asesor crea el convenio, pero lo guarda con
 * `activo = false` hasta que el supervisor lo aprueba: mientras tanto es
 * «Convenio pendiente», no «Convenio vigente».
 *
 * `convenioActivo`: true/false según cartera; null = no se pudo saber (cartera
 * apagada o caída) → se deja el estado como venía, igual que antes.
 */
export function estadoGestionConConvenio(
	estado: EstadoGestion,
	convenioActivo: boolean | null,
): EstadoGestion {
	if (estado === "convenio_vigente" && convenioActivo === false) {
		return "convenio_pendiente";
	}
	return estado;
}

/** Ventana en la que se mide la contactabilidad de UN caso. */
export const DIAS_VENTANA_CONTACTABILIDAD = 60;

/**
 * Contactabilidad del caso según las gestiones MANUALES de la ventana:
 * logrados / intentos. Alta ≥ 50 %, Media ≥ 20 %, Baja < 20 %. Sin intentos
 * no hay con qué medir → null (la ficha muestra "—").
 *
 * Umbrales propuestos en el rediseño (2026-10-06); si negocio define otros,
 * se cambian acá y en las pruebas.
 */
export function nivelContactabilidad(
	logrados: number,
	total: number,
): NivelContactabilidad | null {
	if (total <= 0) return null;
	const tasa = logrados / total;
	if (tasa >= 0.5) return "alta";
	if (tasa >= 0.2) return "media";
	return "baja";
}

/**
 * Días calendario (Guatemala) desde la última gestión manual. Hoy = 0.
 * Sin gestiones → null.
 */
export function diasSinGestion(
	ultimaGestion: Date | null,
	ahora: Date = new Date(),
): number | null {
	if (!ultimaGestion) return null;
	const dia = 24 * 60 * 60 * 1000;
	const hoy = gtDateStrToDate(toDateStrGT(ahora)).getTime();
	const ultima = gtDateStrToDate(toDateStrGT(ultimaGestion)).getTime();
	return Math.max(0, Math.round((hoy - ultima) / dia));
}
