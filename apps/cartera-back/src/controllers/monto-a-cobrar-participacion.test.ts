import { describe, expect, test } from "bun:test";
import Big from "big.js";
import {
	calcularSplitParticipacionReporte,
	seleccionarSpreadHistorico,
} from "./monto-a-cobrar-participacion";

const split = (
	capital: string,
	interesIva: string,
	inversionistas: Array<{
		montoAportado: string;
		esExterno: boolean;
		spreadHistorico: string;
	}>,
	) =>
		calcularSplitParticipacionReporte({
			capital,
			interes: interesIva,
			iva: "0",
			inversionistas,
		});

const monto = (value: { toFixed: (dp: number) => string }) => value.toFixed(2);

describe("calcularSplitParticipacionReporte", () => {
	test("asigna una lista vacía 100% a CUBE", () => {
		const result = split("100.01", "10.01", []);

		expect(monto(result.capitalInv)).toBe("0.00");
		expect(monto(result.capitalCube)).toBe("100.01");
		expect(monto(result.interesIvaInv)).toBe("0.00");
		expect(monto(result.interesIvaCube)).toBe("10.01");
	});

	test("asigna todo a CUBE sin inversionistas externos", () => {
		const result = split("100.01", "10.01", [
			{ montoAportado: "100", esExterno: false, spreadHistorico: "0" },
		]);

		expect(monto(result.capitalInv)).toBe("0.00");
		expect(monto(result.capitalCube)).toBe("100.01");
		expect(monto(result.interesIvaInv)).toBe("0.00");
		expect(monto(result.interesIvaCube)).toBe("10.01");
	});

	test("pondera un inversionista por monto y spread", () => {
		const result = split("100.00", "20.00", [
			{ montoAportado: "20", esExterno: true, spreadHistorico: "80" },
			{ montoAportado: "80", esExterno: false, spreadHistorico: "0" },
		]);

		expect(monto(result.capitalInv)).toBe("20.00");
		expect(monto(result.interesIvaInv)).toBe("3.20");
		expect(monto(result.capitalCube)).toBe("80.00");
		expect(monto(result.interesIvaCube)).toBe("16.80");
	});

	test("pondera dos inversionistas con spreads distintos", () => {
		const result = split("100.00", "100.00", [
			{ montoAportado: "20", esExterno: true, spreadHistorico: "80" },
			{ montoAportado: "30", esExterno: true, spreadHistorico: "60" },
			{ montoAportado: "50", esExterno: false, spreadHistorico: "0" },
		]);

		expect(monto(result.capitalInv)).toBe("50.00");
		expect(monto(result.interesIvaInv)).toBe("34.00");
	});

	test("pondera tres inversionistas con spreads distintos", () => {
		const result = split("100.00", "100.00", [
			{ montoAportado: "10", esExterno: true, spreadHistorico: "50" },
			{ montoAportado: "20", esExterno: true, spreadHistorico: "80" },
			{ montoAportado: "30", esExterno: true, spreadHistorico: "25" },
			{ montoAportado: "40", esExterno: false, spreadHistorico: "0" },
		]);

		expect(monto(result.capitalInv)).toBe("60.00");
		expect(monto(result.interesIvaInv)).toBe("28.50");
	});

	test("conserva el spread almacenado de una fila legacy", () => {
		const result = split("100.00", "100.00", [
			{ montoAportado: "40", esExterno: true, spreadHistorico: "75" },
			{ montoAportado: "60", esExterno: false, spreadHistorico: "0" },
		]);

		expect(monto(result.interesIvaInv)).toBe("30.00");
	});

	test("no excluye varios spreads de 80% aunque su suma simple exceda 100%", () => {
		const inversionistas = [
			{ montoAportado: "50", esExterno: true, spreadHistorico: "80" },
			{ montoAportado: "50", esExterno: true, spreadHistorico: "80" },
		];
		const result = split("100.00", "100.00", inversionistas);
		const formulaAnteriorSaboteada = inversionistas.reduce(
			(total, inversionista) => total + Number(inversionista.spreadHistorico),
			0,
		);

		expect(formulaAnteriorSaboteada).toBe(160);
		expect(monto(result.interesIvaInv)).toBe("80.00");
		expect(monto(result.interesIvaCube)).toBe("20.00");
	});

	test("redondea una vez y deja el residuo exacto en CUBE", () => {
		const result = split("100.01", "10.01", [
			{ montoAportado: "1", esExterno: true, spreadHistorico: "80" },
			{ montoAportado: "2", esExterno: false, spreadHistorico: "0" },
		]);

		expect(monto(result.capitalInv)).toBe("33.34");
		expect(monto(result.capitalCube)).toBe("66.67");
		expect(monto(result.interesIvaInv)).toBe("2.67");
		expect(monto(result.interesIvaCube)).toBe("7.34");
		expect(result.capitalInv.plus(result.capitalCube).eq("100.01")).toBe(true);
		expect(result.interesIvaInv.plus(result.interesIvaCube).eq("10.01")).toBe(true);
	});

	test("conserva cero interés", () => {
		const result = split("100.00", "0.00", [
			{ montoAportado: "50", esExterno: true, spreadHistorico: "80" },
			{ montoAportado: "50", esExterno: false, spreadHistorico: "0" },
		]);

		expect(monto(result.interesIvaInv)).toBe("0.00");
		expect(monto(result.interesIvaCube)).toBe("0.00");
	});

	test("redondea interés e IVA por separado antes de sumarlos", () => {
		const result = calcularSplitParticipacionReporte({
			capital: "100.00",
			interes: "0.01",
			iva: "0.01",
			inversionistas: [
				{ montoAportado: "1", esExterno: true, spreadHistorico: "100" },
				{ montoAportado: "1", esExterno: false, spreadHistorico: "0" },
			],
		});

		expect(monto(result.interesInv)).toBe("0.01");
		expect(monto(result.ivaInv)).toBe("0.01");
		expect(monto(result.interesIvaInv)).toBe("0.02");
		expect(monto(result.interesIvaCube)).toBe("0.00");
	});

	test("suma el redondeo por inversionista y no redondea el agregado", () => {
		const result = calcularSplitParticipacionReporte({
			capital: "100.00",
			interes: "0.03",
			iva: "0.00",
			inversionistas: [
				{ montoAportado: "1", esExterno: true, spreadHistorico: "50" },
				{ montoAportado: "1", esExterno: true, spreadHistorico: "50" },
				{ montoAportado: "1", esExterno: false, spreadHistorico: "0" },
			],
		});

		expect(monto(result.interesInv)).toBe("0.02");
		expect(monto(result.interesCube)).toBe("0.01");
		expect(monto(result.interesIvaInv)).toBe("0.02");
		expect(monto(result.interesIvaCube)).toBe("0.01");
	});
});

describe("seleccionarSpreadHistorico", () => {
	test("usa el porcentaje almacenado si no hay id o el catálogo tiene NULL", () => {
		expect(
			seleccionarSpreadHistorico({
				porcentajeParticipacionInversionista: "75",
				modalidadFacturacionSpreadId: null,
				spreadCatalogo: null,
			}).eq("75"),
		).toBe(true);
		expect(
			seleccionarSpreadHistorico({
				porcentajeParticipacionInversionista: new Big("75"),
				modalidadFacturacionSpreadId: 4,
				spreadCatalogo: null,
			}).eq("75"),
		).toBe(true);
	});

	test("usa el spread de catálogo cuando existe", () => {
		expect(
			seleccionarSpreadHistorico({
				porcentajeParticipacionInversionista: "75",
				modalidadFacturacionSpreadId: 4,
				spreadCatalogo: "80.0099206300",
			}).eq("80.0099206300"),
		).toBe(true);
	});
});
