import { describe, expect, test } from "bun:test";
import { PLANTILLAS_MENSAJES } from "./cobros-plantillas";

const NO_REPLY_WARNING =
	"*NO RESPONDER EN ESTE CHAT, CONTESTAR AL NUMERO DE SU ASESOR DE COBROS*";

describe("plantillas masivas de cobros", () => {
	test("incluyen el aviso de no responder exactamente una vez", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			const matches = plantilla.cuerpo.matchAll(
				/NO RESPONDER EN ESTE CHAT, CONTESTAR AL NUMERO DE SU ASESOR DE COBROS/g,
			);

			expect(Array.from(matches).length, plantilla.id).toBe(1);
			expect(plantilla.cuerpo, plantilla.id).toContain(NO_REPLY_WARNING);
		}
	});

	test("colocan el aviso antes de la firma cuando existe", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			const warningIndex = plantilla.cuerpo.indexOf(NO_REPLY_WARNING);
			const signatureIndex = plantilla.cuerpo.indexOf("Atentamente");

			if (signatureIndex !== -1) {
				expect(warningIndex, plantilla.id).toBeLessThan(signatureIndex);
			}
		}
	});
});
