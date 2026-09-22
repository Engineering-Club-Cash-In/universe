import { describe, expect, test } from "bun:test";
import {
	accionUsaCuerpoNoReply,
	anioImpuestoCirculacion,
	CLAUSULA_INCREMENTO_DIARIO_MORA,
	COBROS_MOTIVO_SIN_TELEFONO_ASESOR,
	COBROS_NO_REPLY_WARNING,
	crearUrlWhatsappManual,
	cuerpoParaValidarNoReply,
	FRAGMENTO_EXPECTATIVA_MORA,
	FRAGMENTO_TOPE_INCREMENTO_MORA,
	fechaLimiteImpuestoCirculacion,
	fechaLimiteImpuestoVencida,
	hayIncrementoMora,
	interpolar,
	mensajeAnunciaExpectativaMora,
	mensajeAnunciaIncrementoMoraSinDato,
	mensajeAnunciaMontoAdeudado,
	mensajeEmailEditable,
	mensajePlantillaEditable,
	mensajeSmsEditable,
	mensajeTieneFechaLimiteImpuestoVencida,
	PLANTILLAS_MENSAJES,
	prepararTelefonoAsesorParaEnvio,
	sugerirPlantilla,
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
			expect(ultimoBloque.endsWith("*CashIn*"), plantilla.id).toBe(true);
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

	test("el recordatorio del día de pago anuncia la mora proporcional del server", () => {
		const alDia = PLANTILLAS_MENSAJES.find(
			(plantilla) => plantilla.id === "al_dia",
		);
		const oracion =
			"se agregará un recargo por mora de Q{expectativaMoraDiaria} por cada día de atraso, hasta un máximo de Q{expectativaMora} al mes.";

		// Los dos montos los calcula el server con la misma fórmula proporcional
		// que procesarMoras en cartera-back y llegan por
		// getDetallesCreditoCarteraBack: lo que suma cada día y el tope de la
		// cuota. WhatsApp lleva la oración entera en negrita (como el deck); el
		// email, la misma oración sin asteriscos.
		expect(alDia?.cuerpoWhastapp).toContain(
			`🛑 *Si no realizas tu pago hoy, ${oracion}*`,
		);
		expect(alDia?.cuerpo).toContain(
			`🛑 Si no realizas tu pago hoy, ${oracion}`,
		);
		expect(alDia?.cuerpo).not.toContain("*");

		const mensaje = interpolar(alDia?.cuerpoWhastapp ?? "", {
			clienteNombre: "MARIA LOPEZ",
			fechaPago: "5",
			cuotaMensual: "2,500.00",
			placa: "",
			marcaLineaModelo: "",
			montoAdeudado: "",
			cuotasAtraso: 0,
			telefonoAsesor: "41286630",
			nombreAsesor: "Carlos Pérez",
			expectativaMora: "504.00",
			expectativaMoraDiaria: "16.80",
		});
		expect(mensaje).toContain(
			"recargo por mora de Q16.80 por cada día de atraso, hasta un máximo de Q504.00 al mes.",
		);
		expect(mensaje).not.toContain("{expectativaMora");
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
			`Impuesto de Circulación ${anioImpuestoCirculacion()}*.`,
		);
		expect(mensaje).toContain(
			`⏰ Fecha límite: *${fechaLimiteImpuestoCirculacion()} a las 5:00 p.m.*`,
		);
		expect(mensaje).toContain("Carlos Pérez - Asesor de Cobros*\n41286630");
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

	test("el guard de mora evalúa el mensaje editado, no la plantilla", () => {
		const porId = (id: string) =>
			PLANTILLAS_MENSAJES.find((plantilla) => plantilla.id === id) ?? {
				cuerpo: "",
			};
		const alDia = cuerpoWhatsappDe(porId("al_dia"));

		// La plantilla contiene el fragmento fijo; si cambia el copy hay que
		// ajustar FRAGMENTO_EXPECTATIVA_MORA para que el guard lo siga detectando.
		expect(alDia).toContain(FRAGMENTO_EXPECTATIVA_MORA);
		expect(mensajeAnunciaExpectativaMora(alDia)).toBe(true);

		// Interpolado sin montos quedan los huecos ("recargo por mora de Q por
		// cada día…, hasta un máximo de Q al mes") → sigue bloqueando…
		const interpolado = interpolar(alDia, {
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
			expectativaMoraDiaria: "",
		});
		expect(interpolado).toContain(
			"recargo por mora de Q por cada día de atraso, hasta un máximo de Q al mes.",
		);
		expect(mensajeAnunciaExpectativaMora(interpolado)).toBe(true);

		// El modal bloquea si falta CUALQUIERA de los dos montos: el guard detecta
		// la oración y el modal revisa los dos valores. Con uno solo el texto
		// igual sale con un hueco.
		expect(mensajeAnunciaExpectativaMora("Q{expectativaMoraDiaria}")).toBe(
			true,
		);
		expect(mensajeAnunciaExpectativaMora("Q{expectativaMora}")).toBe(true);

		// …pero si el asesor borra esa oración, el mensaje se puede enviar.
		const sinOracion = interpolado
			.split("\n")
			.filter((linea) => !linea.includes(FRAGMENTO_EXPECTATIVA_MORA))
			.join("\n");
		expect(mensajeAnunciaExpectativaMora(sinOracion)).toBe(false);

		// Las demás plantillas no anuncian mora.
		expect(
			mensajeAnunciaExpectativaMora(cuerpoWhatsappDe(porId("mora_30"))),
		).toBe(false);
		expect(
			mensajeAnunciaExpectativaMora(cuerpoWhatsappDe(porId("bienvenida"))),
		).toBe(false);
	});

	test("el guard del monto adeudado detecta las 3 plantillas de mora y NO el recordatorio del día de pago", () => {
		const porId = (id: string) =>
			PLANTILLAS_MENSAJES.find((plantilla) => plantilla.id === id) ?? {
				cuerpo: "",
			};
		const base = {
			clienteNombre: "MARIA LOPEZ",
			fechaPago: "5",
			cuotaMensual: "2,500.00",
			placa: "P123ABC",
			marcaLineaModelo: "Toyota Yaris 2018",
			cuotasAtraso: 2,
			telefonoAsesor: "41286630",
			nombreAsesor: "Carlos Pérez",
			expectativaMora: "1,382.72",
		};

		// Las tres plantillas que llevan {montoAdeudado} se detectan con la
		// variable sin interpolar y también ya interpoladas (con monto y sin él).
		for (const id of ["mora_30", "mora_60", "aviso_juridico"]) {
			const cuerpo = cuerpoWhatsappDe(porId(id));
			expect(mensajeAnunciaMontoAdeudado(cuerpo), id).toBe(true);
			expect(
				mensajeAnunciaMontoAdeudado(
					interpolar(cuerpo, { ...base, montoAdeudado: "2,100.00" }),
				),
				id,
			).toBe(true);
			// Sin monto queda el hueco ("por un monto de Q.") → hay que bloquear.
			expect(
				mensajeAnunciaMontoAdeudado(
					interpolar(cuerpo, { ...base, montoAdeudado: "" }),
				),
				id,
			).toBe(true);
		}

		// CLAVE: el recordatorio del día de pago dice "por un monto de
		// Q{cuotaMensual}", que NO es el monto adeudado. Si el guard lo detectara,
		// bloquearía la plantilla más usada en todo crédito al día (que es
		// justamente cuando montoAdeudado viene vacío).
		for (const id of [
			"al_dia",
			"pre_mora",
			"bienvenida",
			"impuesto_circulacion_2026",
		]) {
			const cuerpo = cuerpoWhatsappDe(porId(id));
			expect(mensajeAnunciaMontoAdeudado(cuerpo), id).toBe(false);
			expect(
				mensajeAnunciaMontoAdeudado(
					interpolar(cuerpo, { ...base, montoAdeudado: "" }),
				),
				id,
			).toBe(false);
		}

		// Si el asesor borra la oración del monto, el envío se habilita.
		const mora30 = interpolar(cuerpoWhatsappDe(porId("mora_30")), {
			...base,
			montoAdeudado: "",
		});
		const sinOracion = mora30
			.split("\n")
			.filter((linea) => !linea.includes("por un monto de"))
			.join("\n");
		expect(mensajeAnunciaMontoAdeudado(sinOracion)).toBe(false);
	});

	test("el guard del impuesto solo bloquea si la fecha vencida sigue en el mensaje", () => {
		const porId = (id: string) =>
			PLANTILLAS_MENSAJES.find((plantilla) => plantilla.id === id) ?? {
				cuerpo: "",
			};
		const impuesto = cuerpoWhatsappDe(porId("impuesto_circulacion_2026"));
		const vencido = new Date("2026-09-03T18:00:00Z"); // después del 31/07 GT
		const vigente = new Date("2026-05-15T12:00:00Z");

		// Con la variable sin interpolar: bloquea solo si ya venció.
		expect(mensajeTieneFechaLimiteImpuestoVencida(impuesto, vencido)).toBe(
			true,
		);
		expect(mensajeTieneFechaLimiteImpuestoVencida(impuesto, vigente)).toBe(
			false,
		);

		// Interpolado trae "31/07/2026" → bloquea; si el asesor cambia la fecha,
		// ya no (aunque el año 2026 siga en el texto).
		const interpolado = interpolar(impuesto, {
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
			anioImpuesto: anioImpuestoCirculacion(vencido),
			fechaLimiteImpuesto: fechaLimiteImpuestoCirculacion(vencido),
		});
		expect(interpolado).toContain("31/07/2026");
		expect(mensajeTieneFechaLimiteImpuestoVencida(interpolado, vencido)).toBe(
			true,
		);
		const corregido = interpolado.replace("31/07/2026", "15/09/2026");
		expect(corregido).toContain("Impuesto de Circulación 2026");
		expect(mensajeTieneFechaLimiteImpuestoVencida(corregido, vencido)).toBe(
			false,
		);

		// Las demás plantillas nunca bloquean por esto.
		expect(
			mensajeTieneFechaLimiteImpuestoVencida(
				cuerpoWhatsappDe(porId("al_dia")),
				vencido,
			),
		).toBe(false);

		// Bordes del corte: 31/07 a las 17:00 de Guatemala (la hora del mensaje).
		// T22:59Z = 16:59 GT aún se envía; T23:00Z = 17:00 GT ya venció.
		expect(fechaLimiteImpuestoVencida(new Date("2026-07-31T22:59:00Z"))).toBe(
			false,
		);
		expect(fechaLimiteImpuestoVencida(new Date("2026-07-31T23:00:00Z"))).toBe(
			true,
		);
		expect(fechaLimiteImpuestoVencida(new Date("2026-08-01T18:00:00Z"))).toBe(
			true,
		);
	});

	test("las notificaciones de mora usan el monto adeudado real del server", () => {
		// El server calcula {montoAdeudado} desde el detalle de cartera: saldo
		// real de cada cuota vencida (recibo menos lo abonado) + mora. La misma
		// variable sirve para 1 cuota, 2-3 cuotas y el aviso jurídico.
		const porId = (id: string) =>
			PLANTILLAS_MENSAJES.find((plantilla) => plantilla.id === id);
		const mora30 = porId("mora_30");
		const mora60 = porId("mora_60");
		expect(mora30?.cuerpoWhastapp).toContain(
			"1 cuota con atraso por un monto de Q{montoAdeudado}",
		);
		expect(mora60?.cuerpoWhastapp).toContain(
			"por un monto total de Q{montoAdeudado}",
		);
		expect(mora60?.cuerpo).toContain("por un monto total de Q{montoAdeudado}");

		const base = {
			clienteNombre: "MARIA LOPEZ",
			fechaPago: "5",
			cuotaMensual: "1,000.00",
			placa: "",
			marcaLineaModelo: "",
			telefonoAsesor: "41286630",
			nombreAsesor: "Carlos Pérez",
			expectativaMora: "",
		};
		// 1 cuota con abono parcial de Q600 + mora Q50: debe Q450, no Q1,050.
		expect(
			interpolar(mora30?.cuerpoWhastapp ?? "", {
				...base,
				montoAdeudado: "450.00",
				cuotasAtraso: 1,
			}),
			// Sin incrementoDiarioMora, la oración del aumento no se imprime.
		).toContain(
			"Tienes *1 cuota con atraso por un monto de Q450.00* al día de hoy.",
		);
		expect(
			interpolar(mora60?.cuerpoWhastapp ?? "", {
				...base,
				montoAdeudado: "2,100.00",
				cuotasAtraso: 2,
			}),
		).toContain(
			"tienes *2 cuotas en atraso, por un monto total de Q2,100.00* al día de hoy.",
		);
	});

	test("sugiere la notificación de 2-3 cuotas para mora_90 y el aviso jurídico para 4+", () => {
		// getDetallesCreditoCarteraBack marca mora_90 con 3 cuotas atrasadas; el
		// deck cubre 2-3 cuotas con la misma plantilla. El jurídico es para 4+.
		expect(sugerirPlantilla("mora_30")).toBe("mora_30");
		expect(sugerirPlantilla("mora_60")).toBe("mora_60");
		expect(sugerirPlantilla("mora_90")).toBe("mora_60");
		expect(sugerirPlantilla("mora_120")).toBe("aviso_juridico");
		expect(sugerirPlantilla("incobrable")).toBe("aviso_juridico");
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
		expect(mensajeDefault).toContain("a través de Seguros Universales.*");
		expect(mensajeDefault).toContain("cabina de emergencia al 2384-7400*,");

		// Con los datos que manda getDetallesCreditoCarteraBack sale G&T.
		const mensajeGyt = interpolar(bienvenida?.cuerpoWhastapp ?? "", {
			...base,
			aseguradora: "Seguro GYT",
			cabinaSeguro: "1778",
		});
		expect(mensajeGyt).toContain("a través de Seguro GYT.*");
		expect(mensajeGyt).toContain("cabina de emergencia al 1778*,");
	});
});

// {incrementoDiarioMora} = lo que crece el crédito COMPLETO por día (1/30 por
// cada cuota vencida bajo el techo), distinto de {expectativaMoraDiaria}, que
// es el recargo de UNA cuota para un cliente al día.
describe("incrementoDiarioMora en las plantillas de mora (front)", () => {
	const porId = (id: string) => PLANTILLAS_MENSAJES.find((p) => p.id === id);

	const base = {
		clienteNombre: "MARIA LOPEZ",
		fechaPago: "5",
		cuotaMensual: "1,000.00",
		placa: "P123ABC",
		marcaLineaModelo: "Toyota Yaris 2020",
		telefonoAsesor: "41286630",
		nombreAsesor: "Carlos Pérez",
		expectativaMora: "",
	};

	test("las tres plantillas traen el ritmo Y su techo, en WhatsApp y en email", () => {
		for (const id of ["mora_30", "mora_60", "aviso_juridico"]) {
			const plantilla = porId(id);
			for (const cuerpo of [plantilla?.cuerpo, plantilla?.cuerpoWhastapp]) {
				expect(cuerpo).toContain(CLAUSULA_INCREMENTO_DIARIO_MORA);
				expect(cuerpo).toContain(FRAGMENTO_TOPE_INCREMENTO_MORA);
				// El ritmo sin techo prometía un crecimiento infinito.
				expect(cuerpo).not.toContain("por cada día que pase");
			}
		}
	});

	test("1 cuota atrasada: saldo de hoy + cuánto sube por día", () => {
		expect(
			interpolar(porId("mora_30")?.cuerpoWhastapp ?? "", {
				...base,
				montoAdeudado: "450.00",
				cuotasAtraso: 1,
				incrementoDiarioMora: "3.73",
				incrementoMaximoMensualMora: "93.33",
			}),
		).toContain(
			"Tienes *1 cuota con atraso por un monto de Q450.00* al día de hoy, y aumenta Q3.73 por cada día de atraso, hasta un máximo de Q93.33 al mes.",
		);
	});

	test("2-3 cuotas atrasadas: el aumento es el del crédito completo", () => {
		expect(
			interpolar(porId("mora_60")?.cuerpoWhastapp ?? "", {
				...base,
				montoAdeudado: "2,100.00",
				cuotasAtraso: 2,
				incrementoDiarioMora: "7.47",
				incrementoMaximoMensualMora: "186.67",
			}),
		).toContain(
			"tienes *2 cuotas en atraso, por un monto total de Q2,100.00* al día de hoy, y aumenta Q7.47 por cada día de atraso, hasta un máximo de Q186.67 al mes.",
		);
	});

	test("aviso jurídico", () => {
		expect(
			interpolar(porId("aviso_juridico")?.cuerpoWhastapp ?? "", {
				...base,
				montoAdeudado: "20,150.00",
				cuotasAtraso: 5,
				incrementoDiarioMora: "11.20",
				incrementoMaximoMensualMora: "1,120.00",
			}),
		).toContain(
			"por un monto de 20,150.00 incluyendo moras al día de hoy, y aumenta Q11.20 por cada día de atraso, hasta un máximo de Q1,120.00 al mes.",
		);
	});

	test("incremento 0 (todas las cuotas en el techo): sin frase de aumento", () => {
		const mensaje = interpolar(porId("mora_30")?.cuerpoWhastapp ?? "", {
			...base,
			montoAdeudado: "450.00",
			cuotasAtraso: 1,
			incrementoDiarioMora: "0.00",
			incrementoMaximoMensualMora: "0.00",
		});
		expect(mensaje).toContain(
			"Tienes *1 cuota con atraso por un monto de Q450.00* al día de hoy.",
		);
		expect(mensaje).not.toContain("aumenta");
		expect(mensaje).not.toContain("máximo");
		expect(mensaje).not.toContain("Q0.00");
		expect(mensaje).not.toContain("{incrementoDiarioMora}");
		expect(mensaje).not.toContain("{incrementoMaximoMensualMora}");
	});

	test("con ritmo pero sin techo: la frase se corta, no se rompe", () => {
		const mensaje = interpolar(porId("mora_30")?.cuerpoWhastapp ?? "", {
			...base,
			montoAdeudado: "450.00",
			cuotasAtraso: 1,
			incrementoDiarioMora: "3.73",
		});
		expect(mensaje).toContain(
			"Tienes *1 cuota con atraso por un monto de Q450.00* al día de hoy, y aumenta Q3.73 por cada día de atraso.",
		);
		expect(mensaje).not.toContain("máximo");
		expect(mensaje).not.toContain("Q al mes");
		expect(mensaje).not.toContain("{incrementoMaximoMensualMora}");
	});

	test("el email (cuerpo) se comporta igual que el de WhatsApp", () => {
		const conAumento = interpolar(porId("mora_60")?.cuerpo ?? "", {
			...base,
			montoAdeudado: "2,100.00",
			cuotasAtraso: 2,
			incrementoDiarioMora: "7.47",
			incrementoMaximoMensualMora: "186.67",
		});
		expect(conAumento).toContain(
			"por un monto total de Q2,100.00 al día de hoy, y aumenta Q7.47 por cada día de atraso, hasta un máximo de Q186.67 al mes.",
		);
		const sinAumento = interpolar(porId("mora_60")?.cuerpo ?? "", {
			...base,
			montoAdeudado: "2,100.00",
			cuotasAtraso: 2,
			incrementoDiarioMora: "0.00",
			incrementoMaximoMensualMora: "0.00",
		});
		expect(sinAumento).toContain(
			"por un monto total de Q2,100.00 al día de hoy.",
		);
		expect(sinAumento).not.toContain("aumenta");
		expect(sinAumento).not.toContain("máximo");
	});

	test("sin el dato (cartera viejo) no queda ni la variable ni un 'Q.' roto", () => {
		const mensaje = interpolar(porId("mora_30")?.cuerpoWhastapp ?? "", {
			...base,
			montoAdeudado: "450.00",
			cuotasAtraso: 1,
		});
		expect(mensaje).not.toContain("{incrementoDiarioMora}");
		expect(mensaje).not.toContain("aumenta");
	});

	test("el monto adeudado sigue detectándose para el guard de envío", () => {
		// La oración nueva no puede romper mensajeAnunciaMontoAdeudado: si lo
		// rompiera, un mensaje sin monto se enviaría con el hueco "Q.".
		const mensaje = interpolar(porId("mora_30")?.cuerpoWhastapp ?? "", {
			...base,
			montoAdeudado: "450.00",
			cuotasAtraso: 1,
			incrementoDiarioMora: "3.73",
			incrementoMaximoMensualMora: "93.33",
		});
		expect(mensajeAnunciaMontoAdeudado(mensaje)).toBe(true);
		const juridico = interpolar(porId("aviso_juridico")?.cuerpoWhastapp ?? "", {
			...base,
			montoAdeudado: "20,150.00",
			cuotasAtraso: 5,
			incrementoDiarioMora: "3.73",
			incrementoMaximoMensualMora: "93.33",
		});
		expect(mensajeAnunciaMontoAdeudado(juridico)).toBe(true);
	});

	test("el mismo predicado decide si hay techo que anunciar", () => {
		expect(hayIncrementoMora("93.33")).toBe(true);
		expect(hayIncrementoMora("0.00")).toBe(false);
	});

	test("hayIncrementoMora: 0, vacío y nulo no anuncian nada", () => {
		expect(hayIncrementoMora("3.73")).toBe(true);
		expect(hayIncrementoMora("1,120.00")).toBe(true);
		expect(hayIncrementoMora("0.00")).toBe(false);
		expect(hayIncrementoMora("")).toBe(false);
		expect(hayIncrementoMora(null)).toBe(false);
		expect(hayIncrementoMora(undefined)).toBe(false);
	});

	test("no cambia el conteo de bloques de la plantilla aprobada", () => {
		for (const id of ["mora_30", "mora_60", "aviso_juridico"]) {
			const cuerpo = porId(id)?.cuerpoWhastapp ?? "";
			const bloques = cuerpo.split("\n\n").length;
			// Con las dos cifras, sin ninguna, y con el ritmo pero sin su techo.
			for (const [inc, max] of [
				["3.73", "93.33"],
				["0.00", "0.00"],
				["3.73", ""],
			]) {
				expect(
					interpolar(cuerpo, {
						...base,
						montoAdeudado: "100.00",
						cuotasAtraso: 1,
						incrementoDiarioMora: inc,
						incrementoMaximoMensualMora: max,
					}).split("\n\n").length,
				).toBe(bloques);
			}
		}
	});
});

// Gemelo del gate del server (prepararIncrementoMoraParaEnvio): el modal
// ofrece las dos variables sueltas, así que el asesor puede escribir su propia
// oración y esa no la borra `interpolar`.
describe("mensajeAnunciaIncrementoMoraSinDato — el hueco que llegaría al cliente", () => {
	const suelto = "El saldo aumenta Q{incrementoDiarioMora} diario.";

	test("placeholder suelto sin valor: hay que bloquear", () => {
		expect(mensajeAnunciaIncrementoMoraSinDato(suelto, "", "")).toBe(true);
		expect(mensajeAnunciaIncrementoMoraSinDato(suelto, "0.00", "0.00")).toBe(
			true,
		);
	});

	test("el techo suelto sin valor también, aunque llegue el ritmo", () => {
		expect(
			mensajeAnunciaIncrementoMoraSinDato(
				"…hasta Q{incrementoMaximoMensualMora}.",
				"3.73",
				"",
			),
		).toBe(true);
	});

	test("con el dato no hay nada que bloquear", () => {
		expect(mensajeAnunciaIncrementoMoraSinDato(suelto, "3.73", "")).toBe(false);
	});

	test("la cláusula incorporada no bloquea: desaparece sola al interpolar", () => {
		const cuerpo = `Tienes 1 cuota vencida${CLAUSULA_INCREMENTO_DIARIO_MORA}.`;
		expect(mensajeAnunciaIncrementoMoraSinDato(cuerpo, "", "")).toBe(false);
		expect(mensajeAnunciaIncrementoMoraSinDato(cuerpo, "3.73", "")).toBe(false);
		// Y en efecto el mensaje sale sano: sin "Q" colgando.
		expect(
			interpolar(cuerpo, {
				clienteNombre: "MARIA LOPEZ",
				fechaPago: "5",
				cuotaMensual: "2,500.00",
				placa: "P123ABC",
				marcaLineaModelo: "Toyota Yaris 2018",
				montoAdeudado: "4,318.20",
				cuotasAtraso: 1,
				telefonoAsesor: "41286630",
				nombreAsesor: "Carlos Pérez",
				expectativaMora: "1,382.72",
			}),
		).toBe("Tienes 1 cuota vencida.");
	});

	test("un mensaje sin el tema pasa derecho", () => {
		expect(mensajeAnunciaIncrementoMoraSinDato("Buenos días.", "", "")).toBe(
			false,
		);
	});
});
