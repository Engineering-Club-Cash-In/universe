import { describe, expect, test } from "bun:test";
import {
	type Caso,
	anioEnGuatemala,
	coincidenciaEnPaso,
	tuvoAvanceEn,
	ventanaDelMes,
} from "./pasos";

const caso = (parcial: Partial<Caso>): Caso => ({
	id: "11111111-2222-3333-4444-555555555555",
	referencia: "11111111",
	cliente: "Juan P.",
	agencia: "JAC GUATEMALA",
	vehiculo: null,
	monto: 100000,
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

describe("coincidenciaEnPaso sin período", () => {
	test("solo cuenta en la etapa donde está hoy, con su avance actual", () => {
		const c = caso({
			pasoActual: 2,
			porcentaje: 40,
			historial: [
				{ paso: 1, porcentaje: 20, fecha: "2026-04-01T12:00:00.000Z" },
				{ paso: 2, porcentaje: 30, fecha: "2026-05-01T12:00:00.000Z" },
			],
		});

		expect(coincidenciaEnPaso(c, 1, null)).toBeNull();
		expect(coincidenciaEnPaso(c, 2, null)?.porcentaje).toBe(40);
	});
});

describe("coincidenciaEnPaso con período", () => {
	test("usa el porcentaje de la llegada, no el avance actual", () => {
		// Llegó al paso 1 en abril con 20% y hoy va en 80%: el filtro de abril
		// para el paso 1 tiene que ofrecer 20%, no 80%.
		const c = caso({
			pasoActual: 3,
			porcentaje: 80,
			historial: [
				{ paso: 1, porcentaje: 20, fecha: "2026-04-10T12:00:00.000Z" },
				{ paso: 3, porcentaje: 80, fecha: "2026-07-10T12:00:00.000Z" },
			],
		});

		expect(coincidenciaEnPaso(c, 1, ABRIL)?.porcentaje).toBe(20);
		expect(coincidenciaEnPaso(c, 3, ABRIL)).toBeNull();
		expect(coincidenciaEnPaso(c, 3, JULIO)?.porcentaje).toBe(80);
	});

	test("toma la llegada más antigua aunque el historial venga desordenado", () => {
		// El servidor ordena por porcentaje: un caso creado en 40% que retrocede a
		// 30% trae primero la entrada más nueva. La llegada real es la de abril.
		const c = caso({
			pasoActual: 2,
			porcentaje: 30,
			historial: [
				{ paso: 2, porcentaje: 30, fecha: "2026-07-20T12:00:00.000Z" },
				{ paso: 2, porcentaje: 40, fecha: "2026-04-05T12:00:00.000Z" },
			],
		});

		const enAbril = coincidenciaEnPaso(c, 2, ABRIL);
		expect(enAbril?.fecha).toBe("2026-04-05T12:00:00.000Z");
		expect(enAbril?.porcentaje).toBe(40);
	});

	test("cuenta cualquier llegada dentro del mes, no solo la primera del arreglo", () => {
		const c = caso({
			pasoActual: 2,
			porcentaje: 40,
			historial: [
				{ paso: 2, porcentaje: 30, fecha: "2026-04-02T12:00:00.000Z" },
				{ paso: 2, porcentaje: 40, fecha: "2026-07-02T12:00:00.000Z" },
			],
		});

		expect(coincidenciaEnPaso(c, 2, ABRIL)?.porcentaje).toBe(30);
		expect(coincidenciaEnPaso(c, 2, JULIO)?.porcentaje).toBe(40);
	});

	test("respeta el huso de Guatemala en los bordes del mes", () => {
		// 2026-05-01T05:00Z sigue siendo 30 de abril en Guatemala (UTC-6).
		const c = caso({
			historial: [
				{ paso: 1, porcentaje: 20, fecha: "2026-05-01T05:00:00.000Z" },
			],
		});

		expect(coincidenciaEnPaso(c, 1, ABRIL)).not.toBeNull();
		expect(coincidenciaEnPaso(c, 1, ventanaDelMes(2026, 5))).toBeNull();
	});
});

describe("tuvoAvanceEn", () => {
	test("detecta cualquier movimiento dentro del período", () => {
		const c = caso({
			historial: [
				{ paso: 1, porcentaje: 20, fecha: "2026-04-10T12:00:00.000Z" },
				{ paso: 2, porcentaje: 30, fecha: "2026-07-10T12:00:00.000Z" },
			],
		});

		expect(tuvoAvanceEn(c, ABRIL)).toBe(true);
		expect(tuvoAvanceEn(c, ventanaDelMes(2026, 5))).toBe(false);
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
