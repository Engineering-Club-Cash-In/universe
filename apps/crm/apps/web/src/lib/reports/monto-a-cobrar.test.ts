import { describe, expect, test } from "bun:test";
import {
	fillMissingMontoACobrarPeriods,
	getMontoACobrarParticipacionTotals,
	getMontoACobrarViewRow,
} from "./monto-a-cobrar";

describe("fillMissingMontoACobrarPeriods", () => {
	test("rellena buckets diarios faltantes incluyendo el split y metadata", () => {
		const rows = fillMissingMontoACobrarPeriods(
			[
				{
					bucket: "2026-07-01",
					cuotas_count: 1,
					total_cuota: "100",
					total_interes: "10",
					total_iva: "1.2",
					total_seguro: "0",
					total_gps: "0",
					total_membresias: "0",
					total_mora: "0",
					mora_count: 0,
					total_credits: 1,
					credits_con_mora: 0,
					acum_total_cuota: "100",
					acum_total_interes: "10",
					acum_total_iva: "1.2",
					acum_total_seguro: "0",
					acum_total_gps: "0",
					acum_total_membresias: "0",
					total_interes_inversionista: "0",
					acum_total_interes_inversionista: "0",
					capital_inv_participacion_actual: "50",
					capital_cube_participacion_actual: "50",
					interes_iva_inv_participacion_actual: "5.6",
					interes_iva_cube_participacion_actual: "5.6",
					acum_capital_inv_participacion_actual: "50",
					acum_capital_cube_participacion_actual: "50",
					acum_interes_iva_inv_participacion_actual: "5.6",
					acum_interes_iva_cube_participacion_actual: "5.6",
					creditos_participacion_invalida: 0,
					cuotas_participacion_invalida: 0,
					participacion_actual: true,
				},
			],
			"dia",
			"2026-07-01",
			"2026-07-02",
		);

		expect(rows).toHaveLength(2);
		expect(rows[1]).toMatchObject({
			bucket: "2026-07-02",
			capital_inv_participacion_actual: "0",
			capital_cube_participacion_actual: "0",
			interes_iva_inv_participacion_actual: "0",
			interes_iva_cube_participacion_actual: "0",
			creditos_participacion_invalida: 0,
			cuotas_participacion_invalida: 0,
			participacion_actual: true,
		});
	});
});

const montoRow = {
	bucket: "2026-07-01",
	cuotas_count: 2,
	total_cuota: "100",
	total_interes: "10",
	total_iva: "1.2",
	total_seguro: "3",
	total_gps: "4",
	total_membresias: "5",
	total_mora: "6",
	mora_count: 1,
	total_credits: 2,
	credits_con_mora: 1,
	acum_total_cuota: "200",
	acum_total_interes: "20",
	acum_total_iva: "2.4",
	acum_total_seguro: "6",
	acum_total_gps: "8",
	acum_total_membresias: "10",
	total_interes_inversionista: "7",
	acum_total_interes_inversionista: "14",
	capital_inv_participacion_actual: "40",
	capital_cube_participacion_actual: "60",
	interes_iva_inv_participacion_actual: "4.48",
	interes_iva_cube_participacion_actual: "6.72",
	acum_capital_inv_participacion_actual: "80",
	acum_capital_cube_participacion_actual: "120",
	acum_interes_iva_inv_participacion_actual: "8.96",
	acum_interes_iva_cube_participacion_actual: "13.44",
	creditos_participacion_invalida: 0,
	cuotas_participacion_invalida: 0,
	participacion_actual: true,
};

test("consolida interés con IVA y seguro con GPS sin alterar el total", () => {
	expect(getMontoACobrarViewRow(montoRow, false)).toEqual({
		capital: 100,
		interesIva: 11.2,
		servicios: 7,
		membresias: 5,
		interesInversionista: 7,
		capitalInv: 40,
		capitalCube: 60,
		interesIvaInv: 4.48,
		interesIvaCube: 6.72,
		totalMora: 6,
		total: 123.2,
	});
});

test("conserva la semántica acumulada en los rubros consolidados", () => {
	expect(getMontoACobrarViewRow(montoRow, true)).toMatchObject({
		capital: 200,
		interesIva: 22.4,
		servicios: 14,
		membresias: 10,
		interesInversionista: 14,
		capitalInv: 80,
		capitalCube: 120,
		interesIvaInv: 8.96,
		interesIvaCube: 13.44,
		total: 246.4,
	});
});

test("totaliza el split sin modificar el total original", () => {
	const totals = getMontoACobrarParticipacionTotals(
		[
			{
				cuotas_count: 1,
				capital_inv_participacion_actual: "10",
				capital_cube_participacion_actual: "90",
				interes_iva_inv_participacion_actual: "5",
				interes_iva_cube_participacion_actual: "7",
				creditos_participacion_invalida: 1,
				creditos_participacion_invalida_rango: 1,
				cuotas_participacion_invalida: 2,
			},
		],
		false,
	);

	expect(totals).toEqual({
		capitalInv: 10,
		capitalCube: 90,
		interesIvaInv: 5,
		interesIvaCube: 7,
		creditosInvalidos: 1,
		cuotasInvalidas: 2,
	});
});

test("usa el conteo distinct del rango y conserva las cuotas entre buckets", () => {
	const rows = [
		{
			cuotas_count: 1,
			capital_inv_participacion_actual: "0",
			capital_cube_participacion_actual: "0",
			interes_iva_inv_participacion_actual: "0",
			interes_iva_cube_participacion_actual: "0",
			creditos_participacion_invalida: 1,
			creditos_participacion_invalida_rango: 1,
			cuotas_participacion_invalida: 1,
		},
		{
			cuotas_count: 2,
			capital_inv_participacion_actual: "0",
			capital_cube_participacion_actual: "0",
			interes_iva_inv_participacion_actual: "0",
			interes_iva_cube_participacion_actual: "0",
			creditos_participacion_invalida: 1,
			creditos_participacion_invalida_rango: 1,
			cuotas_participacion_invalida: 2,
		},
		{
			cuotas_count: 3,
			capital_inv_participacion_actual: "0",
			capital_cube_participacion_actual: "0",
			interes_iva_inv_participacion_actual: "0",
			interes_iva_cube_participacion_actual: "0",
			creditos_participacion_invalida: 1,
			creditos_participacion_invalida_rango: 1,
			cuotas_participacion_invalida: 3,
		},
	];

	for (const acumulado of [false, true]) {
		expect(getMontoACobrarParticipacionTotals(rows, acumulado)).toMatchObject({
			creditosInvalidos: 1,
			cuotasInvalidas: 6,
		});
	}
});

test("usa dos créditos distintos del conteo escalar del rango", () => {
	const rows = [
		{
			cuotas_count: 1,
			capital_inv_participacion_actual: "0",
			capital_cube_participacion_actual: "0",
			interes_iva_inv_participacion_actual: "0",
			interes_iva_cube_participacion_actual: "0",
			creditos_participacion_invalida: 1,
			creditos_participacion_invalida_rango: 2,
			cuotas_participacion_invalida: 1,
		},
	];

	expect(getMontoACobrarParticipacionTotals(rows, false)).toMatchObject({
		creditosInvalidos: 2,
	});
});

test("conserva el fallback legacy cuando el conteo del rango no existe", () => {
	const rows = [
		{
			cuotas_count: 1,
			capital_inv_participacion_actual: "0",
			capital_cube_participacion_actual: "0",
			interes_iva_inv_participacion_actual: "0",
			interes_iva_cube_participacion_actual: "0",
			creditos_participacion_invalida: 1,
			cuotas_participacion_invalida: 1,
		},
		{
			cuotas_count: 2,
			capital_inv_participacion_actual: "0",
			capital_cube_participacion_actual: "0",
			interes_iva_inv_participacion_actual: "0",
			interes_iva_cube_participacion_actual: "0",
			creditos_participacion_invalida: 1,
			cuotas_participacion_invalida: 2,
		},
	];

	expect(getMontoACobrarParticipacionTotals(rows, false)).toMatchObject({
		creditosInvalidos: 2,
		cuotasInvalidas: 3,
	});
	expect(getMontoACobrarParticipacionTotals(rows, true)).toMatchObject({
		creditosInvalidos: 1,
		cuotasInvalidas: 3,
	});
});

test("el acumulado usa el último período y no suma valores ya acumulados", () => {
	const rows = [
		{
			cuotas_count: 1,
			capital_inv_participacion_actual: "10",
			capital_cube_participacion_actual: "90",
			interes_iva_inv_participacion_actual: "5",
			interes_iva_cube_participacion_actual: "45",
			creditos_participacion_invalida: 1,
			cuotas_participacion_invalida: 1,
		},
		{
			cuotas_count: 2,
			capital_inv_participacion_actual: "20",
			capital_cube_participacion_actual: "180",
			interes_iva_inv_participacion_actual: "10",
			interes_iva_cube_participacion_actual: "90",
			creditos_participacion_invalida: 2,
			cuotas_participacion_invalida: 2,
		},
	];

	expect(getMontoACobrarParticipacionTotals(rows, false)).toMatchObject({
		capitalInv: 30,
		capitalCube: 270,
	});
	expect(getMontoACobrarParticipacionTotals(rows, true)).toMatchObject({
		capitalInv: 20,
		capitalCube: 180,
	});
});

test("el acumulado conserva el split ante un último bucket solo de pagos", () => {
	const rows = [
		{
			cuotas_count: 1,
			capital_inv_participacion_actual: "20",
			capital_cube_participacion_actual: "180",
			interes_iva_inv_participacion_actual: "10",
			interes_iva_cube_participacion_actual: "90",
			creditos_participacion_invalida: 0,
			creditos_participacion_invalida_rango: 0,
			cuotas_participacion_invalida: 0,
		},
		{
			cuotas_count: 0,
			capital_inv_participacion_actual: "0",
			capital_cube_participacion_actual: "0",
			interes_iva_inv_participacion_actual: "0",
			interes_iva_cube_participacion_actual: "0",
			creditos_participacion_invalida: 0,
			creditos_participacion_invalida_rango: 0,
			cuotas_participacion_invalida: 0,
		},
	];

	expect(getMontoACobrarParticipacionTotals(rows, true)).toMatchObject({
		capitalInv: 20,
		capitalCube: 180,
		interesIvaInv: 10,
		interesIvaCube: 90,
	});
});
