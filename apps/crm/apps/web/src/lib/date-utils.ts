/**
 * Parsea una fecha string "YYYY-MM-DD" como fecha local (sin UTC).
 * Evita el desfase de timezone que ocurre con `new Date("2026-02-24")`.
 */
export function parseFechaLocal(fecha: string): Date {
	const [year, month, day] = fecha.split("-").map(Number);
	return new Date(year, month - 1, day);
}
