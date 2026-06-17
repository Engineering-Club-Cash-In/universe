/**
 * Config de escenarios por reporte: qué palancas aplican, cómo transformar los
 * datos y cómo resumirlos para la comparación real vs escenario del modal.
 */
import {
	type ComparativoHistoricoRow,
	type FacturacionMesResponse,
	type FlujoCuotasInversionesResponse,
	type LeverKey,
	type MontoACobrarRow,
	type PuntoEquilibrioRow,
	type ScenarioParams,
	transformCobertura,
	transformComparativo,
	transformFacturacion,
	transformFlujoCuotas,
	transformMontoACobrar,
} from "./scenario";

export interface SummaryRow {
	concepto: string;
	valor: number;
}

export interface ScenarioReportConfig<T> {
	titulo: string;
	descripcion: string;
	levers: LeverKey[];
	/** Muestra controles de cuota ilustrativa (método de amortización). */
	usaMetodoCuota: boolean;
	transform: (base: T, p: ScenarioParams) => T;
	summarize: (data: T) => SummaryRow[];
}

const num = (v: string | number | null | undefined): number => {
	const x = Number(v);
	return Number.isFinite(x) ? x : 0;
};

const sumBy = <T>(rows: T[], pick: (r: T) => number): number =>
	rows.reduce((acc, r) => acc + pick(r), 0);

export const montoACobrarConfig: ScenarioReportConfig<MontoACobrarRow[]> = {
	titulo: "Monto a Cobrarse por Período",
	descripcion:
		"Estima cómo cambian las cuotas a cobrar si crece la colocación o baja la mora.",
	levers: ["colocacion", "mora", "metodo"],
	usaMetodoCuota: true,
	transform: transformMontoACobrar,
	summarize: (rows) => [
		{ concepto: "Capital", valor: sumBy(rows, (r) => num(r.total_cuota)) },
		{ concepto: "Interés", valor: sumBy(rows, (r) => num(r.total_interes)) },
		{ concepto: "IVA", valor: sumBy(rows, (r) => num(r.total_iva)) },
		{ concepto: "Seguro", valor: sumBy(rows, (r) => num(r.total_seguro)) },
		{ concepto: "GPS", valor: sumBy(rows, (r) => num(r.total_gps)) },
		{
			concepto: "Membresías",
			valor: sumBy(rows, (r) => num(r.total_membresias)),
		},
		{
			// mora_promedio ya es un promedio por bucket; promediamos entre
			// buckets para no inflar el valor con la cantidad de períodos.
			concepto: "Mora prom.",
			valor: rows.length
				? sumBy(rows, (r) => num(r.mora_promedio)) / rows.length
				: 0,
		},
	],
};

export const facturacionConfig: ScenarioReportConfig<FacturacionMesResponse> = {
	titulo: "Facturado del Mes vs Esperado",
	descripcion:
		"Estima cuánto más se cobraría al subir la efectividad o bajar la mora.",
	levers: ["efectividad", "mora"],
	usaMetodoCuota: false,
	transform: transformFacturacion,
	summarize: (data) => [
		{ concepto: "Capital", valor: num(data.cobrado.capital) },
		{ concepto: "Interés", valor: num(data.cobrado.interes) },
		{ concepto: "IVA", valor: num(data.cobrado.iva) },
		{ concepto: "Seguro", valor: num(data.cobrado.seguro) },
		{ concepto: "GPS", valor: num(data.cobrado.gps) },
		{ concepto: "Membresías", valor: num(data.cobrado.membresias) },
	],
};

export const flujoCuotasConfig: ScenarioReportConfig<FlujoCuotasInversionesResponse> =
	{
		titulo: "Flujo de Cuotas de Inversiones",
		descripcion: "Estima cómo escalan los flujos si crece la colocación.",
		levers: ["colocacion", "metodo"],
		usaMetodoCuota: true,
		transform: transformFlujoCuotas,
		summarize: (data) => {
			// Réplica de la lógica de totales del reporte (admin/reports/index.tsx):
			// variable/excedente son total-only (monto_reinvertido), interés incluye
			// IVA, cash usa monto_cash si existe, y sin-reinversión suma capital+interés+IVA.
			const reinversion = sumBy(data.reinversionPorTipo, (r) => {
				if (
					r.tipo === "reinversion_variable" ||
					r.tipo === "reinversion_excedente"
				)
					return num(r.monto_reinvertido);
				if (r.tipo === "reinversion_capital") return num(r.capital);
				if (r.tipo === "reinversion_interes")
					return num(r.interes) + num(r.iva);
				return num(r.capital) + num(r.interes) + num(r.iva);
			});
			const cash = sumBy(data.cashParcialPorTipo, (r) =>
				r.monto_cash
					? num(r.monto_cash)
					: num(r.capital) + num(r.interes) + num(r.iva),
			);
			const sinReinv =
				num(data.sinReinversion.totales.capital) +
				num(data.sinReinversion.totales.interes) +
				num(data.sinReinversion.totales.iva);
			return [
				{ concepto: "Reinversión", valor: reinversion },
				{ concepto: "Cash parcial", valor: cash },
				{ concepto: "Sin reinversión", valor: sinReinv },
				{
					concepto: "Abonos capital",
					valor: num(data.pagosExtras.abonos_capital),
				},
				{
					concepto: "Cancelaciones",
					valor: num(data.pagosExtras.cancelaciones),
				},
			];
		},
	};

export const coberturaConfig: ScenarioReportConfig<PuntoEquilibrioRow[]> = {
	titulo: "Cobertura de Colocación vs Meta",
	descripcion: "Estima la cobertura si se coloca más capital.",
	levers: ["colocacion"],
	usaMetodoCuota: false,
	transform: transformCobertura,
	summarize: (rows) => [
		{ concepto: "Colocado", valor: sumBy(rows, (r) => num(r.colocado)) },
		{ concepto: "Meta", valor: sumBy(rows, (r) => num(r.meta)) },
		{ concepto: "Faltante", valor: sumBy(rows, (r) => num(r.faltante)) },
	],
};

export const comparativoConfig: ScenarioReportConfig<
	ComparativoHistoricoRow[]
> = {
	titulo: "Comparativo Histórico Mensual",
	descripcion:
		"Estima el año si crece la colocación, sube la efectividad o baja la mora.",
	levers: ["colocacion", "efectividad", "mora"],
	usaMetodoCuota: false,
	transform: transformComparativo,
	summarize: (rows) => [
		{
			concepto: "Colocación",
			valor: sumBy(rows, (r) => num(r.colocacion_monto)),
		},
		{
			concepto: "Facturación",
			valor: sumBy(rows, (r) => num(r.facturacion)),
		},
		{ concepto: "Mora 30", valor: sumBy(rows, (r) => num(r.mora_30)) },
		{ concepto: "Mora 60", valor: sumBy(rows, (r) => num(r.mora_60)) },
		{ concepto: "Mora 90", valor: sumBy(rows, (r) => num(r.mora_90)) },
		{ concepto: "Mora 120+", valor: sumBy(rows, (r) => num(r.mora_120)) },
	],
};
