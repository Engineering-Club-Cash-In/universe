/**
 * CB-041 — Punto único donde el flujo de inmovilización EJECUTA la acción
 * sobre la unidad.
 *
 * Hoy (CB-041) siempre es manual: LEGION no tiene habilitado `unit/exec_cmd`
 * para nuestro usuario/token (pendiente de confirmar comandos, permisos y
 * relé instalado — ver conversación con Luis). El supervisor coordina el
 * apagado/reactivación con LEGION por fuera del CRM y usa
 * `marcarEjecutada` (routers/inmovilizacion-unidad.ts) para dejarlo
 * registrado acá.
 *
 * CB-120 cambia ESTA función (y solo esta) para llamar a
 * `wialonClient.ejecutarComando` (services/wialon/wialon-client.ts) cuando
 * LEGION confirme el acceso — el resto del flujo (router, notificaciones,
 * UI) no se toca.
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
