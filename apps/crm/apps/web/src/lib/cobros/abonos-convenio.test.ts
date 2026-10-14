import { describe, expect, it } from "bun:test";
import { abonosDeHoy } from "./abonos-convenio";

const HOY = "2026-10-14";

describe("abonosDeHoy", () => {
	it("toma solo pagos de hoy ya validados", () => {
		const abonos = abonosDeHoy(
			[
				{
					id: 10,
					pagos: [
						{
							pagoId: 1,
							montoBoleta: "500",
							montoAplicado: "500",
							fechaPago: "2026-10-14 09:30:00",
							validationStatus: "validated",
						},
						// De ayer.
						{
							pagoId: 2,
							montoBoleta: "300",
							montoAplicado: "300",
							fechaPago: "2026-10-13 22:00:00",
							validationStatus: "validated",
						},
						// Esperando a contabilidad.
						{
							pagoId: 3,
							montoBoleta: "200",
							montoAplicado: "200",
							fechaPago: "2026-10-14 10:00:00",
							validationStatus: "pending",
						},
					],
				},
			],
			HOY,
		);
		expect(abonos).toEqual([
			{ pagoId: 1, monto: 500, aplicadoPorCuota: { 10: 500 } },
		]);
	});

	it("junta un pago repartido en varias cuotas y guarda cuánto cayó en cada una", () => {
		const pago = {
			pagoId: 7,
			montoBoleta: "1000",
			fechaPago: "2026-10-14T08:00:00",
			validationStatus: "capital_validated",
		};
		const abonos = abonosDeHoy(
			[
				{ id: "1", pagos: [{ ...pago, montoAplicado: "600" }] },
				{ id: "2", pagos: [{ ...pago, montoAplicado: "250" }] },
			],
			HOY,
		);
		expect(abonos).toEqual([
			{ pagoId: 7, monto: 1000, aplicadoPorCuota: { 1: 600, 2: 250 } },
		]);
	});

	it("sin boleta usa lo aplicado y descarta montos en cero", () => {
		const abonos = abonosDeHoy(
			[
				{
					id: 3,
					pagos: [
						{
							pagoId: 8,
							montoAplicado: "150.50",
							fechaPago: "2026-10-14",
							validationStatus: "validated",
						},
						{
							pagoId: 9,
							montoAplicado: 0,
							fechaPago: "2026-10-14",
							validationStatus: "validated",
						},
					],
				},
			],
			HOY,
		);
		expect(abonos).toEqual([
			{ pagoId: 8, monto: 150.5, aplicadoPorCuota: { 3: 150.5 } },
		]);
	});
});
