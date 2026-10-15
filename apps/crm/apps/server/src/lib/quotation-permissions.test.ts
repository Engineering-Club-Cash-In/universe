import { describe, expect, test } from "bun:test";
import {
	canManageAnyQuotation,
	canManageQuotations,
	motivoParaNoBorrarCotizacion,
} from "./quotation-permissions";

describe("quotation permissions", () => {
	test("allows sales, sales supervisors and admins to manage quotations", () => {
		expect(canManageQuotations("sales")).toBe(true);
		expect(canManageQuotations("sales_supervisor")).toBe(true);
		expect(canManageQuotations("admin")).toBe(true);
		expect(canManageQuotations("accounting")).toBe(false);
	});

	test("allows admins and sales supervisors to manage any quotation", () => {
		expect(canManageAnyQuotation("sales")).toBe(false);
		expect(canManageAnyQuotation("sales_supervisor")).toBe(true);
		expect(canManageAnyQuotation("admin")).toBe(true);
	});
});

describe("motivoParaNoBorrarCotizacion", () => {
	test("con la oportunidad ganada no se borra ninguna cotización", () => {
		expect(
			motivoParaNoBorrarCotizacion({
				estadoOportunidad: "won",
				esDelCierre: false,
			}),
		).toBe("No se puede eliminar una cotización de una oportunidad ganada");
	});

	test("la del cierre no se borra aunque la oportunidad ya no esté ganada", () => {
		expect(
			motivoParaNoBorrarCotizacion({
				estadoOportunidad: "open",
				esDelCierre: true,
			}),
		).toBe(
			"Esta cotización es la que usó el cierre del crédito y no se puede eliminar",
		);
	});

	test("abierta, perdida o sin oportunidad, se sigue pudiendo borrar", () => {
		for (const estadoOportunidad of ["open", "on_hold", "lost", null]) {
			expect(
				motivoParaNoBorrarCotizacion({ estadoOportunidad, esDelCierre: false }),
			).toBeNull();
		}
	});
});
