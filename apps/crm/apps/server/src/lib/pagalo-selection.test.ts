import { expect, test } from "bun:test";
import {
	assertPagaloInstallmentSelection,
	assertPagaloOtrosRequiresInstallment,
} from "./pagalo-selection";

test("Págalo exige cuota cuando Otros está presente", () => {
	expect(() => assertPagaloOtrosRequiresInstallment("12.34", [])).toThrow(
		"Seleccione al menos una cuota para agregar Otros.",
	);
	expect(() => assertPagaloOtrosRequiresInstallment(undefined, [])).not.toThrow();
	expect(() => assertPagaloOtrosRequiresInstallment("12.34", [11])).not.toThrow();
});

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
