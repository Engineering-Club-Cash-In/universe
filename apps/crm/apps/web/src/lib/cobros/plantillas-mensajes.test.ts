import { describe, expect, test } from "bun:test";
import {
	accionUsaCuerpoNoReply,
	anioImpuestoCirculacion,
	COBROS_MOTIVO_SIN_TELEFONO_ASESOR,
	COBROS_NO_REPLY_WARNING,
	crearUrlWhatsappManual,
	cuerpoParaValidarNoReply,
	fechaLimiteImpuestoCirculacion,
	fechaLimiteImpuestoVencida,
	interpolar,
	mensajeEmailEditable,
	mensajePlantillaEditable,
	mensajeSmsEditable,
	PLANTILLAS_MENSAJES,
	plantillaRequiereExpectativaMora,
	plantillaUsaFechaLimiteImpuesto,
	prepararTelefonoAsesorParaEnvio,
} from "./plantillas-mensajes";

const NO_REPLY_WARNING =
	"⚠️ Este número es únicamente para el envío de notificaciones automáticas. Por favor, no respondas a este número.";

// La bienvenida es la única plantilla sin aviso no-reply: pide confirmar la
// recepción del mensaje (diseño "Mensajes Cobros 2026").
const IDS_SIN_AVISO = new Set(["bienvenida"]);

const MAX_PARAMS_SIMPLETECH = 5;

function bloques(cuerpo: string): string[] {
	return cuerpo
		.split(/\n\s*\n/g)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);
}

function cuerpoWhatsappDe(plantilla: {
	cuerpo: string;
	cuerpoWhastapp?: string;
}): string {
	return plantilla.cuerpoWhastapp ?? plantilla.cuerpo;
}

describe("plantillas web de cobros", () => {
	test("incluyen el aviso de no responder en el cuerpo de WhatsApp (salvo bienvenida)", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			const cuerpoWhatsapp = cuerpoWhatsappDe(plantilla);
			const matches = Array.from(
				cuerpoWhatsapp.matchAll(
					/Este número es únicamente para el envío de notificaciones automáticas/g,
				),
			);

			if (IDS_SIN_AVISO.has(plantilla.id)) {
				expect(matches.length, plantilla.id).toBe(0);
			} else {
				expect(matches.length, plantilla.id).toBe(1);
				expect(cuerpoWhatsapp, plantilla.id).toContain(NO_REPLY_WARNING);
			}
		}
	});

	test("cierran con el aviso no-reply y la firma CashIn en el último bloque", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			if (IDS_SIN_AVISO.has(plantilla.id)) continue;
			// aviso_juridico no entró al rediseño 2026: cierra con los números de
			// contacto jurídico, el aviso va en el bloque anterior.
			if (plantilla.id === "aviso_juridico") continue;

			const ultimoBloque = bloques(cuerpoWhatsappDe(plantilla)).at(-1) ?? "";
			expect(ultimoBloque, plantilla.id).toContain(NO_REPLY_WARNING);
			expect(ultimoBloque.endsWith("CashIn"), plantilla.id).toBe(true);
		}
	});

	test("el cuerpo de email no lleva el aviso no-reply de WhatsApp", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			expect(plantilla.cuerpo, plantilla.id).not.toContain(NO_REPLY_WARNING);
		}
	});

	test("no indican responder por este chat cuando tienen aviso de no responder", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			if (IDS_SIN_AVISO.has(plantilla.id)) continue;

			expect(cuerpoWhatsappDe(plantilla), plantilla.id).not.toMatch(
				/por este medio|por este chat|comunicarse por este medio/i,
			);
		}
	});

	test("no piden confirmar recepcion cuando tienen aviso de no responder", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			const cuerpoWhatsapp = cuerpoWhatsappDe(plantilla);

			if (cuerpoWhatsapp.includes(NO_REPLY_WARNING)) {
				expect(cuerpoWhatsapp, plantilla.id).not.toMatch(
					/confirme la recepción|confirmar recepción|confirme recepcion|confirmar la recepción/i,
				);
			}
		}
	});

	test("las plantillas con aviso dirigen al telefono del asesor", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			if (IDS_SIN_AVISO.has(plantilla.id)) continue;

			expect(cuerpoWhatsappDe(plantilla), plantilla.id).toContain(
				"{telefonoAsesor}",
			);
		}
	});

	test("ninguna plantilla de WhatsApp excede los parámetros de SimpleTech", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			expect(
				bloques(cuerpoWhatsappDe(plantilla)).length,
				plantilla.id,
			).toBeLessThanOrEqual(MAX_PARAMS_SIMPLETECH);
		}
	});

	test("la bienvenida usa los 5 bloques del template mensaje5parametro", () => {
		const bienvenida = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "bienvenida",
		);

		expect(
			bloques(cuerpoWhatsappDe(bienvenida ?? { cuerpo: "" })),
		).toHaveLength(5);
		expect(bienvenida?.cuerpoWhastapp).toContain("{aseguradora}");
		expect(bienvenida?.cuerpoWhastapp).toContain("{cabinaSeguro}");
		expect(bienvenida?.cuerpoWhastapp).toMatch(/confirmar la recepción/i);
	});

	test("el recordatorio del día de pago usa la expectativa de mora del server", () => {
		const alDia = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "al_dia",
		);

		// El monto lo calcula el server (capital × 1.12%, misma fórmula que
		// procesarMoras en cartera-back) y llega por getDetallesCreditoCarteraBack.
		expect(alDia?.cuerpoWhastapp).toContain(
			"se agregará un recargo por mora de Q{expectativaMora}.",
		);
		expect(alDia?.cuerpo).toContain(
			"se agregará un recargo por mora de Q{expectativaMora}.",
		);
	});

	test("crea links manuales de WhatsApp con el cuerpo de WhatsApp", () => {
		const url = crearUrlWhatsappManual(
			"50241286630",
			"Mensaje WhatsApp no-reply",
			"Mensaje email por este medio",
		);
		const text = new URL(url).searchParams.get("text");

		expect(text).toBe("Mensaje WhatsApp no-reply");
	});

	test("edita el cuerpo visible que usa WhatsApp", () => {
		expect(
			mensajePlantillaEditable(
				"whatsapp",
				"Mensaje email por este medio",
				"Mensaje WhatsApp no-reply",
			),
		).toBe("Mensaje WhatsApp no-reply");
	});

	test("respeta mensajes de WhatsApp vacios editados manualmente", () => {
		expect(mensajePlantillaEditable("whatsapp", "Mensaje fallback", "")).toBe(
			"",
		);
	});

	test("envia por SMS el mensaje visible cuando se edita desde WhatsApp", () => {
		expect(
			mensajeSmsEditable(
				"whatsapp",
				"Mensaje email largo oculto",
				"Mensaje visible editado",
			),
		).toBe("Mensaje visible editado");
	});

	test("envia por Email el mensaje visible cuando se edita desde WhatsApp", () => {
		expect(
			mensajeEmailEditable(
				"whatsapp",
				"Mensaje email largo oculto",
				"Mensaje visible editado",
			),
		).toBe("Mensaje visible editado");
	});

	test("bloquea todos los envios que usan cuerpo no-reply sin telefono de asesor", () => {
		expect(accionUsaCuerpoNoReply("whatsapp-link")).toBe(true);
		expect(accionUsaCuerpoNoReply("whatsapp-api")).toBe(true);
		expect(accionUsaCuerpoNoReply("sms-api")).toBe(true);
		expect(accionUsaCuerpoNoReply("email-link")).toBe(true);
		expect(accionUsaCuerpoNoReply("email-api")).toBe(true);
	});

	test("valida no-reply contra el cuerpo real de SMS", () => {
		expect(
			cuerpoParaValidarNoReply(
				"sms-api",
				`Mensaje WhatsApp oculto ${NO_REPLY_WARNING}`,
				"Mensaje SMS seguro",
			),
		).toBe("Mensaje SMS seguro");
	});

	test("valida no-reply contra el cuerpo real de Email", () => {
		expect(
			cuerpoParaValidarNoReply(
				"email-api",
				`Mensaje WhatsApp oculto ${NO_REPLY_WARNING}`,
				"Mensaje SMS seguro",
				"Mensaje Email seguro",
			),
		).toBe("Mensaje Email seguro");
	});

	test("descarta plantillas no-reply sin telefono de asesor", () => {
		const conAviso = PLANTILLAS_MENSAJES.find(
			(plantilla) => !IDS_SIN_AVISO.has(plantilla.id),
		);
		const cuerpoWhatsapp = cuerpoWhatsappDe(conAviso ?? { cuerpo: "" });

		for (const telefono of [null, undefined, "", "   "]) {
			expect(prepararTelefonoAsesorParaEnvio(cuerpoWhatsapp, telefono)).toEqual(
				{
					enviar: false,
					motivo: COBROS_MOTIVO_SIN_TELEFONO_ASESOR,
				},
			);
		}
	});

	test("la bienvenida (sin aviso) se envía aunque el asesor no tenga telefono", () => {
		const bienvenida = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "bienvenida",
		);

		expect(
			prepararTelefonoAsesorParaEnvio(
				cuerpoWhatsappDe(bienvenida ?? { cuerpo: "" }),
				null,
			),
		).toEqual({ enviar: true, telefonoAsesor: "" });
	});

	test("recorta el telefono del asesor antes de interpolar", () => {
		const conAviso = PLANTILLAS_MENSAJES.find(
			(plantilla) => !IDS_SIN_AVISO.has(plantilla.id),
		);

		expect(
			prepararTelefonoAsesorParaEnvio(
				cuerpoWhatsappDe(conAviso ?? { cuerpo: "" }),
				" 41286630 ",
			),
		).toEqual({
			enviar: true,
			telefonoAsesor: "41286630",
		});
	});

	test("muestra el recordatorio de impuesto de circulación con sus variables", () => {
		const plantilla = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "impuesto_circulacion_2026",
		);
		const cuerpoWhatsapp = cuerpoWhatsappDe(plantilla ?? { cuerpo: "" });
		const mensaje = interpolar(cuerpoWhatsapp, {
			clienteNombre: "MARIA LOPEZ",
			fechaPago: "",
			cuotaMensual: "",
			placa: "",
			marcaLineaModelo: "",
			montoAdeudado: "",
			cuotasAtraso: 0,
			telefonoAsesor: "41286630",
			nombreAsesor: "Carlos Pérez",
			expectativaMora: "",
		});

		expect(plantilla?.nombre).toBe("Impuesto de circulación");
		// El año y la fecha límite se calculan al interpolar (año vigente en
		// Guatemala) para que la plantilla no quede vencida de un año al otro.
		expect(mensaje).toContain(
			`Impuesto de Circulación ${anioImpuestoCirculacion()}.`,
		);
		expect(mensaje).toContain(
			`⏰ Fecha límite: ${fechaLimiteImpuestoCirculacion()} a las 5:00 p.m.`,
		);
		expect(mensaje).toContain("Carlos Pérez - Asesor de Cobros\n41286630");
		expect(mensaje.match(/notificaciones automáticas/g)?.length).toBe(1);
		expect(cuerpoWhatsapp).toContain(COBROS_NO_REPLY_WARNING);
	});

	test("calcula la fecha límite del impuesto con el año actual de Guatemala", () => {
		expect(anioImpuestoCirculacion(new Date("2027-03-15T12:00:00Z"))).toBe(
			"2027",
		);
		// 1 de enero 02:00 UTC = 31 de diciembre del año anterior en GT (UTC-6).
		expect(anioImpuestoCirculacion(new Date("2027-01-01T02:00:00Z"))).toBe(
			"2026",
		);
		expect(
			fechaLimiteImpuestoCirculacion(new Date("2027-03-15T12:00:00Z")),
		).toBe("31/07/2027");
	});

	test("identifica las plantillas que requieren expectativa de mora", () => {
		const porId = (id: string) =>
			PLANTILLAS_MENSAJES.find((plantilla) => plantilla.id === id);

		// Solo el recordatorio del día de pago usa {expectativaMora}; el modal
		// bloquea su envío cuando el server no pudo calcularla (sin capital).
		expect(plantillaRequiereExpectativaMora(porId("al_dia")!)).toBe(true);
		expect(plantillaRequiereExpectativaMora(porId("bienvenida")!)).toBe(false);
		expect(plantillaRequiereExpectativaMora(porId("mora_30")!)).toBe(false);
	});

	test("identifica la plantilla del impuesto y su fecha límite vencida", () => {
		const porId = (id: string) =>
			PLANTILLAS_MENSAJES.find((plantilla) => plantilla.id === id);

		expect(
			plantillaUsaFechaLimiteImpuesto(porId("impuesto_circulacion_2026")!),
		).toBe(true);
		expect(plantillaUsaFechaLimiteImpuesto(porId("bienvenida")!)).toBe(false);
		expect(plantillaUsaFechaLimiteImpuesto(porId("al_dia")!)).toBe(false);

		// El mismo 31/07 en GT todavía se envía; del 1 de agosto en adelante no.
		expect(fechaLimiteImpuestoVencida(new Date("2026-05-15T12:00:00Z"))).toBe(
			false,
		);
		expect(fechaLimiteImpuestoVencida(new Date("2026-08-01T02:00:00Z"))).toBe(
			false,
		);
		expect(fechaLimiteImpuestoVencida(new Date("2026-08-01T18:00:00Z"))).toBe(
			true,
		);
	});

	test("el bloque del seguro de la bienvenida se interpola por aseguradora", () => {
		const bienvenida = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "bienvenida",
		);
		const base = {
			clienteNombre: "MARIA LOPEZ",
			fechaPago: "5",
			cuotaMensual: "2,500.00",
			placa: "",
			marcaLineaModelo: "",
			montoAdeudado: "",
			cuotasAtraso: 0,
			telefonoAsesor: "41286630",
			nombreAsesor: "Carlos Pérez",
			expectativaMora: "",
		};

		// Sin datos del server cae al default Universales.
		const mensajeDefault = interpolar(bienvenida?.cuerpoWhastapp ?? "", base);
		expect(mensajeDefault).toContain("a través de Seguros Universales.");
		expect(mensajeDefault).toContain("cabina de emergencia al 2384-7400,");

		// Con los datos que manda getDetallesCreditoCarteraBack sale G&T.
		const mensajeGyt = interpolar(bienvenida?.cuerpoWhastapp ?? "", {
			...base,
			aseguradora: "Seguro GYT",
			cabinaSeguro: "1778",
		});
		expect(mensajeGyt).toContain("a través de Seguro GYT.");
		expect(mensajeGyt).toContain("cabina de emergencia al 1778,");
	});
});
