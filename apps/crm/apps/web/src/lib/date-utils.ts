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
