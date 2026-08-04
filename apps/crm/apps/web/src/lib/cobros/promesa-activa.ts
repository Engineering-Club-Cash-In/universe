/**
 * CB-030 — subestado "Promesa activa" (display). ESPEJO del predicado del
 * server (apps/crm/apps/server/src/lib/promesa-pago.ts, esPromesaActiva /
 * wherePromesaActiva en routers/cobros.ts) — mantener ambos sincronizados si
 * este predicado cambia.
 *
 * Diseño vigente (rediseñado tras aclaración de producto): mientras la
 * promesa está vigente, el motor de cartera-back CONGELA las cuotas
 * cubiertas por su rango (no genera mora nueva ni sube el bucket por esas
 * cuotas específicas — ver isOverdueInstallmentForMora en
 * apps/cartera-back/src/controllers/latefee.ts). El bucket que se muestra
 * YA viene congelado desde el servidor; este módulo solo decide si mostrar
 * el badge informativo que EXPLICA por qué — no duplica ni recalcula el
 * freeze del lado del cliente.
 */

export type EstadoPromesaUI = "pendiente" | "cumplida" | "incumplida";

export interface PromesaContactoUI {
	id?: string;
	estadoContacto?: string | null;
	fechaProximoContacto?: string | Date | null;
	estadoPromesa?: EstadoPromesaUI | null;
}

/**
 * Predicado de una sola promesa: promesa_pago + fecha prometida presente +
 * estadoPromesa pendiente/incumplida/null (fila legacy). 'cumplida' es
 * TERMINAL. Puramente de display — no evalúa gracia de 24h (eso lo hace
 * evaluarPromesa/el job nocturno).
 */
export function esPromesaActiva(p: PromesaContactoUI): boolean {
	if (p.estadoContacto !== "promesa_pago") return false;
	if (p.fechaProximoContacto == null) return false;
	return p.estadoPromesa !== "cumplida";
}

/**
 * ¿El crédito tiene AL MENOS una promesa activa? `estadosEnMemoria` es el
 * resultado fresco de getEstadoPromesasPago (Record<id, EstadoPromesa>);
 * cuando trae el id, gana sobre la columna DB de `promesas` — misma
 * precedencia que ya usa la tarjeta "Promesas de Pago" en $id.tsx, para que
 * el badge del header nunca contradiga el cuerpo de la tarjeta.
 */
export function tienePromesaActiva(
	promesas: PromesaContactoUI[],
	estadosEnMemoria?: Record<string, EstadoPromesaUI>,
): boolean {
	return promesas.some((p) => {
		const estadoResuelto =
			(p.id ? estadosEnMemoria?.[p.id] : undefined) ?? p.estadoPromesa ?? null;
		return esPromesaActiva({ ...p, estadoPromesa: estadoResuelto });
	});
}
