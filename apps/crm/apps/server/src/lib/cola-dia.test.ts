import { describe, expect, test } from "bun:test";
import {
	type CreditoParaClasificar,
	calificaParaColaDia,
	calificaParaFiltro,
	clasificarCreditoColaDia,
	ordenColaDia,
} from "./cola-dia";

// Hoy fijo para todos los tests: 2026-07-23 (mediodía GT = 18:00 UTC, sin
// riesgo de cruzar medianoche por TZ).
const HOY = new Date("2026-07-23T18:00:00.000Z");
const AYER = new Date("2026-07-22T18:00:00.000Z");
const MANANA = new Date("2026-07-24T18:00:00.000Z");

function creditoBase(
	overrides: Partial<CreditoParaClasificar> = {},
): CreditoParaClasificar {
	return {
		fechaLimiteSla: null,
		contactadoHoy: false,
		promesas: [],
		diasSinContacto: null,
		...overrides,
	};
}

describe("clasificarCreditoColaDia — SLA", () => {
	test("fecha límite SLA = hoy y sin contacto hoy → slaHoy", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({ fechaLimiteSla: "2026-07-23" }),
			HOY,
		);
		expect(c.slaHoy).toBe(true);
	});

	test("fecha límite SLA = hoy PERO ya se contactó hoy → NO slaHoy", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({ fechaLimiteSla: "2026-07-23", contactadoHoy: true }),
			HOY,
		);
		expect(c.slaHoy).toBe(false);
	});

	test("fecha límite SLA en el pasado → NO slaHoy (esa urgencia la cubre incumplida/otro mecanismo, no esta bandera)", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({ fechaLimiteSla: "2026-07-22" }),
			HOY,
		);
		expect(c.slaHoy).toBe(false);
	});

	test("fechaLimiteSla null (B0 o sin historial) → NO slaHoy", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({ fechaLimiteSla: null }),
			HOY,
		);
		expect(c.slaHoy).toBe(false);
	});
});

describe("clasificarCreditoColaDia — promesa de pago", () => {
	test("promesa pendiente con fecha prometida hoy → promesaHoy", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({
				promesas: [{ estadoPromesa: "pendiente", fechaPrometida: HOY }],
			}),
			HOY,
		);
		expect(c.promesaHoy).toBe(true);
		expect(c.incumplida).toBe(false);
	});

	test("promesa pendiente con fecha prometida futura → ninguna bandera", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({
				promesas: [{ estadoPromesa: "pendiente", fechaPrometida: MANANA }],
			}),
			HOY,
		);
		expect(c.promesaHoy).toBe(false);
		expect(c.incumplida).toBe(false);
	});

	test("promesa pendiente con fecha prometida ayer (job nocturno no la marcó aún) → incumplida", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({
				promesas: [{ estadoPromesa: "pendiente", fechaPrometida: AYER }],
			}),
			HOY,
		);
		expect(c.incumplida).toBe(true);
		expect(c.promesaHoy).toBe(false);
	});

	test("promesa ya marcada incumplida → incumplida, sin importar la fecha", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({
				promesas: [{ estadoPromesa: "incumplida", fechaPrometida: MANANA }],
			}),
			HOY,
		);
		expect(c.incumplida).toBe(true);
	});
});

describe("clasificarCreditoColaDia — días sin contacto", () => {
	test("6 días sin contacto (> umbral de 5) → sinContacto", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({ diasSinContacto: 6 }),
			HOY,
		);
		expect(c.sinContacto).toBe(true);
	});

	test("exactamente 5 días (= umbral, no lo supera) → NO sinContacto", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({ diasSinContacto: 5 }),
			HOY,
		);
		expect(c.sinContacto).toBe(false);
	});

	test("1 día sin contacto → NO sinContacto", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({ diasSinContacto: 1 }),
			HOY,
		);
		expect(c.sinContacto).toBe(false);
	});

	test("diasSinContacto null (nunca se le registró contacto) → NO sinContacto, no se inventa una fecha base", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({ diasSinContacto: null }),
			HOY,
		);
		expect(c.sinContacto).toBe(false);
	});
});

describe("clasificarCreditoColaDia — solapes", () => {
	test("un crédito puede calificar en las 4 categorías a la vez", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({
				fechaLimiteSla: "2026-07-23",
				promesas: [
					{ estadoPromesa: "pendiente", fechaPrometida: HOY },
					{ estadoPromesa: "incumplida", fechaPrometida: AYER },
				],
				diasSinContacto: 10,
			}),
			HOY,
		);
		expect(c).toEqual({
			slaHoy: true,
			promesaHoy: true,
			incumplida: true,
			sinContacto: true,
		});
	});
});

describe("calificaParaColaDia / calificaParaFiltro", () => {
	test("sin ninguna bandera → no califica para la cola", () => {
		expect(
			calificaParaColaDia({
				slaHoy: false,
				promesaHoy: false,
				incumplida: false,
				sinContacto: false,
			}),
		).toBe(false);
	});

	test("con al menos una bandera → califica para la cola", () => {
		expect(
			calificaParaColaDia({
				slaHoy: true,
				promesaHoy: false,
				incumplida: false,
				sinContacto: false,
			}),
		).toBe(true);
	});

	test("solo sinContacto también califica para la cola", () => {
		expect(
			calificaParaColaDia({
				slaHoy: false,
				promesaHoy: false,
				incumplida: false,
				sinContacto: true,
			}),
		).toBe(true);
	});

	test("calificaParaFiltro solo mira la categoría pedida", () => {
		const c = {
			slaHoy: true,
			promesaHoy: false,
			incumplida: false,
			sinContacto: false,
		};
		expect(calificaParaFiltro(c, "sla_hoy")).toBe(true);
		expect(calificaParaFiltro(c, "promesa_hoy")).toBe(false);
		expect(calificaParaFiltro(c, "incumplida")).toBe(false);
		expect(calificaParaFiltro(c, "sin_contacto")).toBe(false);
	});

	test("calificaParaFiltro('sin_contacto') solo mira sinContacto", () => {
		const c = {
			slaHoy: true,
			promesaHoy: true,
			incumplida: true,
			sinContacto: false,
		};
		expect(calificaParaFiltro(c, "sin_contacto")).toBe(false);
	});
});

describe("ordenColaDia", () => {
	test("prioriza slaHoy sobre promesaHoy sobre incumplida sobre sinContacto", () => {
		expect(
			ordenColaDia({
				slaHoy: true,
				promesaHoy: true,
				incumplida: true,
				sinContacto: true,
			}),
		).toBe(0);
		expect(
			ordenColaDia({
				slaHoy: false,
				promesaHoy: true,
				incumplida: true,
				sinContacto: true,
			}),
		).toBe(1);
		expect(
			ordenColaDia({
				slaHoy: false,
				promesaHoy: false,
				incumplida: true,
				sinContacto: true,
			}),
		).toBe(2);
		expect(
			ordenColaDia({
				slaHoy: false,
				promesaHoy: false,
				incumplida: false,
				sinContacto: true,
			}),
		).toBe(3);
	});
});
