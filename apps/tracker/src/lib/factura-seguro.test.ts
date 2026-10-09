import { describe, expect, test } from "bun:test";
import { errorDeArchivoFactura, vistaFacturaSeguro } from "./factura-seguro";
import type { Caso } from "./pasos";

const base: Caso["facturaSeguro"] = {
	habilitada: false,
	motivo: null,
	subidaAt: null,
	envio: null,
};

function vista(
	factura: Partial<Caso["facturaSeguro"]>,
	porcentaje = 90,
	estado: Caso["estado"] = "en_proceso",
) {
	return vistaFacturaSeguro({
		facturaSeguro: { ...base, ...factura },
		porcentaje,
		estado,
	});
}

describe("vistaFacturaSeguro", () => {
	test("el vendedor asignado al 90% puede subir una única factura", () => {
		const resultado = vista({ habilitada: true });
		expect(resultado).toMatchObject({ accion: "subir", tono: "accion" });
		expect(resultado?.texto).toContain("no se puede reemplazar");
	});

	test("la factura enviada usa el texto neutral y conserva la fecha de subida", () => {
		const resultado = vista({
			envio: "enviado",
			subidaAt: "2026-10-01T18:00:00Z",
		});
		expect(resultado).toMatchObject({
			accion: null,
			tono: "ok",
			titulo: "Factura enviada",
		});
		expect(resultado?.texto).toContain("La factura fue enviada. Subida el");
	});

	test("ningún estado de correo da reenvío ni menciona aseguradora o correo", () => {
		for (const envio of ["enviado", "pendiente", "fallido", "sin_destinatario"] as const) {
			const resultado = vista({ envio, subidaAt: "2026-10-01T18:00:00Z" });
			expect(resultado?.accion).toBeNull();
			expect(`${resultado?.titulo} ${resultado?.texto}`).not.toMatch(/aseguradora|correo|reintent|reenv[ií]/i);
		}
	});

	test("el gerente ve la factura pendiente al 90%, incluso con el caso ganado", () => {
		expect(
			vista({ motivo: "Solo el vendedor asignado puede subir la factura" }, 90, "aprobado"),
		).toMatchObject({ titulo: "Factura del seguro pendiente", accion: null });
	});

	test("sin factura, no aparece antes del 90%, al 100% ni en un caso perdido", () => {
		expect(vista({}, 85)).toBeNull();
		expect(vista({}, 100, "aprobado")).toBeNull();
		expect(vista({}, 90, "rechazado")).toBeNull();
	});
});

describe("errorDeArchivoFactura", () => {
	test("acepta PDF e imágenes hasta 10 MB", () => {
		expect(errorDeArchivoFactura({ name: "f.pdf", type: "application/pdf", size: 1000 })).toBeNull();
		expect(errorDeArchivoFactura({ name: "foto.JPG", type: "", size: 1000 })).toBeNull();
	});

	test("rechaza otros tipos, archivos grandes o vacíos", () => {
		expect(errorDeArchivoFactura({ name: "f.docx", type: "application/msword", size: 1000 })).not.toBeNull();
		expect(errorDeArchivoFactura({ name: "f.pdf", type: "application/pdf", size: 11 * 1024 * 1024 })).toContain("10 MB");
		expect(errorDeArchivoFactura({ name: "f.pdf", type: "application/pdf", size: 0 })).not.toBeNull();
	});
});
