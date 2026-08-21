import { describe, expect, test } from "bun:test";
import {
	calcularDistribucionPago,
	getConvenioAplicado,
	getDisplayedPartialContribution,
} from "./registrar-pago";

describe("getDisplayedPartialContribution", () => {
	test("devuelve 0 si no hay summary", () => {
		expect(getDisplayedPartialContribution(null)).toBe(0);
	});

	test("devuelve 0 si la cuota ya está cerrada", () => {
		expect(
			getDisplayedPartialContribution({
				cuota_cerrada: true,
				total_aplicado_cuota: "500",
				saldo_pendiente: "100",
				tiene_abono_parcial: true,
			}),
		).toBe(0);
	});

	test("devuelve el monto aplicado si hay abono parcial real", () => {
		expect(
			getDisplayedPartialContribution({
				cuota_cerrada: false,
				total_aplicado_cuota: "300",
				saldo_pendiente: "200",
				tiene_abono_parcial: true,
			}),
		).toBe(300);
	});
});

describe("getConvenioAplicado", () => {
	test("resta otros y mora antes de topar al convenio", () => {
		expect(getConvenioAplicado(1000, 100, 50, 800)).toBe(800);
		expect(getConvenioAplicado(500, 100, 50, 800)).toBe(350);
	});

	test("nunca es negativo", () => {
		expect(getConvenioAplicado(100, 200, 0, 800)).toBe(0);
	});
});

describe("calcularDistribucionPago", () => {
	test("el convenio es catch-up informativo y NO se resta de lo disponible para la cuota normal (regla de negocio 06-ago-2026, igual que cartera-back/carteraFront)", () => {
		const { distribucion, montoRestante } = calcularDistribucionPago({
			montoBoleta: 1000,
			otros: 0,
			mora: 0,
			cuotaConvenio: 800,
			cuotaBase: 1000,
			abonosYaHechos: 0,
			cuotaSeleccionada: 5,
		});

		const convenio = distribucion.find(
			(item) => item.concepto === "3. Cuota Convenio",
		);
		const cuota = distribucion.find((item) =>
			item.concepto.startsWith("4. Cuota #"),
		);

		// La boleta completa (1000) cuenta para ambos conceptos en paralelo:
		// el convenio se topa a 800 (mínimo entre cuotaConvenio y disponible),
		// y la cuota normal sigue viendo el disponible completo (1000) porque
		// cartera-back no resta el convenio del disponible que paga cuotas.
		expect(convenio?.monto).toBe(800);
		expect(cuota?.monto).toBe(1000);
		expect(montoRestante).toBe(0);
	});

	test("cascada otros -> mora -> convenio -> cuota respeta el orden", () => {
		const { distribucion } = calcularDistribucionPago({
			montoBoleta: 500,
			otros: 100,
			mora: 50,
			cuotaConvenio: 800,
			cuotaBase: 1000,
			abonosYaHechos: 0,
			cuotaSeleccionada: 3,
		});

		expect(distribucion.map((item) => item.concepto)).toEqual([
			"1. Otros",
			"2. Mora",
			"3. Cuota Convenio",
			"4. Cuota #3",
		]);
		expect(distribucion.map((item) => item.monto)).toEqual([100, 50, 350, 350]);
	});

	test("sin convenio activo, toda la boleta tras otros/mora va a la cuota", () => {
		const { distribucion, montoRestante } = calcularDistribucionPago({
			montoBoleta: 1000,
			otros: 0,
			mora: 0,
			cuotaConvenio: 0,
			cuotaBase: 700,
			abonosYaHechos: 0,
			cuotaSeleccionada: 7,
		});

		expect(distribucion).toEqual([{ concepto: "4. Cuota #7", monto: 700 }]);
		expect(montoRestante).toBe(300);
	});

	test("abonos ya hechos reducen lo que falta de la cuota normal", () => {
		const { distribucion } = calcularDistribucionPago({
			montoBoleta: 300,
			otros: 0,
			mora: 0,
			cuotaConvenio: 0,
			cuotaBase: 1000,
			abonosYaHechos: 800,
			cuotaSeleccionada: 2,
		});

		expect(distribucion).toEqual([{ concepto: "4. Cuota #2", monto: 200 }]);
	});
});
