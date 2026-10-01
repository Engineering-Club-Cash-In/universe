import { describe, expect, test } from "bun:test";
import {
	documentosDelCaso,
	resumenDocumentos,
	tieneDocumentosPendientes,
} from "./documentos";
import type { Caso } from "./pasos";

const base: Caso["facturaSeguro"] = {
	habilitada: false,
	motivo: null,
	subidaAt: null,
	envio: null,
	reenviable: false,
	sinConfirmar: false,
};

function caso(
	factura: Partial<Caso["facturaSeguro"]>,
	porcentaje = 90,
	estado: Caso["estado"] = "en_proceso",
) {
	return { facturaSeguro: { ...base, ...factura }, porcentaje, estado };
}

describe("documentosDelCaso", () => {
	test("al 90% sin factura, la factura está pendiente (vendedor o gerente)", () => {
		for (const c of [caso({ habilitada: true }), caso({ motivo: "La sube el vendedor asignado" })]) {
			expect(documentosDelCaso(c)).toEqual([
				{
					clave: "factura_seguro",
					nombre: "Factura del seguro",
					estado: "pendiente",
				},
			]);
			expect(tieneDocumentosPendientes(c)).toBe(true);
		}
	});

	test("subida: enviada, en proceso o sin destinatario no piden nada", () => {
		for (const envio of ["enviado", "pendiente", "sin_destinatario"] as const) {
			expect(documentosDelCaso(caso({ envio }))[0]?.estado).toBe("subido");
		}
	});

	test("envío sin confirmar: hay que revisarlo, para el vendedor y para el gerente", () => {
		for (const reenviable of [true, false]) {
			const c = caso({ envio: "pendiente", sinConfirmar: true, reenviable });
			expect(documentosDelCaso(c)[0]?.estado).toBe("atencion");
			expect(tieneDocumentosPendientes(c)).toBe(false);
		}
	});

	test("subida pero el envío falló: hay que revisarla, no está pendiente", () => {
		const c = caso({ envio: "fallido", reenviable: true });
		expect(documentosDelCaso(c)[0]?.estado).toBe("atencion");
		expect(tieneDocumentosPendientes(c)).toBe(false);
	});

	test("al 90% ya ganado (flujo normal) sin factura: está pendiente y entra al filtro", () => {
		expect(tieneDocumentosPendientes(caso({ habilitada: true }, 90, "aprobado"))).toBe(true);
		expect(tieneDocumentosPendientes(caso({}, 90, "aprobado"))).toBe(true);
	});

	test("antes del 90%, perdido o desembolsado sin factura: no pide documentos", () => {
		expect(documentosDelCaso(caso({}, 85))).toEqual([]);
		expect(documentosDelCaso(caso({}, 90, "rechazado"))).toEqual([]);
		expect(documentosDelCaso(caso({}, 100, "aprobado"))).toEqual([]);
		expect(tieneDocumentosPendientes(caso({}, 85))).toBe(false);
	});

	test("desembolsado con la factura enviada: se sigue viendo como subida", () => {
		expect(documentosDelCaso(caso({ envio: "enviado" }, 100, "aprobado"))[0]?.estado).toBe(
			"subido",
		);
	});
});

describe("resumenDocumentos", () => {
	const doc = (estado: "pendiente" | "atencion" | "subido") => ({
		clave: "factura_seguro" as const,
		nombre: "Factura del seguro",
		estado,
	});

	test("un pendiente manda sobre todo lo demás", () => {
		expect(resumenDocumentos([doc("subido"), doc("atencion"), doc("pendiente")])).toEqual({
			tono: "pendiente",
			texto: "Documentos pendientes",
		});
	});

	test("sin pendientes pero con un envío fallido: revisar envío", () => {
		expect(resumenDocumentos([doc("subido"), doc("atencion")])).toEqual({
			tono: "atencion",
			texto: "Revisar envío",
		});
	});

	test("todo subido: sin documentos pendientes; sin documentos: no hay tarjeta", () => {
		expect(resumenDocumentos([doc("subido")])).toEqual({
			tono: "ok",
			texto: "Sin documentos pendientes",
		});
		expect(resumenDocumentos([])).toBeNull();
	});
});
