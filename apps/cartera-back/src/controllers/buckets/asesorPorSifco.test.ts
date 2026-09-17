import { beforeEach, describe, expect, mock, test } from "bun:test";

const estado = {
	filas: [] as Array<{
		numero_credito_sifco: string;
		asesor_id: number;
		nombre: string;
	}>,
	llamadas: 0,
};

const fakeDb = {
	execute: async () => {
		estado.llamadas += 1;
		return { rows: estado.filas };
	},
};

mock.module("../../database", () => ({ db: fakeDb, client: {} }));

const { getAsesorPorSifco } = await import("./asesorPorSifco");

describe("getAsesorPorSifco", () => {
	beforeEach(() => {
		estado.filas = [];
		estado.llamadas = 0;
	});

	test("resuelve el dueño de cada SIFCO en una sola consulta", async () => {
		estado.filas = [
			{ numero_credito_sifco: "SIFCO-1", asesor_id: 7, nombre: "Erik Rivas" },
			{ numero_credito_sifco: "SIFCO-2", asesor_id: 9, nombre: "Caren Rivera" },
		];

		const resultado = await getAsesorPorSifco({
			sifcos: ["SIFCO-1", "SIFCO-2"],
		});

		expect(resultado.data).toHaveLength(2);
		expect(estado.llamadas).toBe(1);
	});

	test("no consulta la base con una lista vacía", async () => {
		const resultado = await getAsesorPorSifco({ sifcos: [] });

		expect(resultado.data).toEqual([]);
		expect(estado.llamadas).toBe(0);
	});

	test("deduplica los SIFCOs repetidos del llamador", async () => {
		await getAsesorPorSifco({ sifcos: ["SIFCO-1", "SIFCO-1", "SIFCO-1"] });

		expect(estado.llamadas).toBe(1);
	});
});
