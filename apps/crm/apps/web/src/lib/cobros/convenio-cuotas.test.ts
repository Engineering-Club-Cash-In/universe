import { describe, expect, it } from "bun:test";
import {
	cuotasElegiblesParaConvenio,
	type FilaHistorialCuota,
	soloVencidasYActual,
} from "./convenio-cuotas";

/** Mediodía en Guatemala del 8 de septiembre. */
const AHORA = new Date("2026-09-08T18:00:00.000Z");

function fila(over: Partial<FilaHistorialCuota> = {}): FilaHistorialCuota {
	return {
		id: 100,
		numeroCuota: 1,
		fechaVencimiento: "2026-07-08",
		montoCuota: "3698.94",
		estadoMora: "pendiente",
		...over,
	};
}

describe("cuotasElegiblesParaConvenio", () => {
	it("deja las pendientes y marca vencida por día calendario GT", () => {
		const r = cuotasElegiblesParaConvenio(
			[
				fila({ id: 1, numeroCuota: 1, fechaVencimiento: "2026-07-08" }),
				fila({ id: 2, numeroCuota: 2, fechaVencimiento: "2026-09-08" }),
				fila({ id: 3, numeroCuota: 3, fechaVencimiento: "2026-10-08" }),
			],
			3698.94,
			AHORA,
		);
		expect(r.map((c) => [c.numeroCuota, c.vencida])).toEqual([
			[1, true],
			// La que vence HOY es la actual, no una vencida.
			[2, false],
			[3, false],
		]);
	});

	it("descarta las pagadas y las que están en validación completa", () => {
		const r = cuotasElegiblesParaConvenio(
			[
				fila({ id: 1, numeroCuota: 1 }),
				fila({ id: 2, numeroCuota: 2, estadoMora: "pagado" }),
				fila({ id: 3, numeroCuota: 3, estadoMora: "en_validacion" }),
			],
			3698.94,
			AHORA,
		);
		expect(r.map((c) => c.numeroCuota)).toEqual([1]);
	});

	it("descarta el abono parcial pendiente de validación aunque diga 'pendiente'", () => {
		// El caso que reportó Codex: cartera la saca de cuotasPendientes, así
		// que el server la rechazaría; el único indicio acá es la bandera.
		const r = cuotasElegiblesParaConvenio(
			[
				fila({ id: 1, numeroCuota: 1 }),
				fila({
					id: 2,
					numeroCuota: 2,
					estadoMora: "pendiente",
					en_validacion: true,
				}),
			],
			3698.94,
			AHORA,
		);
		expect(r.map((c) => c.numeroCuota)).toEqual([1]);
	});

	it("cae a la cuota mensual del caso cuando la fila no trae monto", () => {
		const r = cuotasElegiblesParaConvenio(
			[fila({ montoCuota: null })],
			2568.16,
			AHORA,
		);
		expect(r[0].monto).toBe(2568.16);
	});
});

describe("soloVencidasYActual", () => {
	const base = [
		{ cuotaId: 1, numeroCuota: 1, monto: 100, vencida: true },
		{ cuotaId: 2, numeroCuota: 2, monto: 100, vencida: true },
		{ cuotaId: 3, numeroCuota: 3, monto: 100, vencida: false },
		{ cuotaId: 4, numeroCuota: 4, monto: 100, vencida: false },
	];

	it("deja las vencidas y solo la primera no vencida", () => {
		expect(soloVencidasYActual(base).map((c) => c.numeroCuota)).toEqual([
			1, 2, 3,
		]);
	});

	it("ordena aunque lleguen desordenadas", () => {
		const desordenadas = [base[3], base[1], base[2], base[0]];
		expect(soloVencidasYActual(desordenadas).map((c) => c.numeroCuota)).toEqual(
			[1, 2, 3],
		);
	});

	it("sin vencidas deja solo la actual", () => {
		expect(
			soloVencidasYActual([base[2], base[3]]).map((c) => c.numeroCuota),
		).toEqual([3]);
	});

	it("sin cuota futura deja solo las vencidas", () => {
		expect(
			soloVencidasYActual([base[0], base[1]]).map((c) => c.numeroCuota),
		).toEqual([1, 2]);
	});

	it("con lista vacía no explota", () => {
		expect(soloVencidasYActual([])).toEqual([]);
	});
});
