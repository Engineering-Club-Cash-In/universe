export type MontoACobrarParticipacionRow = {
	bucket: string;
	cuotas_count: number;
	total_cuota: string;
	total_interes: string;
	total_iva: string;
	total_seguro: string;
	total_gps: string;
	total_membresias: string;
	total_mora: string;
	mora_count: number;
	total_credits: number;
	credits_con_mora: number;
	acum_total_cuota: string;
	acum_total_interes: string;
	acum_total_iva: string;
	acum_total_seguro: string;
	acum_total_gps: string;
	acum_total_membresias: string;
	total_interes_inversionista: string;
	acum_total_interes_inversionista: string;
	capital_inv_participacion_actual: string;
	capital_cube_participacion_actual: string;
	interes_iva_inv_participacion_actual: string;
	interes_iva_cube_participacion_actual: string;
	acum_capital_inv_participacion_actual: string;
	acum_capital_cube_participacion_actual: string;
	acum_interes_iva_inv_participacion_actual: string;
	acum_interes_iva_cube_participacion_actual: string;
	creditos_participacion_invalida: number;
	cuotas_participacion_invalida: number;
	participacion_actual: boolean;
};

type ParticipacionTotals = {
	capitalInv: number;
	capitalCube: number;
	interesIvaInv: number;
	interesIvaCube: number;
	creditosInvalidos: number;
	cuotasInvalidas: number;
};

const emptyRow = (bucket: string): MontoACobrarParticipacionRow => ({
	bucket,
	cuotas_count: 0,
	total_cuota: "0",
	total_interes: "0",
	total_iva: "0",
	total_seguro: "0",
	total_gps: "0",
	total_membresias: "0",
	total_mora: "0",
	mora_count: 0,
	total_credits: 0,
	credits_con_mora: 0,
	acum_total_cuota: "0",
	acum_total_interes: "0",
	acum_total_iva: "0",
	acum_total_seguro: "0",
	acum_total_gps: "0",
	acum_total_membresias: "0",
	total_interes_inversionista: "0",
	acum_total_interes_inversionista: "0",
	capital_inv_participacion_actual: "0",
	capital_cube_participacion_actual: "0",
	interes_iva_inv_participacion_actual: "0",
	interes_iva_cube_participacion_actual: "0",
	acum_capital_inv_participacion_actual: "0",
	acum_capital_cube_participacion_actual: "0",
	acum_interes_iva_inv_participacion_actual: "0",
	acum_interes_iva_cube_participacion_actual: "0",
	creditos_participacion_invalida: 0,
	cuotas_participacion_invalida: 0,
	participacion_actual: true,
});

export function fillMissingMontoACobrarPeriods(
	data: MontoACobrarParticipacionRow[],
	periodo: "anio" | "trimestre" | "mes" | "semana" | "dia",
	fechaInicio: string,
	fechaFin: string,
): MontoACobrarParticipacionRow[] {
	if (periodo !== "semana" && periodo !== "dia") return data;
	const toKey = (d: Date) =>
		`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	const rows = new Map(data.map((row) => [row.bucket.slice(0, 10), row]));
	const start = new Date(`${fechaInicio}T12:00:00`);
	const end = new Date(`${fechaFin}T12:00:00`);
	const dates: Date[] = [];
	const current = new Date(start);
	if (periodo === "semana") {
		const day = current.getDay();
		current.setDate(current.getDate() + (day === 0 ? -6 : 1 - day));
	}
	while (current <= end) {
		dates.push(new Date(current));
		current.setDate(current.getDate() + (periodo === "dia" ? 1 : 7));
	}
	return dates.map((date) => rows.get(toKey(date)) ?? emptyRow(toKey(date)));
}

export function getMontoACobrarParticipacionTotals(
	rows: Array<
		Pick<
			MontoACobrarParticipacionRow,
			| "capital_inv_participacion_actual"
			| "capital_cube_participacion_actual"
			| "interes_iva_inv_participacion_actual"
			| "interes_iva_cube_participacion_actual"
			| "creditos_participacion_invalida"
			| "cuotas_participacion_invalida"
		>
	>,
	acumulado: boolean,
): ParticipacionTotals {
	const last = rows.at(-1);
	const numeric = (value: string) => Number.parseFloat(value) || 0;
	if (acumulado && last) {
		return {
			capitalInv: numeric(last.capital_inv_participacion_actual),
			capitalCube: numeric(last.capital_cube_participacion_actual),
			interesIvaInv: numeric(last.interes_iva_inv_participacion_actual),
			interesIvaCube: numeric(last.interes_iva_cube_participacion_actual),
			creditosInvalidos: last.creditos_participacion_invalida,
			cuotasInvalidas: last.cuotas_participacion_invalida,
		};
	}
	return rows.reduce<ParticipacionTotals>(
		(total, row) => ({
			capitalInv:
				total.capitalInv + numeric(row.capital_inv_participacion_actual),
			capitalCube:
				total.capitalCube + numeric(row.capital_cube_participacion_actual),
			interesIvaInv:
				total.interesIvaInv + numeric(row.interes_iva_inv_participacion_actual),
			interesIvaCube:
				total.interesIvaCube +
				numeric(row.interes_iva_cube_participacion_actual),
			creditosInvalidos:
				total.creditosInvalidos + row.creditos_participacion_invalida,
			cuotasInvalidas:
				total.cuotasInvalidas + row.cuotas_participacion_invalida,
		}),
		{
			capitalInv: 0,
			capitalCube: 0,
			interesIvaInv: 0,
			interesIvaCube: 0,
			creditosInvalidos: 0,
			cuotasInvalidas: 0,
		},
	);
}
