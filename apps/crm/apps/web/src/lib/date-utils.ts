/**
 * Parsea una fecha string "YYYY-MM-DD" como fecha local (sin UTC).
 * Evita el desfase de timezone que ocurre con `new Date("2026-02-24")`.
 */
export function parseFechaLocal(fecha: string): Date {
	const [year, month, day] = fecha.split("-").map(Number);
	return new Date(year, month - 1, day);
}

/**
 * Formatea una fecha para mostrar en es-GT. Si el string es solo fecha
 * ("YYYY-MM-DD") la parsea como local para evitar el desfase de un día;
 * si trae hora (timestamp ISO) usa el parseo normal.
 */
export function formatFechaLocal(fecha: string): string {
	const esSoloFecha = /^\d{4}-\d{2}-\d{2}$/.test(fecha);
	const d = esSoloFecha ? parseFechaLocal(fecha) : new Date(fecha);
	return d.toLocaleDateString("es-GT");
}

/**
 * Fecha calendario de HOY en Guatemala, como "YYYY-MM-DD".
 *
 * GT es UTC-6 sin horario de verano, así que durante las últimas 6 horas de
 * cada día UTC la fecha del navegador (o del servidor) ya avanzó y la de
 * Guatemala no. Todo lo que compare "días" contra cartera tiene que usar
 * esta, no `new Date()`.
 */
export function hoyEnGuatemala(ahora: Date = new Date()): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(ahora);
}

/**
 * ¿La fecha de vencimiento ya PASÓ, en días calendario de Guatemala? Una
 * cuota que vence HOY todavía no está vencida.
 *
 * Existe porque `new Date("2026-09-08") < new Date()` es una trampa: el
 * string date-only se parsea como medianoche UTC, que en GT es las 18:00 del
 * día ANTERIOR — así que la cuota de hoy se veía "vencida" durante casi todo
 * el día (hallazgo de Codex, PR #1570). Espeja el criterio de cartera, que
 * arma `cuotasAtrasadas` con `fecha_vencimiento < hoy` (comparación de DATE,
 * sin hora); por eso compara los strings "YYYY-MM-DD" directo, que en ese
 * formato ordenan igual que las fechas.
 */
export function estaVencidaGT(
	fechaVencimiento: string | null | undefined,
	ahora: Date = new Date(),
): boolean {
	if (!fechaVencimiento) return false;
	const soloFecha = fechaVencimiento.slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(soloFecha)) return false;
	return soloFecha < hoyEnGuatemala(ahora);
}
