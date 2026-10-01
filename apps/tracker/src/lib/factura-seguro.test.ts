import { describe, expect, test } from "bun:test";
import { errorDeArchivoFactura, vistaFacturaSeguro } from "./factura-seguro";
import type { Caso } from "./pasos";

const base: Caso["facturaSeguro"] = {
	habilitada: false,
	motivo: null,
	subidaAt: null,
	envio: null,
	reenviable: false,
	sinConfirmar: false,
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
	test("el vendedor asignado al 90% ve la acción de subir", () => {
		expect(vista({ habilitada: true })).toMatchObject({
			tono: "accion",
			accion: "subir",
		});
	});

	test("enviada: confirmación con la fecha de subida", () => {
		const v = vista({ envio: "enviado", subidaAt: "2026-09-29T18:00:00Z" });
		expect(v).toMatchObject({ tono: "ok", accion: null });
		expect(v?.texto).toContain("fue enviado a la aseguradora");
		expect(v?.texto).not.toContain("recibió");
		expect(v?.texto).toContain("Subida el");
	});

	test("en proceso: sin acción mientras el servidor no permita reintentar", () => {
		expect(vista({ envio: "pendiente" })).toMatchObject({
			tono: "proceso",
			accion: null,
		});
	});

	test("pendiente abandonado: no se afirma que falló y se puede reintentar", () => {
		const v = vista({ envio: "pendiente", sinConfirmar: true, reenviable: true });
		expect(v).toMatchObject({
			tono: "info",
			titulo: "No pudimos confirmar el envío",
			accion: "reenviar",
			etiquetaReenvio: "Reintentar envío",
		});
		expect(v?.titulo).not.toContain("no se pudo enviar");
		expect(v?.texto).toContain("Puedes reintentar el envío");
		expect(v?.texto).not.toContain("no se enviará de nuevo");
	});

	test("pendiente abandonado visto por el gerente: sin confirmar, sin acción (ya no dice 'Enviando')", () => {
		const v = vista({ envio: "pendiente", sinConfirmar: true, reenviable: false });
		expect(v).toMatchObject({
			tono: "info",
			titulo: "No pudimos confirmar el envío",
			accion: null,
		});
		expect(v?.texto).toContain("El vendedor asignado puede reintentar el envío");
	});

	test("rechazada: el vendedor reenvía; el gerente solo ve el estado", () => {
		expect(vista({ envio: "fallido", reenviable: true })).toMatchObject({
			tono: "error",
			accion: "reenviar",
			etiquetaReenvio: "Reenviar a la aseguradora",
		});
		const gerente = vista({ envio: "fallido", reenviable: false });
		expect(gerente).toMatchObject({ tono: "error", accion: null });
		expect(gerente?.texto).toContain("el vendedor asignado puede reenviarla");
	});

	test("sin destinatario: factura recibida, pendiente de configuración de Club Cash In (no es un fallo)", () => {
		const vendedor = vista({ envio: "sin_destinatario", reenviable: true });
		expect(vendedor).toMatchObject({
			tono: "info",
			titulo: "Factura recibida",
			accion: "reenviar",
			etiquetaReenvio: "Reintentar envío",
		});
		expect(vendedor?.texto).toContain(
			"pendiente de configuración por parte de Club Cash In",
		);
		expect(vendedor?.titulo).not.toContain("no se pudo");

		const gerente = vista({ envio: "sin_destinatario", reenviable: false });
		expect(gerente).toMatchObject({ tono: "info", accion: null });
		expect(gerente?.texto).not.toContain("reintenta");
	});

	test("el gerente al 90% ve que está pendiente, con el motivo del servidor", () => {
		expect(
			vista({
				motivo: "Solo el vendedor asignado puede subir la factura del seguro",
			}),
		).toMatchObject({
			tono: "info",
			accion: null,
			texto: "Solo el vendedor asignado puede subir la factura del seguro",
		});
	});

	test("al 90% ya ganado (flujo normal), el gerente sigue viendo el pendiente", () => {
		expect(vista({ motivo: "La sube el vendedor asignado" }, 90, "aprobado")).toMatchObject({
			titulo: "Factura del seguro pendiente",
		});
	});

	test("antes del 90%, desembolsado o perdido sin factura: no se muestra", () => {
		expect(vista({}, 85)).toBeNull();
		expect(vista({}, 100, "aprobado")).toBeNull();
		expect(vista({}, 90, "rechazado")).toBeNull();
	});
});

describe("errorDeArchivoFactura", () => {
	test("acepta PDF e imágenes hasta 10 MB", () => {
		expect(
			errorDeArchivoFactura({
				name: "f.pdf",
				type: "application/pdf",
				size: 1000,
			}),
		).toBeNull();
		// Algunos navegadores no reportan el tipo: se mira la extensión.
		expect(
			errorDeArchivoFactura({ name: "foto.JPG", type: "", size: 1000 }),
		).toBeNull();
	});

	test("rechaza otros tipos, archivos grandes o vacíos", () => {
		expect(
			errorDeArchivoFactura({
				name: "f.docx",
				type: "application/msword",
				size: 1000,
			}),
		).not.toBeNull();
		expect(
			errorDeArchivoFactura({
				name: "f.pdf",
				type: "application/pdf",
				size: 11 * 1024 * 1024,
			}),
		).toContain("10 MB");
		expect(
			errorDeArchivoFactura({
				name: "f.pdf",
				type: "application/pdf",
				size: 0,
			}),
		).not.toBeNull();
	});
});
