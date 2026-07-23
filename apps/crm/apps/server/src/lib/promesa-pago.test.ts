import { describe, expect, test } from "bun:test";
import type { CreditoDirectoResponse } from "../types/cartera-back";
import { derivarEstadoCredito, evaluarPromesa } from "./promesa-pago";

/** Solo los campos que derivarEstadoCredito lee — el resto no importa aquí. */
function creditoFixture(
	overrides: Partial<
		Pick<CreditoDirectoResponse, "cuotasPagadas" | "mora" | "moraActual">
	>,
): CreditoDirectoResponse {
	return {
		cuotasPagadas: [],
		moraActual: "0",
		mora: null,
		...overrides,
	} as CreditoDirectoResponse;
}

function cuotaPagada(numero_cuota: number) {
	return { numero_cuota } as CreditoDirectoResponse["cuotasPagadas"][number];
}

describe("derivarEstadoCredito", () => {
	test("mora null (dato real: no hay mora activa) → saldada", () => {
		const { moraSaldada } = derivarEstadoCredito(
			creditoFixture({ mora: null }),
		);
		expect(moraSaldada).toBe(true);
	});

	test("mora undefined (campo ausente, dato faltante) → NO saldada (fail-safe)", () => {
		const credito = creditoFixture({ mora: undefined });
		const { moraSaldada } = derivarEstadoCredito(credito);
		expect(moraSaldada).toBe(false);
	});

	test("mora.activa=true con monto > 0 → NO saldada", () => {
		const { moraSaldada } = derivarEstadoCredito(
			creditoFixture({
				mora: { activa: true } as CreditoDirectoResponse["mora"],
				moraActual: "205.79",
			}),
		);
		expect(moraSaldada).toBe(false);
	});

	test("mora.activa=true pero monto <= 0 → saldada", () => {
		const { moraSaldada } = derivarEstadoCredito(
			creditoFixture({
				mora: { activa: true } as CreditoDirectoResponse["mora"],
				moraActual: "0.00",
			}),
		);
		expect(moraSaldada).toBe(true);
	});

	test("mora.activa=false → saldada sin importar el monto", () => {
		const { moraSaldada } = derivarEstadoCredito(
			creditoFixture({
				mora: { activa: false } as CreditoDirectoResponse["mora"],
				moraActual: "999",
			}),
		);
		expect(moraSaldada).toBe(true);
	});

	test("cuotasPagadas se indexa por numero_cuota", () => {
		const { cuotasPagadasSet } = derivarEstadoCredito(
			creditoFixture({
				cuotasPagadas: [cuotaPagada(1), cuotaPagada(2)],
			}),
		);
		expect(cuotasPagadasSet.has(1)).toBe(true);
		expect(cuotasPagadasSet.has(2)).toBe(true);
		expect(cuotasPagadasSet.has(3)).toBe(false);
	});
});

describe("evaluarPromesa", () => {
	const hoy = new Date("2026-07-22T12:00:00Z");
	const futuro = new Date("2026-07-31T06:00:00Z");
	const pasado = new Date("2026-07-01T06:00:00Z");

	test("rango completo pagado, sin mora → cumplida", () => {
		const estadoCredito = derivarEstadoCredito(
			creditoFixture({ cuotasPagadas: [cuotaPagada(1), cuotaPagada(2)] }),
		);
		const estado = evaluarPromesa(
			{
				id: "p1",
				cuotaInicio: 1,
				cuotaFin: 2,
				incluyeMora: false,
				fechaPrometida: futuro,
			},
			estadoCredito,
			hoy,
		);
		expect(estado).toBe("cumplida");
	});

	// Fila legacy (creada antes del .refine() en createContactoCobros, o con
	// columnas NULL por default sin backfill) — confirmado con datos reales
	// en dev: filas con cuota_inicio/cuota_fin/incluye_mora en null/null/false.
	// Sin rango y sin mora no hay NINGUNA obligación que verificar: no debe
	// marcarse "cumplida" automática solo porque ambos chequeos "no aplican".
	test("sin rango Y sin mora (fila legacy), fecha futura → pendiente, NUNCA cumplida automática", () => {
		const estadoCredito = derivarEstadoCredito(creditoFixture({}));
		const estado = evaluarPromesa(
			{
				id: "p1",
				cuotaInicio: null,
				cuotaFin: null,
				incluyeMora: false,
				fechaPrometida: futuro,
			},
			estadoCredito,
			hoy,
		);
		expect(estado).toBe("pendiente");
	});

	test("sin rango Y sin mora (fila legacy), fecha ya pasada → incumplida (no cumplida)", () => {
		const estadoCredito = derivarEstadoCredito(creditoFixture({}));
		const estado = evaluarPromesa(
			{
				id: "p1",
				cuotaInicio: null,
				cuotaFin: null,
				incluyeMora: false,
				fechaPrometida: pasado,
			},
			estadoCredito,
			hoy,
		);
		expect(estado).toBe("incumplida");
	});

	test("rango parcialmente pagado (falta 1 cuota), fecha futura → pendiente", () => {
		const estadoCredito = derivarEstadoCredito(
			creditoFixture({ cuotasPagadas: [cuotaPagada(1)] }),
		);
		const estado = evaluarPromesa(
			{
				id: "p1",
				cuotaInicio: 1,
				cuotaFin: 2,
				incluyeMora: false,
				fechaPrometida: futuro,
			},
			estadoCredito,
			hoy,
		);
		expect(estado).toBe("pendiente");
	});

	test("rango incompleto, fecha ya pasada → incumplida", () => {
		const estadoCredito = derivarEstadoCredito(
			creditoFixture({ cuotasPagadas: [cuotaPagada(1)] }),
		);
		const estado = evaluarPromesa(
			{
				id: "p1",
				cuotaInicio: 1,
				cuotaFin: 2,
				incluyeMora: false,
				fechaPrometida: pasado,
			},
			estadoCredito,
			hoy,
		);
		expect(estado).toBe("incumplida");
	});

	test("solo mora (sin rango): cuotas pagadas irrelevante, mora saldada → cumplida", () => {
		const estadoCredito = derivarEstadoCredito(
			creditoFixture({
				mora: { activa: false } as CreditoDirectoResponse["mora"],
			}),
		);
		const estado = evaluarPromesa(
			{
				id: "p1",
				cuotaInicio: null,
				cuotaFin: null,
				incluyeMora: true,
				fechaPrometida: futuro,
			},
			estadoCredito,
			hoy,
		);
		expect(estado).toBe("cumplida");
	});

	test("solo mora: mora sigue activa, fecha pasada → incumplida", () => {
		const estadoCredito = derivarEstadoCredito(
			creditoFixture({
				mora: { activa: true } as CreditoDirectoResponse["mora"],
				moraActual: "50",
			}),
		);
		const estado = evaluarPromesa(
			{
				id: "p1",
				cuotaInicio: null,
				cuotaFin: null,
				incluyeMora: true,
				fechaPrometida: pasado,
			},
			estadoCredito,
			hoy,
		);
		expect(estado).toBe("incumplida");
	});

	test("rango pagado PERO mora activa con incluyeMora=true → NO cumplida (chequeo doble)", () => {
		const estadoCredito = derivarEstadoCredito(
			creditoFixture({
				cuotasPagadas: [cuotaPagada(1), cuotaPagada(2)],
				mora: { activa: true } as CreditoDirectoResponse["mora"],
				moraActual: "50",
			}),
		);
		const estado = evaluarPromesa(
			{
				id: "p1",
				cuotaInicio: 1,
				cuotaFin: 2,
				incluyeMora: true,
				fechaPrometida: pasado,
			},
			estadoCredito,
			hoy,
		);
		expect(estado).toBe("incumplida");
	});

	test("rango pagado, mora activa PERO incluyeMora=false → cumplida (mora no aplica)", () => {
		const estadoCredito = derivarEstadoCredito(
			creditoFixture({
				cuotasPagadas: [cuotaPagada(1), cuotaPagada(2)],
				mora: { activa: true } as CreditoDirectoResponse["mora"],
				moraActual: "50",
			}),
		);
		const estado = evaluarPromesa(
			{
				id: "p1",
				cuotaInicio: 1,
				cuotaFin: 2,
				incluyeMora: false,
				fechaPrometida: pasado,
			},
			estadoCredito,
			hoy,
		);
		expect(estado).toBe("cumplida");
	});

	test("fechaPrometida = hoy exacto (mismo instante) → NO incumplida todavía", () => {
		const estadoCredito = derivarEstadoCredito(
			creditoFixture({ cuotasPagadas: [] }),
		);
		const estado = evaluarPromesa(
			{
				id: "p1",
				cuotaInicio: 1,
				cuotaFin: 1,
				incluyeMora: false,
				fechaPrometida: hoy,
			},
			estadoCredito,
			hoy,
		);
		expect(estado).toBe("pendiente");
	});

	// Caso real que el test anterior NO cubría (comparaba mismo instante
	// exacto) — el que Codex encontró en review: fechaPrometida es medianoche
	// GT del día prometido, pero "hoy" durante ESE MISMO día ya tiene hora
	// avanzada. Debe seguir "pendiente" durante todo el día prometido.
	test("fechaPrometida = medianoche GT de HOY, hora actual avanzada el MISMO día → sigue pendiente (gracia real del día)", () => {
		const medianochePrometida = new Date("2026-07-22T06:00:00.000Z"); // 00:00 GT
		const mediodiaMismoDia = new Date("2026-07-22T18:00:00.000Z"); // 12:00 GT, mismo día
		const estadoCredito = derivarEstadoCredito(
			creditoFixture({ cuotasPagadas: [] }),
		);
		const estado = evaluarPromesa(
			{
				id: "p1",
				cuotaInicio: 1,
				cuotaFin: 1,
				incluyeMora: false,
				fechaPrometida: medianochePrometida,
			},
			estadoCredito,
			mediodiaMismoDia,
		);
		expect(estado).toBe("pendiente");
	});

	test("fechaPrometida = medianoche GT de AYER, hoy ya es el día siguiente → incumplida", () => {
		const medianochePrometidaAyer = new Date("2026-07-22T06:00:00.000Z"); // 00:00 GT del 22
		const hoySiguienteDia = new Date("2026-07-23T07:00:00.000Z"); // 01:00 GT del 23 — ya pasó
		const estadoCredito = derivarEstadoCredito(
			creditoFixture({ cuotasPagadas: [] }),
		);
		const estado = evaluarPromesa(
			{
				id: "p1",
				cuotaInicio: 1,
				cuotaFin: 1,
				incluyeMora: false,
				fechaPrometida: medianochePrometidaAyer,
			},
			estadoCredito,
			hoySiguienteDia,
		);
		expect(estado).toBe("incumplida");
	});

	test("cuota única (cuotaInicio === cuotaFin)", () => {
		const estadoCredito = derivarEstadoCredito(
			creditoFixture({ cuotasPagadas: [cuotaPagada(5)] }),
		);
		const estado = evaluarPromesa(
			{
				id: "p1",
				cuotaInicio: 5,
				cuotaFin: 5,
				incluyeMora: false,
				fechaPrometida: futuro,
			},
			estadoCredito,
			hoy,
		);
		expect(estado).toBe("cumplida");
	});
});
