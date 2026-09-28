import { describe, expect, it } from "bun:test";
import {
	calcularFotoSaldo,
	type DetalleRecuperacion,
	detalleRecuperacionSchema,
	erroresDetalleRecuperacion,
	falloDefinitivoDeCartera,
	motivoBloqueoRecuperacion,
	operacionRecuperacion,
	referenciaDelRegistro,
	textoAvisoRecuperacion,
	textoMotivoCartera,
} from "./recuperacion-vehiculo";

const AHORA = new Date("2026-09-28T15:00:00Z");

function forzosa(
	extra: Partial<DetalleRecuperacion> = {},
): DetalleRecuperacion {
	return detalleRecuperacionSchema.parse({
		motivos: ["atrasos_constantes", "promesas_incumplidas"],
		motivoDetalle: "Lleva tres promesas rotas este mes",
		...extra,
	});
}

function voluntaria(extra: Record<string, unknown> = {}): DetalleRecuperacion {
	return detalleRecuperacionSchema.parse({
		motivos: ["no_puede_pagar"],
		motivoDetalle: "Perdió el trabajo y prefiere entregarlo",
		estadoVehiculo: "bueno",
		entrega: {
			fecha: "2026-09-30T16:00:00Z",
			lugar: "Agencia zona 9",
			documentos: ["llaves", "tarjeta_circulacion"],
		},
		...extra,
	});
}

describe("operacionRecuperacion", () => {
	it("de B1 a B3 los dos envíos trasladan a B4", () => {
		for (const b of [1, 2, 3]) {
			expect(operacionRecuperacion("tomado", b)).toBe("trasladar");
			expect(operacionRecuperacion("entrega_voluntaria", b)).toBe("trasladar");
		}
	});

	it("en B4 solo la entrega voluntaria aplica, y sin traslado", () => {
		expect(operacionRecuperacion("entrega_voluntaria", 4)).toBe(
			"solo_registrar",
		);
		expect(operacionRecuperacion("tomado", 4)).toBeNull();
	});

	it("en B0, B5 o sin bucket no aplica ninguno", () => {
		for (const b of [0, 5, null]) {
			expect(operacionRecuperacion("tomado", b)).toBeNull();
			expect(operacionRecuperacion("entrega_voluntaria", b)).toBeNull();
		}
	});

	it("el motivo de bloqueo dice el rango de cada tipo", () => {
		expect(motivoBloqueoRecuperacion("tomado", 4, "B4")).toContain("B1 a B3");
		expect(motivoBloqueoRecuperacion("entrega_voluntaria", 5, "B5")).toContain(
			"B1 a B4",
		);
		expect(motivoBloqueoRecuperacion("entrega_voluntaria", 4)).toBeNull();
	});
});

describe("erroresDetalleRecuperacion", () => {
	it("el detalle es opcional si los motivos ya lo dicen", () => {
		const d = forzosa({ motivoDetalle: undefined });
		expect(erroresDetalleRecuperacion("tomado", d, AHORA)).toBeNull();
	});

	it("«Otro» sin detalle no dice nada: se pide el detalle", () => {
		const d = forzosa({ motivos: ["otro"], motivoDetalle: undefined });
		expect(erroresDetalleRecuperacion("tomado", d, AHORA)).toContain("Otro");
	});

	it("una recuperación forzosa con motivos y detalle está completa", () => {
		expect(erroresDetalleRecuperacion("tomado", forzosa(), AHORA)).toBeNull();
	});

	it("rechaza un motivo del otro tipo", () => {
		const d = forzosa({ motivos: ["no_puede_pagar"] });
		expect(erroresDetalleRecuperacion("tomado", d, AHORA)).toContain(
			"no_puede_pagar",
		);
	});

	it("rechaza motivos repetidos", () => {
		const d = forzosa({ motivos: ["otro", "otro"] });
		expect(erroresDetalleRecuperacion("tomado", d, AHORA)).toContain(
			"repetidos",
		);
	});

	it("la forzosa no lleva datos de entrega", () => {
		const d = { ...forzosa(), entrega: voluntaria().entrega };
		expect(erroresDetalleRecuperacion("tomado", d, AHORA)).toContain(
			"solo para la entrega voluntaria",
		);
	});

	it("la voluntaria exige entrega y estado del vehículo", () => {
		expect(
			erroresDetalleRecuperacion("entrega_voluntaria", voluntaria(), AHORA),
		).toBeNull();

		const sinEntrega = { ...voluntaria(), entrega: undefined };
		expect(
			erroresDetalleRecuperacion("entrega_voluntaria", sinEntrega, AHORA),
		).toContain("datos de la entrega");

		const sinEstado = { ...voluntaria(), estadoVehiculo: undefined };
		expect(
			erroresDetalleRecuperacion("entrega_voluntaria", sinEstado, AHORA),
		).toContain("estado del vehículo");
	});

	it("la fecha de entrega va de hace un año a 90 días adelante", () => {
		const lejos = voluntaria({
			entrega: { fecha: "2027-03-01T00:00:00Z", lugar: "Agencia" },
		});
		expect(
			erroresDetalleRecuperacion("entrega_voluntaria", lejos, AHORA),
		).toContain("90 días");
		const vieja = voluntaria({
			entrega: { fecha: "2025-01-01T00:00:00Z", lugar: "Agencia" },
		});
		expect(
			erroresDetalleRecuperacion("entrega_voluntaria", vieja, AHORA),
		).toContain("más de un año");
	});
});

describe("detalleRecuperacionSchema", () => {
	it("un enlace que no es http(s) no pasa", () => {
		const r = detalleRecuperacionSchema.safeParse({
			motivos: ["otro"],
			motivoDetalle: "Detalle suficiente",
			ubicacion: { enlace: "javascript:alert(1)" },
		});
		expect(r.success).toBe(false);
	});

	it("un enlace vacío se toma como que no hay enlace", () => {
		const r = detalleRecuperacionSchema.parse({
			motivos: ["otro"],
			motivoDetalle: "Detalle suficiente",
			ubicacion: { enlace: "  ", direccion: "Frente al parque" },
		});
		expect(r.ubicacion?.enlace).toBeUndefined();
		expect(r.ubicacion?.fuente).toBe("manual");
	});

	it("las coordenadas van completas o no van", () => {
		const r = detalleRecuperacionSchema.safeParse({
			motivos: ["otro"],
			motivoDetalle: "Detalle suficiente",
			ubicacion: { lat: 14.6 },
		});
		expect(r.success).toBe(false);
	});

	it("un documento fuera del catálogo no pasa", () => {
		const r = detalleRecuperacionSchema.safeParse({
			motivos: ["no_puede_pagar"],
			motivoDetalle: "Detalle suficiente",
			entrega: {
				fecha: "2026-09-30",
				lugar: "Agencia",
				documentos: ["pasaporte"],
			},
		});
		expect(r.success).toBe(false);
	});
});

describe("textoMotivoCartera", () => {
	it("lleva el tipo al principio, los motivos y el detalle", () => {
		expect(textoMotivoCartera("tomado", forzosa())).toBe(
			"Recuperación forzosa: Se atrasa constantemente, Incumple sus promesas de pago. Lleva tres promesas rotas este mes",
		);
		expect(textoMotivoCartera("entrega_voluntaria", voluntaria())).toStartWith(
			"Entrega voluntaria: Ya no puede pagar.",
		);
	});

	it("'Otro' no se escribe: lo explica el detalle", () => {
		const d = forzosa({ motivos: ["otro"], motivoDetalle: "Se fue del país" });
		expect(textoMotivoCartera("tomado", d)).toBe(
			"Recuperación forzosa: Se fue del país",
		);
	});

	it("se corta a 500 caracteres", () => {
		const d = forzosa({ motivoDetalle: "x".repeat(1900) });
		expect(textoMotivoCartera("tomado", d).length).toBe(500);
	});
});

describe("calcularFotoSaldo", () => {
	it("vencido = cuotas × cuota, y el total suma la mora", () => {
		expect(
			calcularFotoSaldo({
				deudaTotal: "45210.5",
				cuota: "2150.25",
				cuotasVencidas: 3,
				mora: "722.4",
			}),
		).toEqual({
			saldoPendiente: 45210.5,
			cuotasVencidas: 3,
			montoVencido: 6450.75,
			montoMora: 722.4,
			totalParaPonerseAlDia: 7173.15,
		});
	});

	it("un dato raro de cartera cuenta como cero, no como NaN", () => {
		const f = calcularFotoSaldo({
			deudaTotal: null,
			cuota: "abc",
			cuotasVencidas: undefined,
			mora: "",
		});
		expect(f.totalParaPonerseAlDia).toBe(0);
		expect(f.saldoPendiente).toBe(0);
	});
});

describe("textoAvisoRecuperacion", () => {
	it("la voluntaria dice cuándo y dónde entrega", () => {
		const t = textoAvisoRecuperacion({
			tipo: "entrega_voluntaria",
			trasladado: true,
			cliente: "Juan Pérez",
			numeroSifco: "0101",
			registradoPor: "Ana",
			detalle: voluntaria(),
		});
		expect(t.titulo).toBe("Entrega voluntaria: llegó a recuperación");
		expect(t.descripcion).toContain("Juan Pérez (0101) entrega la unidad el");
		expect(t.descripcion).toContain("en Agencia zona 9");
		expect(t.descripcion).toContain("Lo registró Ana.");
	});

	it("la voluntaria registrada ya en B4 no dice que llegó", () => {
		const t = textoAvisoRecuperacion({
			tipo: "entrega_voluntaria",
			trasladado: false,
			cliente: null,
			numeroSifco: "0101",
			registradoPor: null,
			detalle: voluntaria(),
		});
		expect(t.titulo).toBe("Entrega voluntaria registrada");
		expect(t.descripcion).toStartWith("Crédito 0101 entrega la unidad");
	});

	it("la forzosa lista los motivos", () => {
		const t = textoAvisoRecuperacion({
			tipo: "tomado",
			trasladado: true,
			cliente: "Juan Pérez",
			numeroSifco: "0101",
			registradoPor: null,
			detalle: forzosa(),
		});
		expect(t.descripcion).toBe(
			"Juan Pérez (0101): Se atrasa constantemente, Incumple sus promesas de pago.",
		);
	});
});

describe("falloDefinitivoDeCartera", () => {
	it("un 4xx de cartera prueba que no trasladó", () => {
		for (const status of [400, 404, 409]) {
			expect(falloDefinitivoDeCartera({ status, message: "x" })).toBe(true);
		}
	});

	it("el circuit breaker abierto también: la llamada nunca salió", () => {
		expect(falloDefinitivoDeCartera(new Error("Circuit breaker is OPEN"))).toBe(
			true,
		);
	});

	it("timeout, corte de red o 5xx NO prueban nada", () => {
		expect(falloDefinitivoDeCartera({ status: 500, message: "x" })).toBe(false);
		expect(
			falloDefinitivoDeCartera({ status: 504, message: "Gateway Timeout" }),
		).toBe(false);
		expect(
			falloDefinitivoDeCartera(new DOMException("timed out", "TimeoutError")),
		).toBe(false);
		expect(falloDefinitivoDeCartera(new TypeError("fetch failed"))).toBe(false);
		expect(falloDefinitivoDeCartera(null)).toBe(false);
	});
});

describe("referenciaDelRegistro", () => {
	it("la huella lleva el id completo del registro, para no confundir envíos", () => {
		const id = "42b5f10d-d2bb-49ee-ba9a-521aac6394f1";
		expect(referenciaDelRegistro(id)).toBe(`[ref CRM ${id}]`);
		expect(referenciaDelRegistro(id)).not.toBe(
			referenciaDelRegistro("42b5f10d-d2bb-49ee-ba9a-521aac6394f2"),
		);
	});
});
