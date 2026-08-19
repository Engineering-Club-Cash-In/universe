import { expect, test } from "bun:test";
import { resumirVencimientosAgenda } from "./mi-agenda";

test("resume vencimientos por día y total", () => {
	const resumen = resumirVencimientosAgenda([
		{ dia: 0, total: 2 },
		{ dia: 1, total: 1 },
		{ dia: 3, total: 4 },
	]);

	expect(resumen.total).toBe(7);
	expect(resumen.porDia.get(0)).toBe(2);
	expect(resumen.porDia.get(2)).toBe(0);
});
