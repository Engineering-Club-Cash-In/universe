import { beforeEach, describe, expect, mock, test } from "bun:test";

const estado = {
	filas: [] as Array<{ numero_credito_sifco: string; asesor_id: number }>,
	llamadas: 0,
};

const fakeDb = {
	execute: async () => {
		estado.llamadas += 1;
		return { rows: estado.filas };
	},
};

mock.module("../../database", () => ({ db: fakeDb, client: {} }));

const { getAsignacionesPoolPorSifco } = await import(
	"./asignacionesPoolPorSifco"
);

describe("getAsignacionesPoolPorSifco", () => {
	beforeEach(() => {
		estado.filas = [];
		estado.llamadas = 0;
	});

	test("resuelve asignaciones de SIFCOs visibles en una sola consulta", async () => {
		estado.filas = [
			{ numero_credito_sifco: "SIFCO-1", asesor_id: 7 },
			{ numero_credito_sifco: "SIFCO-1", asesor_id: 8 },
		];

		const resultado = await getAsignacionesPoolPorSifco({
			sifcos: ["SIFCO-1", "SIFCO-2"],
		});

		expect(resultado.data).toEqual(estado.filas);
		expect(estado.llamadas).toBe(1);
	});
});
