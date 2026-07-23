// Helpers de días hábiles en zona America/Guatemala (UTC-6, sin DST) para el
// módulo de cobros (COBROS-02). Portado de apps/cartera-back businessDays.ts,
// PERO con la "regla de oro" de cobros: normalmente hábil = Lun–Vie, salvo que
// el día sea QUINCENA (15) o FIN DE MES — esos SIEMPRE cuentan como hábiles
// aunque caigan sábado o domingo (es cuando cae la paga). No considera feriados.
// TODO(Juanda): validar el detalle fino de la regla de oro antes de producción.

const GT_TZ = "America/Guatemala";

function gtYMD(d: Date): { y: number; m: number; day: number } {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: GT_TZ,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(d);
	const get = (k: string) =>
		Number(parts.find((p) => p.type === k)?.value ?? "0");
	return { y: get("year"), m: get("month"), day: get("day") };
}

/** Último día del mes (mes 1-indexed) — p.ej. ultimoDiaMes(2026, 2) = 28. */
function ultimoDiaMes(y: number, m: number): number {
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * ¿Es día hábil en zona GT según la regla de oro de cobros?
 *  - Lun–Vie: siempre hábil.
 *  - Sáb/Dom: hábil SOLO si es quincena (día 15) o fin de mes (último día).
 */
export function esDiaHabilGT(d: Date): boolean {
	const { y, m, day } = gtYMD(d);
	// getUTCDay del mediodía UTC del día GT — sin ambigüedad de borde por tz.
	const dow = new Date(Date.UTC(y, m - 1, day, 12, 0, 0)).getUTCDay(); // 0=Dom,6=Sáb
	const esFinDeSemana = dow === 0 || dow === 6;
	if (!esFinDeSemana) return true;
	return day === 15 || day === ultimoDiaMes(y, m);
}

/**
 * Mediodía UTC del día calendario GT SIGUIENTE al de `d`. Sirve para anclar el
 * conteo "a partir del día siguiente": una subida de bucket se sella a las 23:59
 * GT (motor procesarMoras), así que ese día no le dio tiempo al asesor y no debe
 * contar como día hábil de gestión.
 */
export function siguienteDiaGT(d: Date): Date {
	const { y, m, day } = gtYMD(d);
	// GT no tiene DST → +24h desde el mediodía UTC cae siempre al día GT siguiente.
	return new Date(Date.UTC(y, m - 1, day, 12, 0, 0) + 24 * 60 * 60 * 1000);
}

/**
 * Cuenta los días hábiles (regla de oro) en el intervalo SEMIABIERTO
 * [inicio, fin): desde el día calendario GT de `inicio` (inclusive) hasta el
 * día calendario GT de `fin` (EXCLUSIVE). Devuelve 0 si fin <= inicio.
 *
 * Uso en cobros: días hábiles transcurridos desde que un crédito subió de
 * bucket (medianoche) hasta hoy — el job de las 8am alerta al llegar a 3.
 * Ej.: subió el lunes 00:00, hoy jueves → cuenta {lun, mar, mié} = 3.
 */
export function contarDiasHabilesGT(inicio: Date, fin: Date): number {
	const { y: iy, m: im, day: iday } = gtYMD(inicio);
	const { y: fy, m: fm, day: fday } = gtYMD(fin);
	// Iterar por mediodía UTC de cada día evita saltos de borde (GT no tiene DST).
	let cursor = Date.UTC(iy, im - 1, iday, 12, 0, 0);
	const limite = Date.UTC(fy, fm - 1, fday, 12, 0, 0);
	let habiles = 0;
	// Guarda defensiva: nunca iterar más de ~3 años.
	let seguridad = 0;
	while (cursor < limite && seguridad < 1200) {
		if (esDiaHabilGT(new Date(cursor))) habiles++;
		cursor += 24 * 60 * 60 * 1000;
		seguridad++;
	}
	return habiles;
}
