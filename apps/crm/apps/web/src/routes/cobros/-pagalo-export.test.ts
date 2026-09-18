import { describe, expect, test } from "bun:test";
import { resolverNombreArchivoPagalo } from "./-pagalo-export";

describe("resolverNombreArchivoPagalo", () => {
	const hoy = new Date().toISOString().slice(0, 10);

	test("extrae el filename cuando el header content-disposition está presente", () => {
		const disposition = 'attachment; filename="supervision-pagalo-2026-09-18.xlsx"';
		expect(resolverNombreArchivoPagalo(disposition, "excel", false)).toBe(
			"supervision-pagalo-2026-09-18.xlsx",
		);
	});

	test("extrae el filename con sufijo parcial si el header lo incluye", () => {
		const disposition =
			'attachment; filename="supervision-pagalo-parcial-2026-09-18.pdf"';
		expect(resolverNombreArchivoPagalo(disposition, "pdf", true)).toBe(
			"supervision-pagalo-parcial-2026-09-18.pdf",
		);
	});

	test("fallback incluye sufijo -parcial si no hay header pero el reporte es truncado", () => {
		expect(resolverNombreArchivoPagalo(null, "excel", true)).toBe(
			`supervision-pagalo-parcial-${hoy}.xlsx`,
		);
		expect(resolverNombreArchivoPagalo("", "pdf", true)).toBe(
			`supervision-pagalo-parcial-${hoy}.pdf`,
		);
	});

	test("soporta filename sin comillas o con especificación RFC 5987", () => {
		expect(
			resolverNombreArchivoPagalo(
				"attachment; filename=supervision-pagalo-2026-09-18.xlsx",
				"excel",
				false,
			),
		).toBe("supervision-pagalo-2026-09-18.xlsx");

		expect(
			resolverNombreArchivoPagalo(
				"attachment; filename*=UTF-8''supervision-pagalo-parcial-2026-09-18.pdf",
				"pdf",
				true,
			),
		).toBe("supervision-pagalo-parcial-2026-09-18.pdf");
	});
});
