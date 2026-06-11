// Helpers de días hábiles en zona America/Guatemala (UTC-6, sin DST).
// Días hábiles = lunes a viernes. No considera feriados (se puede extender
// en el futuro con una lista si Negocio la pide).

const GT_TZ = "America/Guatemala";

/**
 * Instante actual. El valor devuelto es el mismo `new Date()`, pero el
 * nombre deja explícito que cualquier formateo/interpretación posterior
 * debe hacerse en zona `America/Guatemala`. Al guardarlo en columnas
 * `timestamptz` Postgres lo almacena en UTC y el cliente lo convierte a
 * la zona de su sesión al leer.
 */
export function nowGT(): Date {
	return new Date();
}

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

/**
 * Devuelve una nueva Date igual a `from` pero avanzada `days` días hábiles
 * (lun–vie) contados en zona Guatemala. La Date retornada apunta al mediodía
 * UTC del día resultante para evitar ambigüedades por DST/tz.
 */
export function addBusinessDaysGT(from: Date, days: number): Date {
	if (days <= 0) {
		const { y, m, day } = gtYMD(from);
		return new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
	}
	const { y, m, day } = gtYMD(from);
	let d = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
	let remaining = days;
	while (remaining > 0) {
		d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
		const dow = d.getUTCDay(); // 0=Dom, 6=Sáb
		if (dow !== 0 && dow !== 6) remaining--;
	}
	return d;
}

export function startOfDayGT(from: Date): Date {
	const { y, m, day } = gtYMD(from);
	return new Date(Date.UTC(y, m - 1, day, 6, 0, 0));
}

/**
 * Resumen de expiración para la compra de cartera.
 * - `expira`: último día hábil de vigencia (fromDate + 3 hábiles).
 * - `diaBaja`: siguiente día hábil después de `expira` — el día en que
 *   el job automático la dará de baja a las 00:00 GT.
 */
export function calcularExpiracionCompraCartera(fromDate: Date): {
	expira: Date;
	diaBaja: Date;
};
export function calcularExpiracionCompraCartera(
	fromDate: Date,
	extendida: boolean,
): {
	expira: Date;
	diaBaja: Date;
};
export function calcularExpiracionCompraCartera(
	fromDate: Date,
	extendida = false,
): {
	expira: Date;
	diaBaja: Date;
} {
	const expira = addBusinessDaysGT(fromDate, 3);
	const diaBajaBase = addBusinessDaysGT(expira, 1);
	const diaBaja = extendida ? addBusinessDaysGT(diaBajaBase, 1) : diaBajaBase;
	return { expira, diaBaja };
}

/**
 * Devuelve el día calendario en zona GT como `"YYYY-MM-DD"`. Útil para
 * comparar fechas sin que horas/minutos metan ruido.
 */
export function gtDateKey(d: Date): string {
	const { y, m, day } = gtYMD(d);
	return `${y.toString().padStart(4, "0")}-${m
		.toString()
		.padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

/**
 * Formatea una fecha como "lunes 27 de abril de 2026" en es-GT.
 */
export function formatFechaLargaGT(d: Date): string {
	return new Intl.DateTimeFormat("es-GT", {
		timeZone: GT_TZ,
		weekday: "long",
		day: "2-digit",
		month: "long",
		year: "numeric",
	}).format(d);
}
