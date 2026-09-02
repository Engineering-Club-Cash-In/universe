import { describe, expect, test } from "bun:test";
import {
	COBROS_MOTIVO_SIN_TELEFONO_ASESOR,
	COBROS_NO_REPLY_WARNING,
	calcularExpectativaMora,
	interpolar,
	PLANTILLAS_MENSAJES,
	prepararTelefonoAsesorParaEnvio,
} from "./cobros-plantillas";

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

describe("plantillas masivas de cobros", () => {
	test("incluyen el aviso de no responder exactamente una vez (salvo bienvenida)", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			const matches = Array.from(
				plantilla.cuerpo.matchAll(
					/Este número es únicamente para el envío de notificaciones automáticas/g,
				),
			);

			if (IDS_SIN_AVISO.has(plantilla.id)) {
				expect(matches.length, plantilla.id).toBe(0);
			} else {
				expect(matches.length, plantilla.id).toBe(1);
				expect(plantilla.cuerpo, plantilla.id).toContain(NO_REPLY_WARNING);
			}
		}
	});

	test("cierran con el aviso no-reply y la firma CashIn en el último bloque", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			if (IDS_SIN_AVISO.has(plantilla.id)) continue;
			// aviso_juridico no entró al rediseño 2026: cierra con los números de
			// contacto jurídico, el aviso va en el bloque anterior.
			if (plantilla.id === "aviso_juridico") continue;

			const ultimoBloque = bloques(plantilla.cuerpo).at(-1) ?? "";
			expect(ultimoBloque, plantilla.id).toContain(NO_REPLY_WARNING);
			expect(ultimoBloque.endsWith("CashIn"), plantilla.id).toBe(true);
		}
	});

	test("no indican responder por este chat cuando tienen aviso de no responder", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			if (IDS_SIN_AVISO.has(plantilla.id)) continue;

			expect(plantilla.cuerpo, plantilla.id).not.toMatch(
				/por este medio|por este chat|comunicarse por este medio/i,
			);
		}
	});

	test("no piden confirmar recepcion cuando tienen aviso de no responder", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			if (plantilla.cuerpo.includes(NO_REPLY_WARNING)) {
				expect(plantilla.cuerpo, plantilla.id).not.toMatch(
					/confirme la recepción|confirmar recepción|confirme recepcion|confirmar la recepción/i,
				);
			}
		}
	});

	test("las plantillas con aviso dirigen al telefono del asesor", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			if (IDS_SIN_AVISO.has(plantilla.id)) continue;

			expect(plantilla.cuerpo, plantilla.id).toContain("{telefonoAsesor}");
		}
	});

	test("ninguna plantilla excede los parámetros que soporta SimpleTech", () => {
		for (const plantilla of PLANTILLAS_MENSAJES) {
			expect(
				bloques(plantilla.cuerpo).length,
				plantilla.id,
			).toBeLessThanOrEqual(MAX_PARAMS_SIMPLETECH);
		}
	});

	test("la bienvenida usa los 5 bloques del template mensaje5parametro", () => {
		const bienvenida = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "bienvenida",
		);

		expect(bloques(bienvenida?.cuerpo ?? "")).toHaveLength(5);
		expect(bienvenida?.cuerpo).toContain("Seguros Universales");
		expect(bienvenida?.cuerpo).toMatch(/confirmar la recepción/i);
	});

	test("descarta plantillas no-reply sin telefono de asesor", () => {
		const conAviso = PLANTILLAS_MENSAJES.find(
			(plantilla) => !IDS_SIN_AVISO.has(plantilla.id),
		);

		for (const telefono of [null, undefined, "", "   "]) {
			expect(
				prepararTelefonoAsesorParaEnvio(conAviso?.cuerpo ?? "", telefono),
			).toEqual({
				enviar: false,
				motivo: COBROS_MOTIVO_SIN_TELEFONO_ASESOR,
			});
		}
	});

	test("la bienvenida (sin aviso) se envía aunque el asesor no tenga telefono", () => {
		const bienvenida = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "bienvenida",
		);

		expect(
			prepararTelefonoAsesorParaEnvio(bienvenida?.cuerpo ?? "", null),
		).toEqual({ enviar: true, telefonoAsesor: "" });
	});

	test("recorta el telefono del asesor antes de interpolar", () => {
		const conAviso = PLANTILLAS_MENSAJES.find(
			(plantilla) => !IDS_SIN_AVISO.has(plantilla.id),
		);

		expect(
			prepararTelefonoAsesorParaEnvio(conAviso?.cuerpo ?? "", " 41286630 "),
		).toEqual({
			enviar: true,
			telefonoAsesor: "41286630",
		});
	});

	test("define el recordatorio de impuesto de circulación 2026", () => {
		const plantilla = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "impuesto_circulacion_2026",
		);

		expect(plantilla?.nombre).toBe("Impuesto de circulación 2026");
		expect(plantilla?.cuerpo).toBe(`Hola 👋
Te recordamos realizar el pago de tu Impuesto de Circulación 2026.
⏰ Fecha límite: 31/07/2026 a las 5:00 p.m.

🛑 En caso de no realizar el pago, CashIn lo realizará y te cobrará las multas y gastos administrativos adicionales.

✅ Al realizar el pago, comparte el comprobante con tu asesor antes de la hora límite:
{nombreAsesor} - Asesor de Cobros
{telefonoAsesor}

${COBROS_NO_REPLY_WARNING}
CashIn`);
		expect(bloques(plantilla?.cuerpo ?? "")).toHaveLength(4);
	});

	test("interpola las plantillas con los datos del cliente y asesor", () => {
		const plantilla = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "mora_30",
		);
		const mensaje = interpolar(plantilla?.cuerpo ?? "", {
			clienteNombre: "MARIA LOPEZ",
			fechaPago: "5",
			cuotaMensual: "2500",
			placa: "",
			marcaLineaModelo: "",
			montoAdeudado: "2,528.00",
			cuotasAtraso: 1,
			telefonoAsesor: "41286630",
			nombreAsesor: "Carlos Pérez",
			expectativaMora: "",
		});

		expect(mensaje).toContain("Hola Maria Lopez");
		expect(mensaje).toContain("por un monto de Q2,528.00");
		expect(mensaje).toContain("Carlos Pérez - Asesor de Cobros\n41286630");
		expect(mensaje.match(/notificaciones automáticas/g)?.length).toBe(1);
	});

	test("calcula la expectativa de mora con la fórmula de procesarMoras (capital × 1.12%)", () => {
		// Mismos números que el job de cartera-back: capital × 0.0112, half-up a
		// 2 decimales. 45000 × 0.0112 = 504.00; 123456.78 × 0.0112 = 1382.72.
		expect(calcularExpectativaMora("45000.00")).toBe("504.00");
		expect(calcularExpectativaMora("123456.78")).toBe("1,382.72");
		// Sin capital no aplica mora (igual que el job) → sin monto.
		expect(calcularExpectativaMora("0.00")).toBe("");
		expect(calcularExpectativaMora(null)).toBe("");
		expect(calcularExpectativaMora(undefined)).toBe("");
		expect(calcularExpectativaMora("no-numerico")).toBe("");
	});

	test("el recordatorio del día de pago interpola la expectativa de mora", () => {
		const alDia = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "al_dia",
		);

		expect(alDia?.cuerpo).toContain(
			"se agregará un recargo por mora de Q{expectativaMora}.",
		);

		const mensaje = interpolar(alDia?.cuerpo ?? "", {
			clienteNombre: "MARIA LOPEZ",
			fechaPago: "5",
			cuotaMensual: "2,500.00",
			placa: "",
			marcaLineaModelo: "",
			montoAdeudado: "",
			cuotasAtraso: 0,
			telefonoAsesor: "41286630",
			nombreAsesor: "Carlos Pérez",
			expectativaMora: calcularExpectativaMora("45000.00"),
		});

		expect(mensaje).toContain("un recargo por mora de Q504.00.");
	});
});
