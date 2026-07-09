import { describe, expect, test } from "bun:test";
import {
	COBROS_MOTIVO_SIN_TELEFONO_ASESOR,
	PLANTILLAS_MENSAJES,
	prepararTelefonoAsesorParaEnvio,
} from "./plantillas-mensajes";

const NO_REPLY_WARNING =
	"*NO RESPONDER EN ESTE CHAT, CONTESTAR AL NUMERO DE SU ASESOR DE COBROS*";
const CONFIRMATION_REQUEST_REGEX =
	/confirme la recepción|confirmar recepción|confirme recepcion/i;

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

	test("no indican responder por este chat cuando tienen aviso de no responder", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			const cuerpoWhatsapp = plantilla.cuerpoWhastapp ?? plantilla.cuerpo;

			expect(cuerpoWhatsapp, plantilla.id).not.toMatch(
				/por este medio|por este chat|comunicarse por este medio/i,
			);
		}
	});

	test("no piden confirmar recepcion cuando tienen aviso de no responder", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			const cuerpoWhatsapp = plantilla.cuerpoWhastapp ?? plantilla.cuerpo;

			if (cuerpoWhatsapp.includes(NO_REPLY_WARNING)) {
				expect(cuerpoWhatsapp, plantilla.id).not.toMatch(
					CONFIRMATION_REQUEST_REGEX,
				);
			}
		}
	});

	test("dirigen comprobantes y dudas al telefono del asesor", () => {
		const bienvenida = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "bienvenida",
		);
		const preMora = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "pre_mora",
		);

		expect(bienvenida?.cuerpoWhastapp).toMatch(
			/boleta o comprobante de pago[^.]*{telefonoAsesor}/i,
		);
		expect(preMora?.cuerpoWhastapp).toMatch(/duda[^.]*{telefonoAsesor}/i);
	});

	test("descarta plantillas no-reply sin telefono de asesor", () => {
		const cuerpoWhatsapp =
			PLANTILLAS_MENSAJES[0].cuerpoWhastapp ?? PLANTILLAS_MENSAJES[0].cuerpo;

		for (const telefono of [null, undefined, "", "   "]) {
			expect(prepararTelefonoAsesorParaEnvio(cuerpoWhatsapp, telefono)).toEqual({
				enviar: false,
				motivo: COBROS_MOTIVO_SIN_TELEFONO_ASESOR,
			});
		}
	});

	test("recorta el telefono del asesor antes de interpolar", () => {
		const cuerpoWhatsapp =
			PLANTILLAS_MENSAJES[0].cuerpoWhastapp ?? PLANTILLAS_MENSAJES[0].cuerpo;

		expect(prepararTelefonoAsesorParaEnvio(cuerpoWhatsapp, " 41286630 ")).toEqual({
			enviar: true,
			telefonoAsesor: "41286630",
		});
	});
});
