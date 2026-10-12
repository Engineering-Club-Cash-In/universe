import { describe, expect, test } from "bun:test";
import { bucketsDelFunnelSiHaceFalta } from "./cartera-filtros";

describe("bucketsDelFunnelSiHaceFalta", () => {
	test("con cola o alerta de promesa y sin etapa pide los buckets 0 a 5", () => {
		expect(bucketsDelFunnelSiHaceFalta({ cola: "sin_contacto" })).toEqual([
			0, 1, 2, 3, 4, 5,
		]);
		expect(bucketsDelFunnelSiHaceFalta({ alertaPromesa: "vencida" })).toEqual([
			0, 1, 2, 3, 4, 5,
		]);
	});

	test("el segmento «todas» también pide los buckets 0 a 5", () => {
		expect(bucketsDelFunnelSiHaceFalta({ cola: "todas" })).toEqual([
			0, 1, 2, 3, 4, 5,
		]);
		expect(bucketsDelFunnelSiHaceFalta({ alertaPromesa: "todas" })).toEqual([
			0, 1, 2, 3, 4, 5,
		]);
	});

	test("con una etapa explícita no toca nada", () => {
		expect(
			bucketsDelFunnelSiHaceFalta({ estadoMora: "mora_30", cola: "sla_hoy" }),
		).toBeUndefined();
	});

	test("las alertas de convenio y los demás filtros no lo necesitan", () => {
		expect(
			bucketsDelFunnelSiHaceFalta({ alertaConvenio: "vencida" } as never),
		).toBeUndefined();
		expect(bucketsDelFunnelSiHaceFalta({})).toBeUndefined();
	});

	test("devuelve una copia: modificarla no altera la constante", () => {
		const a = bucketsDelFunnelSiHaceFalta({ cola: "x" }) as number[];
		a.push(99);
		expect(bucketsDelFunnelSiHaceFalta({ cola: "x" })).toEqual([
			0, 1, 2, 3, 4, 5,
		]);
	});
});
