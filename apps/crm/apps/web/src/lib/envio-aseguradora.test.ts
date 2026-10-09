import { describe, expect, test } from "bun:test";
import {
	avisoFacturaSubida,
	etiquetaEnvioAseguradora,
	textoSubidoPor,
} from "./envio-aseguradora";

describe("etiquetaEnvioAseguradora", () => {
	test("nombra a la aseguradora según el estado del correo", () => {
		expect(
			etiquetaEnvioAseguradora({
				estado: "enviado",
				aseguradora: "universales",
			})?.texto,
		).toBe("Correo enviado a Seguros Universales");
		expect(
			etiquetaEnvioAseguradora({ estado: "fallido", aseguradora: "gyt" })
				?.texto,
		).toBe("No se pudo enviar el correo a Seguros G&T");
		expect(
			etiquetaEnvioAseguradora({
				estado: "sin_destinatario",
				aseguradora: "gyt",
			})?.texto,
		).toBe("Correo a Seguros G&T pendiente de configuración");
		expect(
			etiquetaEnvioAseguradora({ estado: "pendiente", aseguradora: "gyt" })
				?.texto,
		).toBe("Correo a Seguros G&T en proceso");
	});

	test("un envío pendiente pasado el plazo no se muestra como en proceso", () => {
		expect(
			etiquetaEnvioAseguradora({
				estado: "pendiente",
				aseguradora: "universales",
				sinConfirmar: true,
			}),
		).toEqual({
			texto: "No se pudo confirmar el correo a Seguros Universales",
			className: "bg-amber-100 text-amber-800",
		});
		expect(
			etiquetaEnvioAseguradora({
				estado: "pendiente",
				aseguradora: "universales",
				sinConfirmar: false,
			})?.texto,
		).toBe("Correo a Seguros Universales en proceso");
	});

	test("un documento que no es la factura del tracker no lleva etiqueta", () => {
		expect(etiquetaEnvioAseguradora(null)).toBeNull();
		expect(etiquetaEnvioAseguradora(undefined)).toBeNull();
		expect(
			etiquetaEnvioAseguradora({ estado: null, aseguradora: null }),
		).toBeNull();
	});
});

describe("textoSubidoPor", () => {
	test("la factura del tracker dice desde qué agencia se subió", () => {
		expect(
			textoSubidoPor({
				uploadedBy: { name: "QA Tracker Socio Vendedor" },
				subidoDesde: "JIM GUATEMALA ",
			}),
		).toBe("Subido desde JIM GUATEMALA por QA Tracker Socio Vendedor");
	});

	test("los demás documentos quedan igual que antes", () => {
		expect(
			textoSubidoPor({ uploadedBy: { name: "Ana" }, subidoDesde: null }),
		).toBe("Subido por Ana");
		expect(textoSubidoPor({ uploadedBy: null })).toBe(
			"Subido por Usuario desconocido",
		);
	});
});

describe("avisoFacturaSubida", () => {
	test("los demás documentos no muestran aviso de la aseguradora", () => {
		expect(avisoFacturaSubida(null)).toBeNull();
		expect(avisoFacturaSubida(undefined)).toBeNull();
	});

	test("según el resultado del envío desde el CRM", () => {
		expect(
			avisoFacturaSubida({
				enviada: true,
				envio: "enviado",
				aseguradora: "gyt",
			}),
		).toEqual({ tipo: "success", texto: "Factura enviada a Seguros G&T" });
		expect(
			avisoFacturaSubida({
				enviada: true,
				envio: "fallido",
				aseguradora: "universales",
			})?.tipo,
		).toBe("warning");
		expect(
			avisoFacturaSubida({
				enviada: true,
				envio: "sin_destinatario",
				aseguradora: "gyt",
			})?.texto,
		).toBe(
			"Factura guardada. El correo a Seguros G&T está pendiente de configuración",
		);
	});

	test("si no correspondía enviarla, dice por qué y que el documento quedó guardado", () => {
		expect(
			avisoFacturaSubida({
				enviada: false,
				motivo: "la oportunidad no está en formalización final (90%)",
			}),
		).toEqual({
			tipo: "info",
			texto:
				"Documento guardado. No se envió a la aseguradora: la oportunidad no está en formalización final (90%).",
		});
	});
});
