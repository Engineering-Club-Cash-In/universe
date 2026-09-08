import { describe, expect, it } from "bun:test";
import { estaVencidaGT, hoyEnGuatemala } from "./date-utils";

describe("hoyEnGuatemala", () => {
	it("devuelve el día GT, no el UTC, en la ventana de las últimas 6 horas", () => {
		// 2026-09-09T02:00Z todavía es 8 de septiembre en Guatemala (UTC-6).
		expect(hoyEnGuatemala(new Date("2026-09-09T02:00:00.000Z"))).toBe(
			"2026-09-08",
		);
		expect(hoyEnGuatemala(new Date("2026-09-09T06:00:00.000Z"))).toBe(
			"2026-09-09",
		);
	});
});

describe("estaVencidaGT", () => {
	// El caso que reportó Codex: durante casi todo el día,
	// `new Date("2026-09-08") < new Date()` da true y la cuota de HOY se
	// marcaba vencida.
	const mediodiaGT = new Date("2026-09-08T18:00:00.000Z");

	it("la cuota que vence HOY no está vencida", () => {
		expect(estaVencidaGT("2026-09-08", mediodiaGT)).toBe(false);
		// Sanity check de la trampa que motiva el helper.
		expect(new Date("2026-09-08") < mediodiaGT).toBe(true);
	});

	it("la cuota de ayer sí está vencida", () => {
		expect(estaVencidaGT("2026-09-07", mediodiaGT)).toBe(true);
	});

	it("la cuota futura no está vencida", () => {
		expect(estaVencidaGT("2026-09-09", mediodiaGT)).toBe(false);
	});

	it("tolera timestamps completos quedándose con la fecha", () => {
		expect(estaVencidaGT("2026-09-07T00:00:00.000Z", mediodiaGT)).toBe(true);
		expect(estaVencidaGT("2026-09-08T00:00:00.000Z", mediodiaGT)).toBe(false);
	});

	it("sin fecha o con basura no inventa un vencimiento", () => {
		expect(estaVencidaGT(null, mediodiaGT)).toBe(false);
		expect(estaVencidaGT(undefined, mediodiaGT)).toBe(false);
		expect(estaVencidaGT("", mediodiaGT)).toBe(false);
		expect(estaVencidaGT("no es fecha", mediodiaGT)).toBe(false);
	});

	it("cerca de la medianoche UTC sigue mandando el día de Guatemala", () => {
		// 9 de septiembre 02:00Z = 8 de septiembre 20:00 GT.
		const nocheGT = new Date("2026-09-09T02:00:00.000Z");
		expect(estaVencidaGT("2026-09-08", nocheGT)).toBe(false);
		expect(estaVencidaGT("2026-09-07", nocheGT)).toBe(true);
	});
});
