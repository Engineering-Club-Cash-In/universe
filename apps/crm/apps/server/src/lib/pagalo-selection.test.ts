import { expect, test } from "bun:test";
import { assertPagaloInstallmentSelection } from "./pagalo-selection";

test("Págalo acepta prefijo consecutivo desde cuota más antigua", () => {
	expect(() =>
		assertPagaloInstallmentSelection([11, 12], [11, 12, 13]),
	).not.toThrow();
});

test("Págalo rechaza cuota seleccionada sin sus anteriores", () => {
	expect(() =>
		assertPagaloInstallmentSelection([12], [11, 12, 13]),
	).toThrow("prefijo consecutivo");
});

test("Págalo permite siguiente cuota pendiente al final de vencidas", () => {
	expect(() =>
		assertPagaloInstallmentSelection([11, 12, 13], [11, 12, 13]),
	).not.toThrow();
});
