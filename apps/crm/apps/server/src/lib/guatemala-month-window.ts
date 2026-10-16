const GUATEMALA_UTC_OFFSET_HOURS = 6;

/** Retorna la fecha como string YYYY-MM-DD en la zona horaria de Guatemala (UTC-6). */
export function toDateStrGT(date: Date): string {
	return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(date);
}

/** Convierte un string YYYY-MM-DD (día calendario GT) a medianoche GT almacenada como UTC (T06:00:00Z). */
export function gtDateStrToDate(dateStr: string): Date {
	return new Date(`${dateStr}T06:00:00.000Z`);
}

export function getGuatemalaMonthWindow(year: number, month: number) {
	return {
		startOfMonth: new Date(
			Date.UTC(year, month - 1, 1, GUATEMALA_UTC_OFFSET_HOURS),
		),
		endOfMonth: new Date(
			Date.UTC(year, month, 1, GUATEMALA_UTC_OFFSET_HOURS),
		),
	};
}

/** Los 3 meses que terminan en (year, month), del más viejo al elegido, cada uno con su ventana en hora de Guatemala. */
export function getUltimosTresMesesGT(year: number, month: number) {
	return [2, 1, 0].map((mesesAtras) => {
		const fecha = new Date(Date.UTC(year, month - 1 - mesesAtras, 1));
		const y = fecha.getUTCFullYear();
		const m = fecha.getUTCMonth() + 1;
		return { year: y, month: m, ...getGuatemalaMonthWindow(y, m) };
	});
}
