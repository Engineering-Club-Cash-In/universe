import { expect, test } from "bun:test";
import {
	construirComentarioGestionLinkPagalo,
	esLinkPagaloContabilizableEnGestion,
	esLinkPagaloGenerado,
	gestionLinkPagaloTieneWhatsappConfirmado,
	resultadoWhatsappGestionLinkPagalo,
	responsableGestionLinkPagalo,
	resumenGestionLinksPagalo,
	totalDeLinksPagalo,
} from "./pagalo-gestion";

test("describe links Págalo y resultado de WhatsApp para historial", () => {
	expect(
		construirComentarioGestionLinkPagalo({
			totalAmount: "5497.68",
			cantidadLinks: 2,
			whatsappEnviado: true,
		}),
	).toBe("Links Págalo generados: 2 links por Q5497.68. WhatsApp enviado.");
	expect(
		construirComentarioGestionLinkPagalo({
			totalAmount: "100.00",
			cantidadLinks: 1,
			whatsappEnviado: false,
		}),
	).toBe("Links Págalo generados: 1 link por Q100.00. WhatsApp no enviado.");
});

test("deja explícito cuando WhatsApp no tiene resultado y lo distingue", () => {
	const pendiente = construirComentarioGestionLinkPagalo({
		totalAmount: "100.00",
		cantidadLinks: 1,
		whatsappEnviado: null,
	});
	expect(pendiente).toBe(
		"Links Págalo generados: 1 link por Q100.00. WhatsApp sin confirmación.",
	);
	expect(gestionLinkPagaloTieneWhatsappConfirmado(pendiente)).toBe(false);
	expect(
		gestionLinkPagaloTieneWhatsappConfirmado(
			"Links Págalo generados: 1 link por Q100.00. WhatsApp enviado.",
		),
	).toBe(true);
});

test("recupera resultado WhatsApp previo al refrescar links regenerados", () => {
	expect(
		resultadoWhatsappGestionLinkPagalo(
			"Links Págalo generados: 2 links por Q100.00. WhatsApp enviado.",
		),
	).toBe(true);
	expect(
		resultadoWhatsappGestionLinkPagalo(
			"Links Págalo generados: 2 links por Q100.00. WhatsApp no enviado.",
		),
	).toBe(false);
	expect(
		resultadoWhatsappGestionLinkPagalo(
			"Links Págalo generados: 1 link por Q100.00. WhatsApp sin confirmación.",
		),
	).toBeNull();
});

test("suma solo links Págalo emitidos", () => {
	expect(totalDeLinksPagalo([{ amount: "1307.40" }])).toBe("1307.40");
	expect(
		totalDeLinksPagalo([{ amount: "1307.40" }, { amount: "1197.41" }]),
	).toBe("2504.81");
});

test("suma montos numeric sin perder centavos fuera de precisión Number", () => {
	expect(
		totalDeLinksPagalo([{ amount: "9999999999999999.99" }, { amount: "0.02" }]),
	).toBe("10000000000000000.01");
});

test("solo links activos o pagados cuentan como emitidos", () => {
	expect(esLinkPagaloGenerado("ACTIVE")).toBe(true);
	expect(esLinkPagaloGenerado("PAID")).toBe(true);
	expect(esLinkPagaloGenerado("ERROR")).toBe(false);
});

test("un pago tardío de link reemplazado no cuenta en la gestión", () => {
	expect(esLinkPagaloContabilizableEnGestion("ACTIVE", false)).toBe(true);
	expect(esLinkPagaloContabilizableEnGestion("PAID", true)).toBe(true);
	expect(esLinkPagaloContabilizableEnGestion("PAID", false)).toBe(false);
	expect(esLinkPagaloContabilizableEnGestion("PAID", null)).toBe(false);
	expect(esLinkPagaloContabilizableEnGestion("REPLACED", false)).toBe(false);
});

test("resumen de gestión refleja cero links cuando sucesor no emitió ninguno", () => {
	expect(
		resumenGestionLinksPagalo([
			{ amount: "1307.40", status: "ERROR", isApplicationSource: false },
			{ amount: "1197.41", status: "REPLACED", isApplicationSource: false },
		]),
	).toEqual({ cantidadLinks: 0, totalAmount: "0.00" });
});

test("gestión regenerada conserva asesor original cuando existe", () => {
	expect(
		responsableGestionLinkPagalo({
			creadorOriginal: "asesor-original",
			requestedBy: "supervisor",
		}),
	).toBe("asesor-original");
	expect(
		responsableGestionLinkPagalo({
			creadorOriginal: null,
			requestedBy: "supervisor",
		}),
	).toBe("supervisor");
});
