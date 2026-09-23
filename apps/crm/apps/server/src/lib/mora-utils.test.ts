import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { CarteraCuotaCredito } from "../types/cartera-back";
import {
	calcularDiasMoraExactos,
	diasMoraDeListado,
	estadoMoraPorCuotasAtrasadas,
} from "./mora-utils";

/**
 * Los "Días de Mora" de la pantalla de cobranza tienen que ser los días
 * REALES de atraso.
 *
 * Por qué este archivo existe: la mora pasó de un bloque mensual fijo a
 * proporcional por día (`capital × 1,12% × min(1, días/30)` por cuota). El
 * listado inventaba los días como `cuotasAtrasadas × 30`, que mientras el
 * monto era un bloque fijo era una etiqueta inofensiva y ahora es una
 * contradicción frente al cliente: "Días de Mora: 30" al lado de Q50,40, que
 * son 3 días. Ese mismo número ordena la lista de cobranza.
 */

const hoy = new Date();
const venceHace = (dias: number): CarteraCuotaCredito => {
	const fecha = new Date(hoy);
	fecha.setDate(fecha.getDate() - dias);
	return {
		fecha_vencimiento: fecha.toISOString(),
	} as CarteraCuotaCredito;
};

describe("diasMoraDeListado: los días vienen de cartera-back, no de cuotas × 30", () => {
	test("pocos días: 3 días de atraso son 3, no 30", () => {
		// El caso que delata la contradicción: con 3 días el monto es una
		// décima parte del cargo mensual. Si acá saliera 30 el asesor anuncia
		// un mes de atraso al lado de un monto de tres días.
		expect(diasMoraDeListado(3)).toBe(3);
	});

	test("varias cuotas vencidas: se muestra lo que manda cartera-back (la más antigua), no la suma ni cuotas × 30", () => {
		// Crédito con cuotas de 65, 35 y 5 días: cartera-back manda 65 (el
		// atraso del crédito). Ni 3 × 30 = 90 ni 105.
		expect(diasMoraDeListado(65)).toBe(65);
	});

	test("sin mora: cero", () => {
		expect(diasMoraDeListado(0)).toBe(0);
	});

	test("cartera-back no mandó el campo (fail-open de la proyección de mora): cero, no NaN", () => {
		expect(diasMoraDeListado(undefined)).toBe(0);
		expect(diasMoraDeListado(null)).toBe(0);
		expect(diasMoraDeListado(Number.NaN)).toBe(0);
	});

	test("nunca negativo: una cuota que aún no vence no es atraso", () => {
		expect(diasMoraDeListado(-5)).toBe(0);
	});

	test("la prioridad se mueve DÍA a día, no en escalones de 30", () => {
		// Lo que rompía el orden: dos créditos con 1 cuota vencida cada uno
		// salían los dos con 30 y quedaban empatados. Con días reales, el que
		// lleva más atraso va primero.
		const masViejo = diasMoraDeListado(28);
		const masNuevo = diasMoraDeListado(2);
		expect(masViejo).toBeGreaterThan(masNuevo);
		expect(masViejo - masNuevo).toBe(26);
	});
});

describe("estadoMoraPorCuotasAtrasadas: el bucket de aging sigue siendo categórico", () => {
	test("cuenta CUOTAS, no días: una cuota de 3 días sigue siendo mora_30", () => {
		expect(estadoMoraPorCuotasAtrasadas(1, "MOROSO")).toBe("mora_30");
	});

	test("el mapeo es el mismo de antes de arreglar los días", () => {
		expect(estadoMoraPorCuotasAtrasadas(0, "ACTIVO")).toBe("al_dia");
		expect(estadoMoraPorCuotasAtrasadas(2, "MOROSO")).toBe("mora_60");
		expect(estadoMoraPorCuotasAtrasadas(3, "MOROSO")).toBe("mora_90");
		expect(estadoMoraPorCuotasAtrasadas(4, "MOROSO")).toBe("mora_120");
		expect(estadoMoraPorCuotasAtrasadas(7, "MOROSO")).toBe("mora_120_plus");
	});

	test("el convenio gana sobre el conteo de cuotas", () => {
		expect(estadoMoraPorCuotasAtrasadas(3, "EN_CONVENIO")).toBe("en_convenio");
	});
});

describe("calcularDiasMoraExactos: el detalle calcula con las fechas que sí tiene", () => {
	test("una cuota con pocos días", () => {
		expect(calcularDiasMoraExactos([venceHace(3)])).toBe(3);
	});

	test("varias cuotas con días distintos: manda la MÁS ANTIGUA", () => {
		expect(
			calcularDiasMoraExactos([venceHace(35), venceHace(65), venceHace(5)]),
		).toBe(65);
	});

	test("sin cuotas atrasadas: cero", () => {
		expect(calcularDiasMoraExactos([])).toBe(0);
	});
});

describe("CONTRATO: ningún camino de cobranza vuelve a multiplicar por 30", () => {
	const fuente = readFileSync(
		new URL("../routers/cobros.ts", import.meta.url),
		"utf8",
	);

	test("el router de cobros no inventa días como cuotas × 30", () => {
		// Los dos sitios que lo hacían: el listado (/getAllCredits, que no trae
		// fechas de cuota) y el proxy del detalle (/credito, que sí las trae).
		expect(fuente).not.toContain("cuotasAtrasadas * 30");
		expect(fuente).not.toContain("cuotasAtrasadas.length * 30");
	});

	test("el listado toma los días del campo de cartera-back", () => {
		expect(fuente).toContain(
			"diasMoraDeListado(credito.diasAtrasoMoraMaximo)",
		);
	});
});
