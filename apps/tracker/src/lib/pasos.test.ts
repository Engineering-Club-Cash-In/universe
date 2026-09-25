import { describe, expect, test } from "bun:test";
import {
	type Caso,
	anioEnGuatemala,
	coincidenciaPrincipal,
	coincidenciasEnPaso,
	etiquetaDeEtapa,
	llegadaEnVentana,
	mesEnGuatemala,
	tuvoAvanceEn,
	ventanaDelMes,
} from "./pasos";

const caso = (parcial: Partial<Caso>): Caso => ({
	id: "11111111-2222-3333-4444-555555555555",
	referencia: "11111111",
	cliente: "Juan P.",
	agencia: "JAC GUATEMALA",
	vehiculo: null,
	valorVehiculo: 100000,
	pasoActual: 1,
	porcentaje: 20,
	estado: "en_proceso",
	cerrado: false,
	actualizadoAt: "2026-07-01T12:00:00.000Z",
	historial: [],
	...parcial,
});

const ABRIL = ventanaDelMes(2026, 4);
const JULIO = ventanaDelMes(2026, 7);

describe("coincidenciasEnPaso sin período", () => {
	test("solo cuenta en la etapa donde está hoy, con su avance actual", () => {
		const c = caso({
			pasoActual: 2,
			porcentaje: 40,
			historial: [
				{ paso: 1, porcentaje: 20, fecha: "2026-04-01T12:00:00.000Z" },
				{ paso: 2, porcentaje: 30, fecha: "2026-05-01T12:00:00.000Z" },
			],
		});

		expect(coincidenciasEnPaso(c, 1, null)).toEqual([]);
		expect(coincidenciasEnPaso(c, 2, null)[0].porcentaje).toBe(40);
	});
});

describe("coincidenciasEnPaso con período", () => {
	test("un caso que ya avanzó a otra etapa no cuenta en la etapa donde estuvo ese mes", () => {
		// Llegó al paso 1 en abril con 20% y hoy va en 80% (paso 3): filtrar
		// por abril + paso 1 ya no debe mostrarlo — solo importa dónde está hoy.
		const c = caso({
			pasoActual: 3,
			porcentaje: 80,
			historial: [
				{ paso: 1, porcentaje: 20, fecha: "2026-04-10T12:00:00.000Z" },
				{ paso: 3, porcentaje: 80, fecha: "2026-07-10T12:00:00.000Z" },
			],
		});

		expect(coincidenciasEnPaso(c, 1, ABRIL)).toEqual([]);
		expect(coincidenciasEnPaso(c, 3, ABRIL)).toEqual([]);
		expect(coincidenciasEnPaso(c, 3, JULIO)[0].porcentaje).toBe(80);
	});

	test("cuenta solo si el avance actual llegó dentro del mes filtrado", () => {
		const c = caso({
			pasoActual: 2,
			porcentaje: 40,
			historial: [
				{ paso: 2, porcentaje: 30, fecha: "2026-04-02T12:00:00.000Z" },
				{ paso: 2, porcentaje: 40, fecha: "2026-07-02T12:00:00.000Z" },
			],
		});

		// En abril el caso ya no estaba en 30% (ese no es su estado actual).
		expect(coincidenciasEnPaso(c, 2, ABRIL)).toEqual([]);
		expect(coincidenciasEnPaso(c, 2, JULIO)[0].porcentaje).toBe(40);
	});

	test("un caso que pasó por dos porcentajes de la misma etapa el mismo mes solo muestra el actual", () => {
		// 30% y luego 40% en julio: antes esto devolvía las dos; ahora solo
		// cuenta el que sigue siendo su estado hoy.
		const c = caso({
			pasoActual: 2,
			porcentaje: 40,
			historial: [
				{ paso: 2, porcentaje: 30, fecha: "2026-07-05T12:00:00.000Z" },
				{ paso: 2, porcentaje: 40, fecha: "2026-07-20T12:00:00.000Z" },
			],
		});

		expect(coincidenciasEnPaso(c, 2, JULIO)).toEqual([
			{ porcentaje: 40, fecha: "2026-07-20T12:00:00.000Z" },
		]);
	});

	test("respeta el huso de Guatemala en los bordes del mes", () => {
		// 2026-05-01T05:00Z sigue siendo 30 de abril en Guatemala (UTC-6).
		const c = caso({
			historial: [
				{ paso: 1, porcentaje: 20, fecha: "2026-05-01T05:00:00.000Z" },
			],
		});

		expect(coincidenciasEnPaso(c, 1, ABRIL)).toHaveLength(1);
		expect(coincidenciasEnPaso(c, 1, ventanaDelMes(2026, 5))).toEqual([]);
	});
});

describe("tuvoAvanceEn", () => {
	test("es true solo si el caso llegó a su estado actual dentro del período", () => {
		const c = caso({
			pasoActual: 1,
			porcentaje: 20,
			historial: [{ paso: 1, porcentaje: 20, fecha: "2026-04-10T12:00:00.000Z" }],
		});

		expect(tuvoAvanceEn(c, ABRIL)).toBe(true);
		expect(tuvoAvanceEn(c, ventanaDelMes(2026, 5))).toBe(false);
	});

	test("es false si el movimiento del mes fue a una etapa que el caso ya dejó atrás", () => {
		// El caso pasó por el 20% en abril, pero hoy va en 30%: para el filtro
		// de abril esto ya no es "avance" del estado actual.
		const c = caso({
			pasoActual: 2,
			porcentaje: 30,
			historial: [
				{ paso: 1, porcentaje: 20, fecha: "2026-04-10T12:00:00.000Z" },
				{ paso: 2, porcentaje: 30, fecha: "2026-07-10T12:00:00.000Z" },
			],
		});

		expect(tuvoAvanceEn(c, ABRIL)).toBe(false);
		expect(tuvoAvanceEn(c, JULIO)).toBe(true);
	});
});

describe("anioEnGuatemala", () => {
	test("usa el mismo borde UTC-6 que ventanaDelMes", () => {
		// 06:00Z del 1 de enero es medianoche en Guatemala: ahí empieza el año.
		expect(anioEnGuatemala("2026-01-01T06:00:00.000Z")).toBe(2026);
		expect(anioEnGuatemala("2026-01-01T05:59:59.000Z")).toBe(2025);
	});

	test("coincide con el inicio de la ventana de enero", () => {
		const enero = ventanaDelMes(2026, 1);
		expect(anioEnGuatemala(new Date(enero.inicio))).toBe(2026);
		expect(anioEnGuatemala(new Date(enero.inicio - 1))).toBe(2025);
	});

	test("una marca de fin de año se atribuye al año que corresponde en Guatemala", () => {
		// 31 de diciembre 20:00 GT, aunque en UTC ya sea 1 de enero.
		expect(anioEnGuatemala("2027-01-01T02:00:00.000Z")).toBe(2026);
	});
});

describe("mesEnGuatemala", () => {
	test("usa el mismo borde UTC-6 que ventanaDelMes", () => {
		expect(mesEnGuatemala("2026-09-01T06:00:00.000Z")).toBe(9);
		expect(mesEnGuatemala("2026-09-01T05:59:59.000Z")).toBe(8);
	});

	test("cruza de diciembre a enero en el borde de año", () => {
		expect(mesEnGuatemala("2027-01-01T05:59:59.000Z")).toBe(12); // aún dic 2026 en GT
		expect(mesEnGuatemala("2027-01-01T06:00:00.000Z")).toBe(1);
	});

	test("coincide con el inicio de ventanaDelMes", () => {
		const septiembre = ventanaDelMes(2026, 9);
		expect(mesEnGuatemala(new Date(septiembre.inicio))).toBe(9);
		expect(mesEnGuatemala(new Date(septiembre.inicio - 1))).toBe(8);
	});
});

describe("etiquetaDeEtapa", () => {
	test("no anuncia el desembolso mientras la oportunidad sigue abierta", () => {
		// Se llega al paso 5 al aprobar el checklist, pero contabilidad ejecuta el
		// pago después: ahí el caso todavía está en proceso.
		expect(etiquetaDeEtapa(5, "en_proceso")).toBe("100%");

		expect(etiquetaDeEtapa(5, "desembolsado")).toBe("Finalizada");
	});

	test("en el paso 5 un caso en pausa muestra solo el porcentaje", () => {
		expect(etiquetaDeEtapa(5, "en_pausa")).toBe("100%");
	});

	test("en los demás pasos muestra el rango de avance", () => {
		expect(etiquetaDeEtapa(2, "en_proceso")).toBe("30–40%");
	});

	test("un caso rechazado dice 'No aprobado' en cualquier paso", () => {
		expect(etiquetaDeEtapa(2, "rechazado")).toBe("No aprobado");
		expect(etiquetaDeEtapa(5, "rechazado")).toBe("No aprobado");
	});

	test("un caso ganado en el paso 5 dice 'Aprobado', no 'En proceso'", () => {
		// won ya recorrió todo el pipeline: no es "en proceso" (todavía se
		// mueve por el pipeline), pero tampoco "Finalizada" (no hay señal de
		// que contabilidad ya haya pagado).
		expect(etiquetaDeEtapa(5, "aprobado")).toBe("Aprobado");
	});

	test("un caso ganado capturado fuera del paso 5 no se fuerza a 'Aprobado'", () => {
		// Dato mal capturado en el CRM (sección 8.1 del doc): no se finge que
		// llegó al final si la etapa real dice otra cosa.
		expect(etiquetaDeEtapa(4, "aprobado")).toBe("85–90%");
	});
});

describe("coincidenciaPrincipal", () => {
	const marcas = [
		{ porcentaje: 30, fecha: "2026-07-05T12:00:00.000Z" },
		{ porcentaje: 40, fecha: "2026-07-20T12:00:00.000Z" },
	];

	test("sin porcentaje filtrado usa la primera llegada", () => {
		expect(coincidenciaPrincipal(marcas, null)?.porcentaje).toBe(30);
	});

	test("con porcentaje filtrado usa esa llegada", () => {
		expect(coincidenciaPrincipal(marcas, 40)?.fecha).toBe(
			"2026-07-20T12:00:00.000Z",
		);
	});

	test("sin llegadas devuelve null", () => {
		expect(coincidenciaPrincipal([], 30)).toBeNull();
	});
});

describe("llegadaEnVentana", () => {
	test("solo cuenta la llegada al estado actual, no la de una etapa ya superada", () => {
		// Entró al paso 2 en julio, pero hoy va en el paso 4 (llegó en agosto):
		// julio ya no debe mostrarlo, porque 30% dejó de ser su estado.
		const c = caso({
			pasoActual: 4,
			porcentaje: 85,
			historial: [
				{ paso: 2, porcentaje: 30, fecha: "2026-07-10T12:00:00.000Z" },
				{ paso: 4, porcentaje: 85, fecha: "2026-08-02T12:00:00.000Z" },
			],
		});

		expect(llegadaEnVentana(c, JULIO)).toBeNull();
		expect(llegadaEnVentana(c, ventanaDelMes(2026, 8))?.porcentaje).toBe(85);
	});

	test("devuelve null si el estado actual llegó fuera de la ventana pedida", () => {
		const c = caso({
			pasoActual: 1,
			porcentaje: 20,
			historial: [{ paso: 1, porcentaje: 20, fecha: "2026-04-10T12:00:00.000Z" }],
		});

		expect(llegadaEnVentana(c, ABRIL)?.porcentaje).toBe(20);
		expect(llegadaEnVentana(c, JULIO)).toBeNull();
	});
});
