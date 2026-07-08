import { describe, expect, test } from "bun:test";
import { PLANTILLAS_MENSAJES } from "./plantillas-mensajes";

const NO_REPLY_WARNING =
	"*NO RESPONDER EN ESTE CHAT, CONTESTAR AL NUMERO DE SU ASESOR DE COBROS*";

describe("plantillas web de cobros", () => {
	test("incluyen el aviso de no responder en el cuerpo de WhatsApp", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			const cuerpoWhatsapp = plantilla.cuerpoWhastapp ?? plantilla.cuerpo;
			const matches = cuerpoWhatsapp.matchAll(
				/NO RESPONDER EN ESTE CHAT, CONTESTAR AL NUMERO DE SU ASESOR DE COBROS/g,
			);

			expect(Array.from(matches).length, plantilla.id).toBe(1);
			expect(cuerpoWhatsapp, plantilla.id).toContain(NO_REPLY_WARNING);
		}
	});

	test("colocan el aviso antes de la firma cuando existe", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			const cuerpoWhatsapp = plantilla.cuerpoWhastapp ?? plantilla.cuerpo;
			const warningIndex = cuerpoWhatsapp.indexOf(NO_REPLY_WARNING);
			const signatureIndex = cuerpoWhatsapp.indexOf("Atentamente");

			if (signatureIndex !== -1) {
				expect(warningIndex, plantilla.id).toBeLessThan(signatureIndex);
			}
		}
	});
});
