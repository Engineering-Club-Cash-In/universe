import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * La ficha del caso pintaba "Días de Mora" leyendo el BUCKET de aging
 * (`estadoMora`), así que siempre decía 30 / 60 / 90 / 120+. Con la mora
 * proporcional por día eso queda al lado de un monto que corresponde a los
 * días reales —Q50,40 son 3 días, no 30— y el cliente saca la cuenta.
 *
 * El caso ya trae `diasMoraMaximo`, que se calcula con las fechas de
 * vencimiento reales (`calcularDiasMoraExactos`); sólo no se usaba.
 */
const fuente = readFileSync(
	new URL("../../routes/cobros/$id.tsx", import.meta.url),
	"utf8",
);

describe("ficha del caso: Días de Mora", () => {
	it("no deriva los días del bucket de categoría", () => {
		const bloque = fuente.slice(
			fuente.indexOf("Días de Mora:"),
			fuente.indexOf("Días de Mora:") + 900,
		);
		expect(bloque).not.toContain('estadoMora === "mora_30"');
		expect(bloque).not.toContain('estadoMora === "mora_120"');
	});

	it("muestra los días reales que el caso ya tiene", () => {
		expect(fuente).toContain("{caso.diasMoraMaximo ?? 0} días");
	});
});
