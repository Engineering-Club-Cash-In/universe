import { describe, expect, test } from "bun:test";
import {
	type ClasificacionColaDia,
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
		venceHoy: false,
		promesas: [],
		diasSinContacto: null,
		...overrides,
	};
}

/**
 * Clasificación armada a mano para probar calificaParaFiltro/ordenColaDia sin
 * pasar por clasificarCreditoColaDia. Con defaults para que agregar una
 * bandera nueva a ClasificacionColaDia no obligue a tocar cada literal.
 */
function clasificacionBase(
	overrides: Partial<ClasificacionColaDia> = {},
): ClasificacionColaDia {
	return {
		slaHoy: false,
		promesaHoy: false,
		venceHoy: false,
		incumplida: false,
		promesaProxima: false,
		sinContacto: false,
		promesaActiva: false,
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

describe("clasificarCreditoColaDia — vence hoy (cuota)", () => {
	test("venceHoy true en el input → venceHoy true en la clasificación", () => {
		const c = clasificarCreditoColaDia(creditoBase({ venceHoy: true }), HOY);
		expect(c.venceHoy).toBe(true);
	});

	test("venceHoy false en el input → venceHoy false, sin importar SLA/promesa", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({
				venceHoy: false,
				fechaLimiteSla: "2026-07-23",
				promesas: [{ estadoPromesa: "pendiente", fechaPrometida: HOY }],
			}),
			HOY,
		);
		expect(c.venceHoy).toBe(false);
		expect(c.slaHoy).toBe(true);
		expect(c.promesaHoy).toBe(true);
	});

	test("venceHoy y slaHoy pueden ser true a la vez — fuentes independientes", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({ venceHoy: true, fechaLimiteSla: "2026-07-23" }),
			HOY,
		);
		expect(c.venceHoy).toBe(true);
		expect(c.slaHoy).toBe(true);
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
	test("un crédito puede calificar en todas las categorías a la vez", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({
				fechaLimiteSla: "2026-07-23",
				venceHoy: true,
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
			venceHoy: true,
			incumplida: true,
			promesaProxima: false,
			sinContacto: true,
			// La pendiente de hoy sigue vigente aunque arrastre una incumplida.
			promesaActiva: true,
		});
	});
});

describe("clasificarCreditoColaDia — promesaActiva (CB-030)", () => {
	test("incumplida vieja + pendiente FUTURA → promesaActiva true junto con incumplida", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({
				promesas: [
					{ estadoPromesa: "incumplida", fechaPrometida: AYER },
					{ estadoPromesa: "pendiente", fechaPrometida: MANANA },
				],
			}),
			HOY,
		);
		// El caso que reportó Codex en el PR #1238: usar `!incumplida` como
		// proxy escondía el badge aunque la promesa nueva esté congelando.
		expect(c.incumplida).toBe(true);
		expect(c.promesaActiva).toBe(true);
	});

	test("promesa pendiente que vence HOY → vigente el día entero", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({
				promesas: [{ estadoPromesa: "pendiente", fechaPrometida: HOY }],
			}),
			HOY,
		);
		expect(c.promesaActiva).toBe(true);
	});

	test("solo promesas vencidas (pendientes sin evaluar) → NO vigente", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({
				promesas: [{ estadoPromesa: "pendiente", fechaPrometida: AYER }],
			}),
			HOY,
		);
		expect(c.incumplida).toBe(true);
		expect(c.promesaActiva).toBe(false);
	});

	test("solo incumplidas → NO vigente", () => {
		const c = clasificarCreditoColaDia(
			creditoBase({
				promesas: [{ estadoPromesa: "incumplida", fechaPrometida: AYER }],
			}),
			HOY,
		);
		expect(c.promesaActiva).toBe(false);
	});

	test("sin promesas → NO vigente", () => {
		expect(clasificarCreditoColaDia(creditoBase(), HOY).promesaActiva).toBe(
			false,
		);
	});
});

describe("calificaParaColaDia / calificaParaFiltro", () => {
	test("sin ninguna bandera → no califica para la cola", () => {
		expect(calificaParaColaDia(clasificacionBase())).toBe(false);
	});

	test("con al menos una bandera → califica para la cola", () => {
		expect(calificaParaColaDia(clasificacionBase({ slaHoy: true }))).toBe(true);
	});

	test("solo sinContacto también califica para la cola", () => {
		expect(calificaParaColaDia(clasificacionBase({ sinContacto: true }))).toBe(
			true,
		);
	});

	test("calificaParaFiltro solo mira la categoría pedida", () => {
		const c = clasificacionBase({ slaHoy: true });
		expect(calificaParaFiltro(c, "sla_hoy")).toBe(true);
		expect(calificaParaFiltro(c, "promesa_hoy")).toBe(false);
		expect(calificaParaFiltro(c, "vence_hoy")).toBe(false);
		expect(calificaParaFiltro(c, "incumplida")).toBe(false);
		expect(calificaParaFiltro(c, "sin_contacto")).toBe(false);
	});

	test("calificaParaFiltro('vence_hoy') solo mira venceHoy", () => {
		const c = clasificacionBase({ venceHoy: true });
		expect(calificaParaFiltro(c, "vence_hoy")).toBe(true);
		expect(calificaParaFiltro(c, "sla_hoy")).toBe(false);
	});

	test("calificaParaFiltro('sin_contacto') solo mira sinContacto", () => {
		const c = clasificacionBase({
			slaHoy: true,
			promesaHoy: true,
			incumplida: true,
		});
		expect(calificaParaFiltro(c, "sin_contacto")).toBe(false);
	});
});

describe("ordenColaDia", () => {
	test("prioriza slaHoy > promesaHoy > venceHoy > incumplida > promesaProxima > sinContacto", () => {
		expect(
			ordenColaDia(
				clasificacionBase({
					slaHoy: true,
					promesaHoy: true,
					venceHoy: true,
					incumplida: true,
					sinContacto: true,
				}),
			),
		).toBe(0);
		expect(
			ordenColaDia(
				clasificacionBase({
					promesaHoy: true,
					venceHoy: true,
					incumplida: true,
					sinContacto: true,
				}),
			),
		).toBe(1);
		expect(
			ordenColaDia(
				clasificacionBase({
					venceHoy: true,
					incumplida: true,
					sinContacto: true,
				}),
			),
		).toBe(2);
		expect(
			ordenColaDia(clasificacionBase({ incumplida: true, sinContacto: true })),
		).toBe(3);
		// CB-029: promesa proxima va debajo de las urgentes (4), arriba de sin contacto (5).
		expect(
			ordenColaDia(
				clasificacionBase({ promesaProxima: true, sinContacto: true }),
			),
		).toBe(4);
		expect(ordenColaDia(clasificacionBase({ sinContacto: true }))).toBe(5);
	});
});

describe("clasificarCreditoColaDia - promesa proxima (CB-029)", () => {
	test("promesa futura con alerta ya caida -> promesaProxima, no promesaHoy", () => {
		const MANANA = new Date("2026-08-05T06:00:00.000Z");
		const HOY_ALERTA = new Date("2026-08-04T06:00:00.000Z");
		const c = clasificarCreditoColaDia(
			{
				fechaLimiteSla: null,
				contactadoHoy: false,
				venceHoy: false,
				promesas: [
					{
						estadoPromesa: "pendiente",
						fechaPrometida: MANANA,
						fechaAlerta: HOY_ALERTA,
					},
				],
				diasSinContacto: null,
			},
			HOY_ALERTA,
		);
		expect(c.promesaProxima).toBe(true);
		expect(c.promesaHoy).toBe(false);
		expect(c.incumplida).toBe(false);
	});

	test("promesa futura cuya alerta AUN no cae -> no entra a la cola", () => {
		const EN_TRES_DIAS = new Date("2026-08-07T06:00:00.000Z");
		const HOY = new Date("2026-08-04T06:00:00.000Z");
		const c = clasificarCreditoColaDia(
			{
				fechaLimiteSla: null,
				contactadoHoy: false,
				venceHoy: false,
				promesas: [
					{ estadoPromesa: "pendiente", fechaPrometida: EN_TRES_DIAS },
				],
				diasSinContacto: null,
			},
			HOY,
		);
		// fecha_alerta null -> default D-1 = 2026-08-06, aun futura respecto a hoy.
		expect(c.promesaProxima).toBe(false);
		expect(c.promesaHoy).toBe(false);
	});
});
