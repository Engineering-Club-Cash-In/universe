import { describe, expect, it } from "bun:test";
import {
	contactoDeGestion,
	etiquetaCanalGestion,
	horaCorta,
	textoParticipanteGestion,
	textoProximoContacto,
} from "./gestion-contacto";

describe("etiquetaCanalGestion", () => {
	it("marca la entrante", () => {
		expect(
			etiquetaCanalGestion({
				metodoContacto: "llamada",
				direccionContacto: "entrante",
			}),
		).toBe("Llamada entrante");
		expect(
			etiquetaCanalGestion({
				metodoContacto: "whatsapp",
				direccionContacto: "entrante",
			}),
		).toBe("WhatsApp entrante");
	});
	it("saliente o sin dato: el canal de siempre", () => {
		expect(
			etiquetaCanalGestion({
				metodoContacto: "llamada",
				direccionContacto: "saliente",
			}),
		).toBe("Llamada");
		expect(etiquetaCanalGestion({ metodoContacto: "visita_domicilio" })).toBe(
			"Visita a domicilio",
		);
	});
});

describe("textoParticipanteGestion", () => {
	it("con nombre y rol", () => {
		expect(
			textoParticipanteGestion({
				participanteTipo: "codeudor",
				participanteNombre: " Juan Pérez ",
				estadoContacto: "contactado",
			}),
		).toBe("Habló con: Juan Pérez (codeudor)");
	});
	it("sin conversación no dice «Habló con»", () => {
		expect(
			textoParticipanteGestion({
				participanteTipo: "titular",
				participanteNombre: "Ana",
				estadoContacto: "no_contesta",
			}),
		).toBe("Intentó con: Ana (titular)");
		expect(
			textoParticipanteGestion({
				participanteTipo: "titular",
				participanteNombre: "Ana",
				estadoContacto: "mensaje_enviado",
			}),
		).toBe("Mensaje a: Ana (titular)");
	});
	it("solo el rol, o nada", () => {
		expect(
			textoParticipanteGestion({
				participanteTipo: "referencia",
				estadoContacto: "contactado",
			}),
		).toBe("Habló con: Referencia");
		expect(textoParticipanteGestion({ estadoContacto: "contactado" })).toBe(
			null,
		);
	});
});

describe("contactoDeGestion", () => {
	it("null si la gestión no guardó participante ni teléfono", () => {
		expect(contactoDeGestion({ metodoContacto: "llamada" })).toBe(null);
	});
	it("devuelve el teléfono aunque no haya participante", () => {
		expect(contactoDeGestion({ telefonoContactado: " 5555 1234 " })).toEqual({
			participante: null,
			telefono: "5555 1234",
		});
	});
});

describe("textoProximoContacto", () => {
	it("fecha, hora y medio", () => {
		expect(
			textoProximoContacto({
				fechaProximoContacto: "2026-10-15",
				horaProximoContacto: "10:30:00",
				medioProximoContacto: "whatsapp",
			}),
		).toBe("15 oct 2026 · 10:30 · por WhatsApp");
	});
	it("solo la fecha", () => {
		expect(textoProximoContacto({ fechaProximoContacto: "2026-10-15" })).toBe(
			"15 oct 2026",
		);
	});
	it("nada", () => {
		expect(textoProximoContacto({})).toBe(null);
		expect(horaCorta("25:00")).toBe(null);
	});
});
