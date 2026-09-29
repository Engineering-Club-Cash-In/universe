/**
 * CB-041 — Punto único donde el flujo de inmovilización EJECUTA la acción
 * sobre la unidad.
 *
 * LIMITACIÓN: la ejecución es siempre manual. El envío automático al
 * proveedor (Wialon/LEGION, `unit/exec_cmd`) es una integración futura y NO
 * forma parte de este flujo (CB-120 solo habilita B4): depende de que LEGION habilite comandos, permisos y relé para
 * nuestro usuario/token. El supervisor coordina el apagado/reactivación con
 * LEGION por fuera del CRM y usa `marcarEjecutada`
 * (routers/inmovilizacion-unidad.ts) para dejarlo registrado.
 *
 * Si algún día se integra el proveedor, el cambio se acota a ESTA función.
 */

import type { InmovilizacionAccion } from "../../lib/inmovilizacion-unidad";

export interface EjecutarInmovilizacionInput {
	accion: InmovilizacionAccion;
	wialonUnitId: number | null;
}

export interface EjecutarInmovilizacionResultado {
	modo: "manual" | "proveedor";
}

/**
 * Ejecuta (o registra la ejecución de) la acción sobre la unidad.
 *
 * No lanza por falta de integración: en modo manual la "ejecución" real ya
 * ocurrió fuera del CRM (LEGION la aplicó), y `referenciaEjecucion` es la
 * evidencia de eso — esta función solo confirma el modo con el que se contó
 * la fila de la tabla.
 */
export async function ejecutarInmovilizacion(
	_input: EjecutarInmovilizacionInput,
): Promise<EjecutarInmovilizacionResultado> {
	return { modo: "manual" };
}
