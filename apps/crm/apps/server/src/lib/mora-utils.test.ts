import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { CarteraCuotaCredito } from "../types/cartera-back";
import {
	calcularDiasMoraExactos,
	diasMoraDeListado,
	estadoMoraPorCuotasAtrasadas,
	fechaCalendarioGT,
	hoyCalendarioGT,
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

/**
 * El reloj se congela en TODOS estos casos: el defecto que se arregla acá sólo
 * aparece a ciertas horas del día, así que un test que use la hora real pasa
 * por casualidad 18 horas de cada 24.
 *
 * El defecto: `fecha_vencimiento` es una fecha de CALENDARIO ("2026-09-22") y
 * se la restaba contra `new Date()`, que es un INSTANTE. Como el server corre
 * en UTC y Guatemala es UTC−6, entre las 00:00 y las 05:59 UTC el instante ya
 * cambió de día y Guatemala no: el atraso salía inflado en un día durante toda
 * la tarde y noche de Guatemala.
 */
describe("calcularDiasMoraExactos: el detalle cuenta días de calendario de Guatemala", () => {
	const cuotaQueVence = (fecha: string) =>
		({ fecha_vencimiento: fecha }) as CarteraCuotaCredito;

	afterEach(() => {
		setSystemTime();
	});

	describe("la franja del defecto: 00:00–05:59 UTC, que en Guatemala es la tarde/noche del día ANTERIOR", () => {
		test("03:00 UTC del 23: en Guatemala son las 21:00 del 22, y una cuota que vence el 22 NO tiene atraso", () => {
			// El caso medido. Antes reportaba 1 día: le anunciaba mora al
			// cliente el día que la cuota vence, y contradecía a cartera-back,
			// que sí cuenta en calendario de Guatemala.
			setSystemTime(new Date("2026-09-23T03:00:00.000Z"));
			expect(calcularDiasMoraExactos([cuotaQueVence("2026-09-22")])).toBe(0);
		});

		test("00:00 UTC en punto: el borde de arriba de la franja", () => {
			setSystemTime(new Date("2026-09-23T00:00:00.000Z"));
			expect(calcularDiasMoraExactos([cuotaQueVence("2026-09-22")])).toBe(0);
		});

		test("05:59 UTC: el último minuto de la franja, todavía el 22 en Guatemala", () => {
			setSystemTime(new Date("2026-09-23T05:59:59.999Z"));
			expect(calcularDiasMoraExactos([cuotaQueVence("2026-09-22")])).toBe(0);
		});

		test("06:00 UTC: recién ahí Guatemala pasa al 23 y la cuota del 22 lleva 1 día", () => {
			setSystemTime(new Date("2026-09-23T06:00:00.000Z"));
			expect(calcularDiasMoraExactos([cuotaQueVence("2026-09-22")])).toBe(1);
		});

		test("dentro de la franja, una cuota que venció AYER en Guatemala lleva 1 día, no 2", () => {
			setSystemTime(new Date("2026-09-23T03:00:00.000Z"));
			expect(calcularDiasMoraExactos([cuotaQueVence("2026-09-21")])).toBe(1);
		});
	});

	test("mediodía UTC: en Guatemala ya es el mismo día y la cuenta es la de siempre", () => {
		setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
		expect(calcularDiasMoraExactos([cuotaQueVence("2026-09-20")])).toBe(3);
	});

	describe("cambio de mes", () => {
		test("03:00 UTC del 1-oct: en Guatemala todavía es 30-sep, y la cuota del 30 no vence", () => {
			setSystemTime(new Date("2026-10-01T03:00:00.000Z"));
			expect(calcularDiasMoraExactos([cuotaQueVence("2026-09-30")])).toBe(0);
		});

		test("cruza el mes completo: del 31-ago al 30-sep son 30 días", () => {
			setSystemTime(new Date("2026-10-01T03:00:00.000Z"));
			expect(calcularDiasMoraExactos([cuotaQueVence("2026-08-31")])).toBe(30);
		});
	});

	test("cuota futura: no es atraso, nunca negativo", () => {
		setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
		expect(calcularDiasMoraExactos([cuotaQueVence("2026-10-15")])).toBe(0);
	});

	test("varias cuotas con días distintos: manda la MÁS ANTIGUA", () => {
		setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
		expect(
			calcularDiasMoraExactos([
				cuotaQueVence("2026-08-19"), // 35 días
				cuotaQueVence("2026-07-20"), // 65 días
				cuotaQueVence("2026-09-18"), // 5 días
			]),
		).toBe(65);
	});

	test("sin cuotas atrasadas: cero", () => {
		setSystemTime(new Date("2026-09-23T03:00:00.000Z"));
		expect(calcularDiasMoraExactos([])).toBe(0);
	});

	test("si la fecha viniera con hora pegada, se cuenta el mismo día de calendario", () => {
		// Hoy `cuotas_credito.fecha_vencimiento` es una columna `date` y llega
		// como "2026-09-22". Si algún día llegara con hora, la hora de una
		// fecha de calendario no significa nada y no puede correr el día.
		setSystemTime(new Date("2026-09-23T03:00:00.000Z"));
		expect(
			calcularDiasMoraExactos([cuotaQueVence("2026-09-22T00:00:00.000Z")]),
		).toBe(0);
		expect(
			calcularDiasMoraExactos([cuotaQueVence("2026-09-22 00:00:00")]),
		).toBe(0);
	});

	test("una fecha ilegible se saltea en vez de devolver NaN a la base", () => {
		// `dias_mora_maximo` de casos_cobros se ESCRIBE con este número.
		setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
		expect(
			calcularDiasMoraExactos([
				cuotaQueVence("2026-09"),
				cuotaQueVence("2026-09-20"),
			]),
		).toBe(3);
		expect(calcularDiasMoraExactos([cuotaQueVence("basura")])).toBe(0);
	});
});

describe("fechaCalendarioGT: una fecha de calendario nunca pasa por conversión de zona", () => {
	test("lee los primeros 10 caracteres, sin importar qué venga después", () => {
		expect(fechaCalendarioGT("2026-09-22")).toBe(Date.UTC(2026, 8, 22));
		expect(fechaCalendarioGT("2026-09-22T00:00:00.000Z")).toBe(
			Date.UTC(2026, 8, 22),
		);
	});

	test("un string truncado es NaN, no una fecha inventada", () => {
		// `Number("")` es 0: sin validar la forma, "2026-09" devolvía en
		// silencio el 31-ago-2026.
		expect(fechaCalendarioGT("2026-09")).toBeNaN();
		expect(fechaCalendarioGT("")).toBeNaN();
	});
});

describe("hoyCalendarioGT: el día de hoy sale de la zona de Guatemala, no del proceso", () => {
	afterEach(() => {
		setSystemTime();
	});

	test("en la franja 00:00–05:59 UTC el proceso ya cambió de día y Guatemala no", () => {
		setSystemTime(new Date("2026-09-23T03:00:00.000Z"));
		expect(hoyCalendarioGT()).toBe(Date.UTC(2026, 8, 22));
	});

	test("a partir de las 06:00 UTC los dos coinciden", () => {
		setSystemTime(new Date("2026-09-23T06:00:00.000Z"));
		expect(hoyCalendarioGT()).toBe(Date.UTC(2026, 8, 23));
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
