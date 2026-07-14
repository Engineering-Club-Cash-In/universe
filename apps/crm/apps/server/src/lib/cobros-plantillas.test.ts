import { describe, expect, test } from "bun:test";
import {
	COBROS_MOTIVO_SIN_TELEFONO_ASESOR,
	COBROS_NO_REPLY_WARNING,
	interpolar,
	PLANTILLAS_MENSAJES,
	prepararTelefonoAsesorParaEnvio,
} from "./cobros-plantillas";

const NO_REPLY_WARNING =
	"*NO RESPONDER EN ESTE CHAT, CONTESTAR AL NUMERO DE SU ASESOR DE COBROS*";
const CONFIRMATION_REQUEST_REGEX =
	/confirme la recepción|confirmar recepción|confirme recepcion/i;

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

	test("no indican responder por este chat cuando tienen aviso de no responder", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			expect(plantilla.cuerpo, plantilla.id).not.toMatch(
				/por este medio|por este chat|comunicarse por este medio/i,
			);
		}
	});

	test("no piden confirmar recepcion cuando tienen aviso de no responder", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			if (plantilla.cuerpo.includes(NO_REPLY_WARNING)) {
				expect(plantilla.cuerpo, plantilla.id).not.toMatch(
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

		expect(bienvenida?.cuerpo).toMatch(
			/boleta o comprobante de pago[^.]*{telefonoAsesor}/i,
		);
		expect(preMora?.cuerpo).toMatch(/duda[^.]*{telefonoAsesor}/i);
	});

	test("descarta plantillas no-reply sin telefono de asesor", () => {
		const cuerpo = PLANTILLAS_MENSAJES[0].cuerpo;

		for (const telefono of [null, undefined, "", "   "]) {
			expect(prepararTelefonoAsesorParaEnvio(cuerpo, telefono)).toEqual({
				enviar: false,
				motivo: COBROS_MOTIVO_SIN_TELEFONO_ASESOR,
			});
		}
	});

	test("recorta el telefono del asesor antes de interpolar", () => {
		const cuerpo = PLANTILLAS_MENSAJES[0].cuerpo;

		expect(prepararTelefonoAsesorParaEnvio(cuerpo, " 41286630 ")).toEqual({
			enviar: true,
			telefonoAsesor: "41286630",
		});
	});

	test("define el recordatorio de impuesto de circulación 2026", () => {
		const plantilla = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "impuesto_circulacion_2026",
		);

		expect(plantilla?.nombre).toBe("Impuesto de circulación 2026");
		expect(
			plantilla?.cuerpo,
		).toBe(`Estimado(a) {clienteNombre}, buen día, cordialmente le saludamos de Clubcashin para recordarle sobre el pago del impuesto de circulación del año 2026.

Envíanos tu comprobante a tiempo para que podamos procesar y enviarte tus distintivos sin contratiempos.

¡No lo dejes para última hora!

${COBROS_NO_REPLY_WARNING}

Atentamente,
{nombreAsesor}
Tel: {telefonoAsesor}`);
	});

	test("interpola el recordatorio de impuesto con los datos del cliente y asesor", () => {
		const plantilla = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "impuesto_circulacion_2026",
		);
		const mensaje = interpolar(plantilla?.cuerpo ?? "", {
			clienteNombre: "MARIA LOPEZ",
			fechaPago: "",
			cuotaMensual: "",
			placa: "",
			marcaLineaModelo: "",
			montoAdeudado: "",
			cuotasAtraso: 0,
			telefonoAsesor: "41286630",
			nombreAsesor: "Carlos Pérez",
		});

		expect(mensaje).toContain("Estimado(a) Maria Lopez");
		expect(mensaje).toContain("Atentamente,\nCarlos Pérez\nTel: 41286630");
		expect(mensaje.match(/NO RESPONDER EN ESTE CHAT/g)?.length).toBe(1);
	});

	test("conserva los cinco párrafos del contrato SimpleTech para impuesto de circulación", () => {
		const plantilla = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "impuesto_circulacion_2026",
		);
		const paragraphs = (plantilla?.cuerpo ?? "")
			.split(/\n\s*\n/g)
			.map((paragraph) => paragraph.trim())
			.filter(Boolean);

		expect(paragraphs).toHaveLength(5);
		expect(paragraphs.slice(3).join("\n\n")).toBe(
			`${COBROS_NO_REPLY_WARNING}\n\nAtentamente,\n{nombreAsesor}\nTel: {telefonoAsesor}`,
		);
	});
});
