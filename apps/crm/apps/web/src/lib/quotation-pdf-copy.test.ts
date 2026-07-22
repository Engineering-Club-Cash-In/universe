import { describe, expect, test } from "bun:test";
import { getQuotationPdfCopy } from "./quotation-pdf-copy";

describe("getQuotationPdfCopy", () => {
	test("identifica créditos sobre vehículo y evita lenguaje de compra", () => {
		expect(getQuotationPdfCopy("sobre_vehiculo")).toEqual({
			creditTypeLabel: "Sobre Vehículo",
			downPaymentLabel: "Monto solicitado:",
			showDownPaymentPercentage: false,
		});
	});

	test("conserva el lenguaje de enganche para autocompra", () => {
		expect(getQuotationPdfCopy("autocompra")).toEqual({
			creditTypeLabel: "Autocompra",
			downPaymentLabel: "Enganche:",
			showDownPaymentPercentage: true,
		});
	});
});
