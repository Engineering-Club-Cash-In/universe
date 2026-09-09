import { expect, test } from "bun:test";
import {
	construirComentarioGestionLinkPagalo,
	esLinkPagaloGenerado,
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

test("suma solo links Págalo emitidos", () => {
	expect(totalDeLinksPagalo([{ amount: "1307.40" }])).toBe("1307.40");
	expect(
		totalDeLinksPagalo([{ amount: "1307.40" }, { amount: "1197.41" }]),
	).toBe("2504.81");
});

test("solo links activos o pagados cuentan como emitidos", () => {
	expect(esLinkPagaloGenerado("ACTIVE")).toBe(true);
	expect(esLinkPagaloGenerado("PAID")).toBe(true);
	expect(esLinkPagaloGenerado("ERROR")).toBe(false);
});
