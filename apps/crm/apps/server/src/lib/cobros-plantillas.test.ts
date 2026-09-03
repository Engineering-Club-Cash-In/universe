import { describe, expect, test } from "bun:test";
import {
	anioImpuestoCirculacion,
	COBROS_MOTIVO_SIN_EXPECTATIVA_MORA,
	COBROS_MOTIVO_SIN_TELEFONO_ASESOR,
	COBROS_NO_REPLY_WARNING,
	calcularExpectativaMora,
	calcularMontoTotalAtraso,
	calcularMontoTotalAtrasoDesdeCuotas,
	contarCuotasAtrasadasUnicas,
	cuerpoUsaFechaLimiteImpuesto,
	fechaLimiteImpuestoCirculacion,
	fechaLimiteImpuestoVencida,
	interpolar,
	PLANTILLAS_MENSAJES,
	prepararExpectativaMoraParaEnvio,
	prepararTelefonoAsesorParaEnvio,
	seguroPorAseguradora,
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
			expect(ultimoBloque.endsWith("*CashIn*"), plantilla.id).toBe(true);
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
		expect(bienvenida?.cuerpo).toContain("{aseguradora}");
		expect(bienvenida?.cuerpo).toContain("{cabinaSeguro}");
		expect(bienvenida?.cuerpo).toMatch(/confirmar la recepción/i);
	});

	test("el bloque del seguro de la bienvenida se resuelve por aseguradora", () => {
		// opportunities.insurance_provider: "universales" | "gyt"; desconocidos y
		// vacíos caen al default Universales (el default de la columna).
		expect(seguroPorAseguradora("gyt")).toEqual({
			aseguradora: "Seguro GYT",
			cabinaSeguro: "1778",
		});
		expect(seguroPorAseguradora(" GYT ")).toEqual({
			aseguradora: "Seguro GYT",
			cabinaSeguro: "1778",
		});
		for (const valor of ["universales", null, undefined, "", "otra"]) {
			expect(seguroPorAseguradora(valor)).toEqual({
				aseguradora: "Seguros Universales",
				cabinaSeguro: "2384-7400",
			});
		}

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

		// Sin variables del seguro cae al default Universales.
		const mensajeDefault = interpolar(bienvenida?.cuerpo ?? "", base);
		expect(mensajeDefault).toContain("a través de Seguros Universales.*");
		expect(mensajeDefault).toContain("cabina de emergencia al 2384-7400*,");

		// Con la aseguradora de la opp sale la variante G&T, y sigue en 5 bloques.
		const mensajeGyt = interpolar(bienvenida?.cuerpo ?? "", {
			...base,
			...seguroPorAseguradora("gyt"),
		});
		expect(mensajeGyt).toContain("a través de Seguro GYT.*");
		expect(mensajeGyt).toContain("cabina de emergencia al 1778*,");
		expect(bloques(mensajeGyt)).toHaveLength(5);
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

	test("define el recordatorio de impuesto de circulación", () => {
		const plantilla = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "impuesto_circulacion_2026",
		);

		expect(plantilla?.nombre).toBe("Impuesto de circulación");
		expect(plantilla?.cuerpo).toBe(`Hola 👋
Te recordamos realizar el pago de tu *Impuesto de Circulación {anioImpuesto}*.
⏰ Fecha límite: *{fechaLimiteImpuesto} a las 5:00 p.m.*

🛑 *En caso de no realizar el pago, CashIn lo realizará y te cobrará las multas y gastos administrativos adicionales.*

✅ Al realizar el pago, comparte el comprobante con tu asesor antes de la hora límite:
*{nombreAsesor} - Asesor de Cobros*
{telefonoAsesor}

*${COBROS_NO_REPLY_WARNING}*
*CashIn*`);
		expect(bloques(plantilla?.cuerpo ?? "")).toHaveLength(4);
	});

	test("calcula la fecha límite del impuesto con el año actual de Guatemala", () => {
		// El año sale de la fecha en zona America/Guatemala (UTC-6): el 1 de
		// enero a las 02:00 UTC todavía es 31 de diciembre del año anterior en GT.
		expect(anioImpuestoCirculacion(new Date("2027-03-15T12:00:00Z"))).toBe(
			"2027",
		);
		expect(anioImpuestoCirculacion(new Date("2027-01-01T02:00:00Z"))).toBe(
			"2026",
		);
		expect(
			fechaLimiteImpuestoCirculacion(new Date("2027-03-15T12:00:00Z")),
		).toBe("31/07/2027");
	});

	test("interpola el impuesto con el año vigente sin fecha vencida hardcodeada", () => {
		const plantilla = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "impuesto_circulacion_2026",
		);
		const mensaje = interpolar(plantilla?.cuerpo ?? "", {
			clienteNombre: "",
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

		expect(mensaje).toContain(
			`Impuesto de Circulación ${anioImpuestoCirculacion()}*.`,
		);
		expect(mensaje).toContain(
			`⏰ Fecha límite: *${fechaLimiteImpuestoCirculacion()} a las 5:00 p.m.*`,
		);
		expect(mensaje).not.toContain("{anioImpuesto}");
		expect(mensaje).not.toContain("{fechaLimiteImpuesto}");
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
		expect(mensaje).toContain("Carlos Pérez - Asesor de Cobros*\n41286630");
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

	test("descarta el envío que usa expectativa de mora cuando el capital no la genera", () => {
		const alDia = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "al_dia",
		);

		// Sin capital válido no hay mora que anunciar → no se envía.
		for (const capital of [null, undefined, "0.00", "no-numerico"]) {
			expect(
				prepararExpectativaMoraParaEnvio(alDia?.cuerpo ?? "", capital),
			).toEqual({
				enviar: false,
				motivo: COBROS_MOTIVO_SIN_EXPECTATIVA_MORA,
			});
		}

		// Con capital sí, y entrega el monto ya calculado.
		expect(
			prepararExpectativaMoraParaEnvio(alDia?.cuerpo ?? "", "45000.00"),
		).toEqual({ enviar: true, expectativaMora: "504.00" });

		// Una plantilla que no usa la variable se envía aunque no haya capital.
		const mora30 = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "mora_30",
		);
		expect(
			prepararExpectativaMoraParaEnvio(mora30?.cuerpo ?? "", null),
		).toEqual({ enviar: true, expectativaMora: "" });
	});

	test("los estados que el job excluye de mora tampoco generan expectativa", () => {
		// Misma lista que STATUS_EXCLUIDOS_MORA del job procesarMoras en
		// cartera-back: en esos estados jamás se asigna recargo.
		const excluidos = [
			"EN_CONVENIO",
			"INCOBRABLE",
			"CANCELADO",
			"PENDIENTE_CANCELACION",
			"CAIDO",
		];
		const alDia = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "al_dia",
		);

		for (const status of excluidos) {
			expect(calcularExpectativaMora("45000.00", status)).toBe("");
			expect(
				prepararExpectativaMoraParaEnvio(
					alDia?.cuerpo ?? "",
					"45000.00",
					status,
				),
			).toEqual({
				enviar: false,
				motivo: COBROS_MOTIVO_SIN_EXPECTATIVA_MORA,
			});
		}

		// Estados que sí generan mora siguen calculando normal.
		for (const status of ["ACTIVO", "MOROSO", null, undefined]) {
			expect(calcularExpectativaMora("45000.00", status)).toBe("504.00");
		}
	});

	test("la plantilla del impuesto no se envía después de la fecha límite", () => {
		const impuesto = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "impuesto_circulacion_2026",
		);

		expect(cuerpoUsaFechaLimiteImpuesto(impuesto?.cuerpo ?? "")).toBe(true);
		expect(
			cuerpoUsaFechaLimiteImpuesto(
				PLANTILLAS_MENSAJES.find((p) => p.id === "al_dia")?.cuerpo ?? "",
			),
		).toBe(false);

		// El corte es el 31/07 a las 17:00 de Guatemala (UTC-6), la hora que
		// dice el mensaje. 2026-07-31T18:00Z = 12:00 GT y T22:59Z = 16:59 GT →
		// aún se envía; T23:00Z = 17:00 GT → ya venció; 2026-08-01T02:00Z sigue
		// siendo 31/07 (20:00 GT) pero ya pasó la hora → vencido.
		expect(fechaLimiteImpuestoVencida(new Date("2026-05-15T12:00:00Z"))).toBe(
			false,
		);
		expect(fechaLimiteImpuestoVencida(new Date("2026-07-31T18:00:00Z"))).toBe(
			false,
		);
		expect(fechaLimiteImpuestoVencida(new Date("2026-07-31T22:59:00Z"))).toBe(
			false,
		);
		expect(fechaLimiteImpuestoVencida(new Date("2026-07-31T23:00:00Z"))).toBe(
			true,
		);
		expect(fechaLimiteImpuestoVencida(new Date("2026-08-01T02:00:00Z"))).toBe(
			true,
		);
		expect(fechaLimiteImpuestoVencida(new Date("2026-08-01T18:00:00Z"))).toBe(
			true,
		);
		expect(fechaLimiteImpuestoVencida(new Date("2026-12-01T12:00:00Z"))).toBe(
			true,
		);
	});

	test("la notificación de 2-3 cuotas usa el total con todas las cuotas vencidas", () => {
		// cuotas atrasadas × cuota + mora (misma regla que el total de la promesa
		// de pago). 2 × 1000 + 100 = 2100 — no 1100 como daría mora + 1 cuota.
		expect(calcularMontoTotalAtraso(2, "1000.00", "100.00")).toBe("2,100.00");
		expect(calcularMontoTotalAtraso(3, 1832.69, 0)).toBe("5,498.07");
		// Sin cuotas atrasadas (o datos inválidos) no hay total que anunciar.
		expect(calcularMontoTotalAtraso(0, "1000.00", "100.00")).toBe("");
		expect(calcularMontoTotalAtraso(null, "1000.00", "100.00")).toBe("");
		expect(calcularMontoTotalAtraso(2, "no-numerico", "0")).toBe("");

		const mora60 = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "mora_60",
		);
		expect(mora60?.cuerpo).toContain(
			"por un monto total de Q{montoTotalAtraso}",
		);
		expect(mora60?.cuerpo).not.toContain("{montoAdeudado}");

		// mora_30 ("1 cuota con atraso") sigue con montoAdeudado (mora + 1 cuota).
		const mora30 = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "mora_30",
		);
		expect(mora30?.cuerpo).toContain("Q{montoAdeudado}");
	});

	test("el total del detalle resta los pagos parciales y no duplica cuotas con varias filas de pago", () => {
		// Filas tal como llegan de getCredito: una por par cuota-pago (leftJoin).
		// Cuota 5 sin pagos; cuota 6 con un abono parcial validated de Q600 y
		// una fila pending de Q100 (los pending cuentan, como en cartera).
		const filas = [
			{ numero_cuota: 5, paymentFalse: null, validationStatus: null },
			{
				numero_cuota: 6,
				paymentFalse: false,
				validationStatus: "validated",
				abono_capital: "400.00",
				abono_interes: "150.00",
				abono_iva_12: "18.00",
				abono_seguro: "20.00",
				abono_gps: "12.00",
				membresias_pago: "0.00",
			},
			{
				numero_cuota: 6,
				paymentFalse: false,
				validationStatus: "pending",
				abono_capital: "100.00",
			},
		];

		// 2 cuotas únicas aunque hay 3 filas.
		expect(contarCuotasAtrasadasUnicas(filas)).toBe(2);
		// Cuota 5: 1000 completa. Cuota 6: 1000 − (600 + 100) = 300. + mora 50.
		expect(calcularMontoTotalAtrasoDesdeCuotas(filas, "1000.00", "50.00")).toBe(
			"1,350.00",
		);

		// Pagos NO vivos no cubren nada: paymentFalse=true, rejected, o abonos a
		// capital (validationStatus "capital"), igual que calcularCoberturaCuota.
		const noVivos = [
			{
				numero_cuota: 7,
				paymentFalse: true,
				validationStatus: "validated",
				abono_capital: "1000.00",
			},
			{
				numero_cuota: 7,
				paymentFalse: false,
				validationStatus: "rejected",
				abono_capital: "1000.00",
			},
			{
				numero_cuota: 7,
				paymentFalse: false,
				validationStatus: "capital",
				abono_capital: "1000.00",
			},
		];
		expect(calcularMontoTotalAtrasoDesdeCuotas(noVivos, "1000.00", "0")).toBe(
			"1,000.00",
		);

		// monto_aplicado / mora / otros no son rubros de la cuota: no descuentan.
		const soloMora = [
			{
				numero_cuota: 8,
				paymentFalse: false,
				validationStatus: "validated",
				monto_aplicado: "999.00",
				pago_mora: "999.00",
			},
		];
		expect(calcularMontoTotalAtrasoDesdeCuotas(soloMora, "1000.00", "0")).toBe(
			"1,000.00",
		);

		// Sobrepago en una cuota no genera saldo negativo que reste a las demás.
		const sobrepago = [
			{
				numero_cuota: 9,
				paymentFalse: false,
				validationStatus: "validated",
				abono_capital: "1500.00",
			},
			{ numero_cuota: 10, paymentFalse: null, validationStatus: null },
		];
		expect(calcularMontoTotalAtrasoDesdeCuotas(sobrepago, "1000.00", "0")).toBe(
			"1,000.00",
		);

		// Sin cuotas no hay total que anunciar.
		expect(calcularMontoTotalAtrasoDesdeCuotas([], "1000.00", "50.00")).toBe(
			"",
		);
	});
});
