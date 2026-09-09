import { expect, test } from "bun:test";
import { construirComentarioGestionLinkPagalo } from "./pagalo-gestion";

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
