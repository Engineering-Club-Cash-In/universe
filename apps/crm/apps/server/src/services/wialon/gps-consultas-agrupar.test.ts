import { describe, expect, it } from "bun:test";
import {
	agruparConsultasGps,
	type FilaConsultaGps,
} from "./gps-consultas-agrupar";

let n = 0;
const tel = (lat: number, lon: number, minuto: number, userNombre = "Ana") =>
	({
		id: `t${++n}`,
		motivo: `motivo ${n}`,
		origen: "telemetria",
		unitName: "U",
		userNombre,
		createdAt: new Date(Date.UTC(2026, 8, 30, 12, minuto)),
		snapshot: {
			estado: "vinculado",
			telemetria: { latitude: lat, longitude: lon },
		},
	}) satisfies FilaConsultaGps;
const clave = (minuto: number): FilaConsultaGps => ({
	id: `c${++n}`,
	motivo: "clave",
	origen: "ubicaciones_clave",
	unitName: null,
	userNombre: "Ana",
	createdAt: new Date(Date.UTC(2026, 8, 30, 12, minuto)),
	snapshot: null,
});

describe("agruparConsultasGps", () => {
	it("junta las consultas con la misma ubicación; la entrada es la más reciente y lista todas", () => {
		const nueva = tel(14.5, -90.5, 30, "Beto");
		const vieja = tel(14.5, -90.5, 10, "Ana");

		const r = agruparConsultasGps([nueva, vieja]);

		expect(r).toHaveLength(1);
		expect(r[0]?.id).toBe(nueva.id);
		expect(r[0]?.userNombre).toBe("Beto");
		expect(r[0]?.consultas.map((c) => c.userNombre)).toEqual(["Beto", "Ana"]);
	});

	it("ubicación distinta abre otra entrada", () => {
		const r = agruparConsultasGps([tel(14.5, -90.5, 30), tel(14.6, -90.5, 10)]);
		expect(r).toHaveLength(2);
		expect(r.map((e) => e.consultas.length)).toEqual([1, 1]);
	});

	it("una sola coordenada igual no basta", () => {
		expect(
			agruparConsultasGps([tel(14.5, -90.5, 30), tel(14.5, -90.6, 10)]),
		).toHaveLength(2);
	});

	it("ubicaciones clave intercaladas no rompen el grupo de telemetría (caso B4)", () => {
		const r = agruparConsultasGps([
			tel(14.5, -90.5, 30),
			clave(30),
			tel(14.5, -90.5, 10),
			clave(10),
		]);

		expect(r).toHaveLength(3);
		expect(r.map((e) => e.origen)).toEqual([
			"telemetria",
			"ubicaciones_clave",
			"ubicaciones_clave",
		]);
		expect(r[0]?.consultas).toHaveLength(2);
	});

	it("una consulta sin coordenadas (sin unidad) queda suelta y tampoco rompe el grupo", () => {
		const sinUnidad: FilaConsultaGps = {
			...tel(0, 0, 20),
			snapshot: { estado: "sin_vinculo" },
		};
		const r = agruparConsultasGps([
			tel(14.5, -90.5, 30),
			sinUnidad,
			tel(14.5, -90.5, 10),
		]);

		expect(r).toHaveLength(2);
		expect(r[0]?.consultas).toHaveLength(2);
	});

	it("no pierde consultas: el total de miembros es el de filas", () => {
		const filas = [
			tel(1, 1, 50),
			clave(45),
			tel(1, 1, 40),
			tel(2, 2, 30),
			tel(1, 1, 20),
			clave(10),
		];
		const r = agruparConsultasGps(filas);
		expect(r.reduce((t, e) => t + e.consultas.length, 0)).toBe(filas.length);
	});

	it("coordenadas no finitas no se agrupan", () => {
		const r = agruparConsultasGps([
			tel(Number.NaN, -90.5, 30),
			tel(Number.NaN, -90.5, 10),
		]);
		expect(r).toHaveLength(2);
	});

	it("vacío", () => {
		expect(agruparConsultasGps([])).toEqual([]);
	});
});
