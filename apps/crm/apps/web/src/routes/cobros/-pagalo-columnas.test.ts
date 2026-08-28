import { describe, expect, test } from "bun:test";
import {
	alternarEstado,
	colorPuntoLink,
	etiquetaLinkCompacta,
	normalizarNombreCliente,
	tituloLink,
} from "./-pagalo-columnas";

describe("alternarEstado", () => {
	test("agrega un estado que no estaba seleccionado", () => {
		expect(alternarEstado([], "REVIEW_REQUIRED")).toEqual(["REVIEW_REQUIRED"]);
	});

	test("quita un estado que ya estaba seleccionado", () => {
		expect(
			alternarEstado(
				["REVIEW_REQUIRED", "APPLICATION_FAILED"],
				"REVIEW_REQUIRED",
			),
		).toEqual(["APPLICATION_FAILED"]);
	});

	test("no muta el array original", () => {
		const original = ["A"];
		alternarEstado(original, "B");
		expect(original).toEqual(["A"]);
	});
});

describe("etiquetaLinkCompacta", () => {
	test("link CAPITAL generation 1: sin sufijo de generación", () => {
		expect(etiquetaLinkCompacta({ linkType: "CAPITAL", generation: 1 })).toBe(
			"Capital",
		);
	});

	test("link MORA_INTERES generation > 1: incluye la generación", () => {
		expect(
			etiquetaLinkCompacta({ linkType: "MORA_INTERES", generation: 2 }),
		).toBe("Mora/Int. (gen. 2)");
	});
});

describe("colorPuntoLink", () => {
	test("PAID = verde", () => {
		expect(colorPuntoLink("PAID")).toBe("bg-green-500");
	});

	test("ERROR y REJECTED = rojo", () => {
		expect(colorPuntoLink("ERROR")).toBe("bg-red-500");
		expect(colorPuntoLink("REJECTED")).toBe("bg-red-500");
	});

	test("CREATING y ACTIVE = ámbar", () => {
		expect(colorPuntoLink("CREATING")).toBe("bg-amber-500");
		expect(colorPuntoLink("ACTIVE")).toBe("bg-amber-500");
	});

	test("CANCELLED/EXPIRED/REPLACED = gris (cerrado sin pago)", () => {
		expect(colorPuntoLink("CANCELLED")).toBe("bg-muted-foreground");
		expect(colorPuntoLink("EXPIRED")).toBe("bg-muted-foreground");
		expect(colorPuntoLink("REPLACED")).toBe("bg-muted-foreground");
	});
});

describe("tituloLink", () => {
	test("compone tipo + estado", () => {
		expect(tituloLink({ linkType: "CAPITAL" }, "Pagado")).toBe(
			"Capital · Pagado",
		);
		expect(tituloLink({ linkType: "MORA_INTERES" }, "Pendiente de pago")).toBe(
			"Mora/Int. · Pendiente de pago",
		);
	});

	test("con monto formateado, lo agrega al final", () => {
		expect(tituloLink({ linkType: "CAPITAL" }, "Pagado", "Q1,500.00")).toBe(
			"Capital · Pagado · Q1,500.00",
		);
	});

	test("sin monto, no agrega el separador extra", () => {
		expect(tituloLink({ linkType: "CAPITAL" }, "Pagado", undefined)).toBe(
			"Capital · Pagado",
		);
	});
});

describe("normalizarNombreCliente", () => {
	test("nombre todo en mayúsculas se convierte a título", () => {
		expect(normalizarNombreCliente("GERARDO FERMÍN LÓPEZ")).toBe(
			"Gerardo Fermín López",
		);
	});

	test("nombre ya mixto se deja tal cual (partículas, etc.)", () => {
		expect(normalizarNombreCliente("Kenneth Omar de la Cruz")).toBe(
			"Kenneth Omar de la Cruz",
		);
	});

	test("nombre null se deja null", () => {
		expect(normalizarNombreCliente(null)).toBeNull();
	});

	test("nombre vacío se deja igual", () => {
		expect(normalizarNombreCliente("")).toBe("");
	});
});
