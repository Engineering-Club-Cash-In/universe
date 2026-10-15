import { describe, expect, test } from "bun:test";
import {
	filasReferenciasFamiliares,
	filasReferenciasPersonales,
	HEAD_REFERENCIAS_FAMILIARES,
	HEAD_REFERENCIAS_PERSONALES,
} from "./generate-client-form-pdfs";

describe("PDF de la solicitud: DPI de las referencias", () => {
	test("referencias familiares: columna DPI y la fila que solo tiene DPI", () => {
		expect(HEAD_REFERENCIAS_FAMILIARES).toEqual([
			"#",
			"Nombre",
			"Teléfono",
			"DPI",
		]);
		expect(
			filasReferenciasFamiliares([
				{ nombre: "Tío", telefono: "55551234", dpi: "1234567030101" },
				{ nombre: "", telefono: "", dpi: "2345678990101" },
				{ nombre: "", telefono: "", dpi: "" },
			]),
		).toEqual([
			[1, "Tío", "55551234", "1234567030101"],
			[2, "", "", "2345678990101"],
		]);
	});

	test("referencias personales: columna DPI y la fila que solo tiene DPI", () => {
		expect(HEAD_REFERENCIAS_PERSONALES).toEqual([
			"#",
			"Nombre",
			"Relación",
			"Teléfono",
			"DPI",
		]);
		expect(
			filasReferenciasPersonales([
				{
					nombre: "Rosa",
					relacion: "tía",
					telefono: "44445678",
					dpi: "1234567030101",
				},
				{ nombre: "", relacion: "", telefono: "", dpi: "2345678990101" },
				{ nombre: "", relacion: "", telefono: "", dpi: "" },
			]),
		).toEqual([
			[1, "Rosa", "tía", "44445678", "1234567030101"],
			[2, "", "", "", "2345678990101"],
		]);
	});
});
