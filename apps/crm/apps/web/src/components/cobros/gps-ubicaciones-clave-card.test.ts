import { describe, expect, it } from "bun:test";
import { describirPatron } from "./gps-ubicaciones-clave-card";

describe("CB-119 (D-15) — describirPatron", () => {
	it("devuelve null ante patron nulo o inválido", () => {
		expect(describirPatron(null)).toBeNull();
		expect(describirPatron(undefined)).toBeNull();
		expect(describirPatron("no-es-objeto")).toBeNull();
	});

	it("incluye el tiempo no clasificado usando horasTotales como denominador", () => {
		// Escenario de Codex 4107699651:
		// Visitas de 18:00 a 23:00 acumulan 1h nocturna y 4h vespertinas (fuera de bandas).
		// Con horasTotales = 5h, 1/5 = 20% (< 50%), NO debe decir 'Sobre todo de noche'.
		const patronVespertino = {
			nocturna: 1,
			laboral: 0,
			finDeSemana: 0,
		};

		// Con horasTotales = 5
		expect(describirPatron(patronVespertino, 5)).toBeNull();

		// Si nocturna es >= 50% del tiempo total, sí lo describe
		const patronNocturno = {
			nocturna: 8,
			laboral: 0,
			finDeSemana: 0,
		};
		expect(describirPatron(patronNocturno, 10)).toBe("Sobre todo de noche");
	});

	it("describe horario laboral cuando representa >= 50% de las horas totales", () => {
		const patronLaboral = {
			nocturna: 0,
			laboral: 30,
			finDeSemana: 0,
		};
		expect(describirPatron(patronLaboral, 40)).toBe(
			"Sobre todo en horario laboral",
		);
	});

	it("describe fin de semana cuando representa >= 50% de las horas totales", () => {
		const patronFDS = {
			nocturna: 0,
			laboral: 0,
			finDeSemana: 15,
		};
		expect(describirPatron(patronFDS, 20)).toBe("Sobre todo fin de semana");
	});

	it("describe día de la semana recurrente cuando concentra >= 60% de visitas", () => {
		// [dom, lun, mar, mié, jue, vie, sáb] -> índice 6 es sáb
		const patronSabados = {
			nocturna: 0,
			laboral: 0,
			finDeSemana: 10,
			visitasPorDiaSemana: [0, 0, 0, 0, 0, 0, 10],
		};
		expect(describirPatron(patronSabados, 10)).toBe("Sobre todo los sáb");
	});
});
