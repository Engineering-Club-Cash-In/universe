/**
 * CB-030 — subestado "Promesa activa" (display). ESPEJO del predicado del
 * server: apps/crm/apps/server/src/lib/promesa-vigente.ts
 * (condicionesPromesaVigente). Los dos deben decir lo mismo — promesa_pago +
 * fecha >= medianoche GT + estado pendiente/null — y si uno cambia, el otro
 * también.
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
 * Medianoche GT de hoy, como instante UTC (GT = UTC-6, sin DST). Es el corte
 * de "la fecha prometida todavía no pasó": una promesa cuya fecha cae hoy
 * sigue vigente el día entero.
 */
export function inicioDelDiaGT(ahora: Date = new Date()): Date {
	const hoyGtStr = new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(ahora);
	return new Date(`${hoyGtStr}T06:00:00.000Z`);
}

/**
 * Predicado de una sola promesa: promesa_pago + fecha prometida todavía NO
 * vencida (>= medianoche GT de hoy) + estadoPromesa pendiente/null (legacy).
 *
 * Espeja `condicionesPromesaVigente` del server
 * (apps/crm/apps/server/src/lib/promesa-vigente.ts) — si uno cambia, el otro
 * también.
 *
 * 'incumplida' NO es vigente: la promesa ya fracasó y su fecha necesariamente
 * pasó, así que el freeze en cartera-back tampoco aplica (el motor filtra
 * `fecha_promesa >= hoy` del lado del read). Antes esto solo excluía
 * 'cumplida' y no miraba la fecha, con lo que una promesa incumplida de hace
 * meses dejaba el badge "Promesa activa" pegado para siempre.
 *
 * Puramente de display — no evalúa gracia de 24h (eso lo hace
 * evaluarPromesa/el job nocturno).
 */
export function esPromesaActiva(
	p: PromesaContactoUI,
	ahora: Date = new Date(),
): boolean {
	if (p.estadoContacto !== "promesa_pago") return false;
	if (p.fechaProximoContacto == null) return false;
	if (p.estadoPromesa != null && p.estadoPromesa !== "pendiente") return false;
	const fecha = new Date(p.fechaProximoContacto);
	if (Number.isNaN(fecha.getTime())) return false;
	return fecha >= inicioDelDiaGT(ahora);
}

/**
 * ¿El crédito tiene AL MENOS una promesa activa? `estadosEnMemoria` es el
 * resultado fresco de getEstadoPromesasPago (Record<id, EstadoPromesa>);
 * cuando trae el id, gana sobre la columna DB de `promesas` — misma
 * precedencia que ya usa la tarjeta "Promesas de Pago" en $id.tsx, para que
 * el badge del header nunca contradiga el cuerpo de la tarjeta.
 *
 * OJO con la ausencia de un id: NO significa "sin dato fresco". El endpoint
 * excluye a propósito las promesas ya 'cumplida' del Record (son terminales,
 * re-evaluarlas pisaría un resultado cerrado — ver routers/cobros.ts), así
 * que para esas la ausencia es lo esperado y el fallback a la columna DB es
 * el camino correcto, no una degradación. Si algún día el endpoint empieza a
 * omitir ids por otro motivo (error parcial, truncado), esa distinción hay
 * que hacerla explícita: acá ambos casos se ven igual.
 */
export function tienePromesaActiva(
	promesas: PromesaContactoUI[],
	estadosEnMemoria?: Record<string, EstadoPromesaUI>,
	ahora: Date = new Date(),
): boolean {
	return promesas.some((p) => {
		const estadoResuelto =
			(p.id ? estadosEnMemoria?.[p.id] : undefined) ?? p.estadoPromesa ?? null;
		return esPromesaActiva({ ...p, estadoPromesa: estadoResuelto }, ahora);
	});
}
