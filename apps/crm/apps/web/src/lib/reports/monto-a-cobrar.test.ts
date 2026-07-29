import { describe, expect, test } from "bun:test";
import {
	fillMissingMontoACobrarPeriods,
	getMontoACobrarParticipacionTotals,
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

test("totaliza el split sin modificar el total original", () => {
	const totals = getMontoACobrarParticipacionTotals(
		[
			{
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
			capital_inv_participacion_actual: "0",
			capital_cube_participacion_actual: "0",
			interes_iva_inv_participacion_actual: "0",
			interes_iva_cube_participacion_actual: "0",
			creditos_participacion_invalida: 1,
			creditos_participacion_invalida_rango: 1,
			cuotas_participacion_invalida: 1,
		},
		{
			capital_inv_participacion_actual: "0",
			capital_cube_participacion_actual: "0",
			interes_iva_inv_participacion_actual: "0",
			interes_iva_cube_participacion_actual: "0",
			creditos_participacion_invalida: 1,
			creditos_participacion_invalida_rango: 1,
			cuotas_participacion_invalida: 2,
		},
		{
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
			capital_inv_participacion_actual: "0",
			capital_cube_participacion_actual: "0",
			interes_iva_inv_participacion_actual: "0",
			interes_iva_cube_participacion_actual: "0",
			creditos_participacion_invalida: 1,
			cuotas_participacion_invalida: 1,
		},
		{
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
			capital_inv_participacion_actual: "10",
			capital_cube_participacion_actual: "90",
			interes_iva_inv_participacion_actual: "5",
			interes_iva_cube_participacion_actual: "45",
			creditos_participacion_invalida: 1,
			cuotas_participacion_invalida: 1,
		},
		{
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
