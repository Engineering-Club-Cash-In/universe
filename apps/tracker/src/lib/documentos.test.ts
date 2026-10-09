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
};

function caso(
	factura: Partial<Caso["facturaSeguro"]>,
	porcentaje = 90,
	estado: Caso["estado"] = "en_proceso",
) {
	return { facturaSeguro: { ...base, ...factura }, porcentaje, estado };
}

describe("documentosDelCaso", () => {
	test("al 90% sin factura queda pendiente para vendedor y gerente", () => {
		for (const c of [caso({ habilitada: true }), caso({ motivo: "La sube el vendedor" })]) {
			expect(documentosDelCaso(c)[0]?.estado).toBe("pendiente");
			expect(tieneDocumentosPendientes(c)).toBe(true);
		}
	});

	test("una factura subida ya no exige acciones en el tracker, incluso si el correo falló", () => {
		for (const envio of ["enviado", "pendiente", "fallido", "sin_destinatario"] as const) {
			const c = caso({ envio });
			expect(documentosDelCaso(c)[0]?.estado).toBe("subido");
			expect(tieneDocumentosPendientes(c)).toBe(false);
		}
	});

	test("el caso ganado al 90% conserva el pendiente; fuera de la etapa no pide factura", () => {
		expect(tieneDocumentosPendientes(caso({}, 90, "aprobado"))).toBe(true);
		expect(documentosDelCaso(caso({}, 85))).toEqual([]);
		expect(documentosDelCaso(caso({}, 100, "aprobado"))).toEqual([]);
		expect(documentosDelCaso(caso({}, 90, "rechazado"))).toEqual([]);
	});
});

describe("resumenDocumentos", () => {
	const doc = (estado: "pendiente" | "subido") => ({
		clave: "factura_seguro" as const,
		nombre: "Factura del seguro",
		estado,
	});

	test("muestra pendientes solo cuando falta un documento", () => {
		expect(resumenDocumentos([doc("subido"), doc("pendiente")])).toEqual({
			tono: "pendiente",
			texto: "Documentos pendientes",
		});
		expect(resumenDocumentos([doc("subido")])).toEqual({
			tono: "ok",
			texto: "Sin documentos pendientes",
		});
		expect(resumenDocumentos([])).toBeNull();
	});
});
