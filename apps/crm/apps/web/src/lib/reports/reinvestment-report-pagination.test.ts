import { expect, test } from "bun:test";

const source = await Bun.file(
	new URL("../../components/reports/reinvestment-report.tsx", import.meta.url),
).text();

test("todas las tablas extensas de inversión usan paginación compartida y distinguible", () => {
	for (const [label, rowsExpression] of [
		["Detalle por inversionista", "safeData.porInversionista"],
		["Histórico del ticket", "safeData.ticketInversion.historico"],
		["Detalle de interés", "data.detalleInteresNeto"],
		["Detalle de pagos extras", "data.detallePagosExtras"],
		["Detalle de compras", "data.detalleComprasMes"],
	]) {
		const escapedRows = rowsExpression.replaceAll(".", "\\.");
		expect(source).toMatch(
			new RegExp(
				`<PaginatedRows\\s+(?=[^>]*label="${label}")(?=[^>]*rows=\\{${escapedRows}\\})`,
				"s",
			),
		);
	}

	expect(source).toContain("aria-label={`Paginación de $" + "{label}`}");
	expect(source).toContain("Primera");
	expect(source).toContain("Última");
	expect(source).toContain("Página {page.page} de {page.totalPages}");
	expect(source).toContain("Mostrando {page.from}–{page.to} de {page.total}");
});
