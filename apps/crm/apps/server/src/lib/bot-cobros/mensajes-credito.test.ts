/**
 * Los mensajes que el cliente lee en WhatsApp.
 *
 * Un número mal formateado o una fecha corrida un día acá se le muestra tal cual
 * a la persona, así que se prueban las reglas: moneda, fechas, singular/plural y
 * qué se dice en cada situación del crédito.
 */

import { describe, expect, test } from "bun:test";
import { cuentasParaBot } from "../cuentas-pago";
import { armarMensajes, fechaLegible, quetzales } from "./mensajes-credito";
import type { InfoCreditoBot } from "./menu-credito";

const base: InfoCreditoBot = {
	numeroSifco: "01010214124000",
	etiqueta: "Toyota Corolla 2015 · P-319JJL",
	estado: "ACTIVO",
	capitalActivo: "53439.10",
	cuotaMensual: "2464.63",
	cuotasAtrasadas: 0,
	cuotaActual: {
		numero: 7,
		de: 48,
		fechaVencimiento: "2026-08-30",
		vencida: false,
	},
	proximaFechaPago: "2026-08-30",
	mora: null,
	moraPorConfirmar: false,
	convenio: null,
	asesor: { nombre: "Octavio Rosales", telefono: "35111822" },
	// Fijas para todos los créditos; los mensajes no las usan, pero el tipo sí.
	cuentasPago: cuentasParaBot(),
	vehiculo: {
		placa: "P-319JJL",
		marca: "Toyota",
		modelo: "Corolla",
		anio: 2015,
	},
	mensajes: { titulo: "", resumen: "", completo: "" },
};

describe("quetzales", () => {
	test("separa los miles y deja dos decimales", () => {
		expect(quetzales("53439.10")).toBe("Q53,439.10");
		expect(quetzales("190846.74")).toBe("Q190,846.74");
	});

	test("montos chicos no llevan separador", () => {
		expect(quetzales("598.52")).toBe("Q598.52");
		expect(quetzales("0")).toBe("Q0.00");
	});

	test("millones", () => {
		expect(quetzales("1700000")).toBe("Q1,700,000.00");
	});
});

describe("fechaLegible", () => {
	// El motivo de parsear a mano: `new Date("2026-08-30")` es medianoche UTC, y
	// en Guatemala (UTC-6) eso es el 29 a las 18:00 — mostraría el día anterior.
	test("no corre el día por zona horaria", () => {
		expect(fechaLegible("2026-08-30")).toBe("30 de agosto de 2026");
		expect(fechaLegible("2026-01-01")).toBe("1 de enero de 2026");
		expect(fechaLegible("2026-12-31")).toBe("31 de diciembre de 2026");
	});
});

describe("cliente al día", () => {
	const m = armarMensajes(base);

	test("el título es la etiqueta, sin emojis (el motor del bot no los procesa)", () => {
		expect(m.titulo).toBe("*Toyota Corolla 2015 · P-319JJL*");
	});

	test("se lo dice explícitamente", () => {
		expect(m.completo).toContain("Estás al día con tus cuotas");
	});

	test("el resumen trae cuota y próxima fecha", () => {
		expect(m.resumen).toContain("Cuota 7 de 48");
		expect(m.resumen).toContain("30 de agosto de 2026");
	});

	test("el completo trae el asesor con su teléfono", () => {
		expect(m.completo).toContain("Octavio Rosales");
		expect(m.completo).toContain("35111822");
	});
});

describe("cliente atrasado", () => {
	const m = armarMensajes({
		...base,
		cuotasAtrasadas: 3,
		cuotaActual: {
			numero: 4,
			de: 48,
			fechaVencimiento: "2026-05-30",
			vencida: true,
		},
		proximaFechaPago: "2026-08-30",
		mora: { monto: "598.52", cuotasAtrasadas: 3 },
	});

	test("el título es la etiqueta (el aviso va en las líneas, no en emojis)", () => {
		expect(m.titulo).toBe("*Toyota Corolla 2015 · P-319JJL*");
		expect(m.completo).toContain("atrasada");
	});

	test("dice cuántas debe y cuánto es la mora", () => {
		expect(m.completo).toContain("3 cuotas atrasadas");
		expect(m.completo).toContain("Q598.52");
		expect(m.completo).not.toContain("Estás al día");
	});

	// Con atraso, la cuota que debe venció en mayo pero su próxima es en agosto.
	test("la próxima fecha es la futura, no la vencida", () => {
		expect(m.resumen).toContain("30 de agosto de 2026");
		expect(m.resumen).not.toContain("30 de mayo");
	});
});

describe("detalles que se notan", () => {
	test("una sola cuota atrasada va en singular", () => {
		const m = armarMensajes({ ...base, cuotasAtrasadas: 1 });

		expect(m.completo).toContain("1 cuota atrasada");
		expect(m.completo).not.toContain("1 cuotas");
		expect(m.completo).not.toContain("atrasadas*");
	});

	// Todas vencidas y ninguna futura: sin esto el mensaje quedaba sin cierre.
	test("sin próxima fecha, dice cuándo venció la que debe", () => {
		const m = armarMensajes({
			...base,
			cuotasAtrasadas: 5,
			proximaFechaPago: null,
			cuotaActual: {
				numero: 44,
				de: 48,
				fechaVencimiento: "2026-03-30",
				vencida: true,
			},
		});

		expect(m.completo).toContain("venció el 30 de marzo de 2026");
	});

	// La foto de la mora quedó vieja: no se cita un monto que puede estar mal.
	test("mora por confirmar: manda con el asesor, sin decir monto", () => {
		const m = armarMensajes({ ...base, mora: null, moraPorConfirmar: true });

		expect(m.completo).toContain("pendiente de confirmar");
		expect(m.completo).toContain("asesor");
		expect(m.completo).not.toMatch(/Monto en mora/);
	});

	test("con convenio, aparece su bloque", () => {
		const m = armarMensajes({
			...base,
			convenio: {
				cuotaMensual: "981.86",
				montoPendiente: "4909.29",
				pagosRealizados: 1,
				pagosPendientes: 5,
				numeroMeses: 6,
			},
		});

		expect(m.completo).toContain("*Tu convenio de pago*");
		expect(m.completo).toContain("Q981.86");
		expect(m.completo).toContain("Llevás 1 de 6 pagos");
	});

	test("sin vehículo el mensaje sale igual, sin bloque vacío", () => {
		const m = armarMensajes({ ...base, vehiculo: null });

		expect(m.completo).not.toContain("Vehículo:");
		expect(m.completo).not.toContain("Placa:");
		expect(m.completo).toContain("Cuota mensual");
	});

	test("sin asesor tampoco queda un encabezado suelto", () => {
		const m = armarMensajes({ ...base, asesor: null });

		expect(m.completo).not.toContain("Tu asesor");
	});

	test("asesor sin teléfono: se muestra el nombre y nada más", () => {
		const m = armarMensajes({
			...base,
			asesor: { nombre: "Octavio Rosales", telefono: null },
		});

		expect(m.completo).toContain("Octavio Rosales");
		expect(m.completo).not.toContain("📞");
	});

	// WhatsApp usa un asterisco para negrita; dos se ven literales.
	test("la negrita es de WhatsApp, no de markdown", () => {
		const m = armarMensajes(base);

		expect(m.completo).not.toContain("**");
	});
});
