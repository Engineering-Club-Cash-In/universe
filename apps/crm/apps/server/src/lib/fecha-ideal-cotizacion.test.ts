import { describe, expect, test } from "bun:test";
import {
	calcularRegeneracionCotizacionFechaIdeal,
	aplicarDeltaMontosInversionistas,
} from "./fecha-ideal-cotizacion";

const cotizacionBase = {
	adminCost: 7145.15,
	totalFinanced: 86995.15,
	extraAdminCost: 600,
	interestRate: 1.5,
	termMonths: 60,
	insuranceCost: 842.95,
	gpsCost: 148.2,
};

describe("calcularRegeneracionCotizacionFechaIdeal", () => {
	test("financia el proporcional sin cambiar el líquido del desembolso", () => {
		const resultado = calcularRegeneracionCotizacionFechaIdeal({
			...cotizacionBase,
			ajusteAnterior: 0,
			ajusteNuevo: 1424.12,
		});

		expect(resultado).toEqual({
			adminCost: 8569.27,
			totalFinanced: 88419.27,
			extraAdminCost: 2024.12,
			monthlyPayment: 3341.6,
			delta: 1424.12,
		});
		expect(resultado.totalFinanced - resultado.extraAdminCost).toBeCloseTo(
			cotizacionBase.totalFinanced - cotizacionBase.extraAdminCost,
			2,
		);
	});

	test("repetir el mismo ajuste no lo acumula", () => {
		const resultado = calcularRegeneracionCotizacionFechaIdeal({
			...cotizacionBase,
			adminCost: 8569.27,
			totalFinanced: 88419.27,
			extraAdminCost: 2024.12,
			ajusteAnterior: 1424.12,
			ajusteNuevo: 1424.12,
		});

		expect(resultado.delta).toBe(0);
		expect(resultado.totalFinanced).toBe(88419.27);
		expect(resultado.extraAdminCost).toBe(2024.12);
	});

	test("reemplazar el ajuste anterior aplica solo la diferencia", () => {
		const resultado = calcularRegeneracionCotizacionFechaIdeal({
			...cotizacionBase,
			adminCost: 8569.27,
			totalFinanced: 88419.27,
			extraAdminCost: 2024.12,
			ajusteAnterior: 1424.12,
			ajusteNuevo: 1000,
		});

		expect(resultado.delta).toBe(-424.12);
		expect(resultado.adminCost).toBe(8145.15);
		expect(resultado.totalFinanced).toBe(87995.15);
		expect(resultado.extraAdminCost).toBe(1600);
	});

	test("quitar el ajuste restaura la cotización base", () => {
		const resultado = calcularRegeneracionCotizacionFechaIdeal({
			...cotizacionBase,
			adminCost: 8569.27,
			totalFinanced: 88419.27,
			extraAdminCost: 2024.12,
			ajusteAnterior: 1424.12,
			ajusteNuevo: 0,
		});

		expect(resultado.adminCost).toBe(cotizacionBase.adminCost);
		expect(resultado.totalFinanced).toBe(cotizacionBase.totalFinanced);
		expect(resultado.extraAdminCost).toBe(cotizacionBase.extraAdminCost);
	});
});

describe("aplicarDeltaMontosInversionistas", () => {
	test("preserva la asignación ingresada y distribuye solo el delta", () => {
		const resultado = aplicarDeltaMontosInversionistas(
			[
				{
					inversionista_id: 10,
					nombre: "Inversionista A",
					monto_aportado: 60000,
					porcentaje_participacion: 50,
				},
				{
					inversionista_id: 20,
					nombre: "Inversionista B",
					monto_aportado: 40000,
					porcentaje_participacion: 50,
				},
			],
			1424.13,
		);

		expect(
			resultado.map((inversionista) => inversionista.monto_aportado),
		).toEqual([60712.07, 40712.06]);
		expect(
			resultado.reduce(
				(total, inversionista) =>
					total + Math.round(inversionista.monto_aportado * 100),
				0,
			),
		).toBe(10142413);
	});

	test("resta únicamente el delta al reemplazar un ajuste", () => {
		const resultado = aplicarDeltaMontosInversionistas(
			[
				{ monto_aportado: 60712.07, porcentaje_participacion: 50 },
				{ monto_aportado: 40712.06, porcentaje_participacion: 50 },
			],
			-1424.13,
		);

		expect(resultado.map(({ monto_aportado }) => monto_aportado)).toEqual([
			60000,
			40000,
		]);
	});
});
