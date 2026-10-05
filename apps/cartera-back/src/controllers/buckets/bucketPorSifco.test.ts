import { beforeEach, describe, expect, mock, test } from "bun:test";

const estado = {
	filas: [] as Array<Record<string, unknown>>,
	llamadas: 0,
};

const fakeDb = {
	execute: async () => {
		estado.llamadas += 1;
		return { rows: estado.filas };
	},
};

mock.module("../../database", () => ({ db: fakeDb, client: {} }));

const { getBucketPorSifco } = await import("./bucketPorSifco");

describe("getBucketPorSifco", () => {
	beforeEach(() => {
		estado.filas = [];
		estado.llamadas = 0;
	});

	test("resuelve el bucket de varios SIFCOs en una sola consulta", async () => {
		estado.filas = [
			{
				numero_credito_sifco: "S-1",
				fuera: false,
				bucket: "5",
				prefijo: "B5",
				nombre: "Jurídico",
				estado_mora: "mora_120_plus",
			},
			{
				numero_credito_sifco: "S-2",
				fuera: false,
				bucket: 2,
				prefijo: "B2",
				nombre: "Mora",
				estado_mora: "mora_60",
			},
		];

		const r = await getBucketPorSifco({ sifcos: ["S-1", "S-2"] });

		expect(estado.llamadas).toBe(1);
		expect(r.data.map((d) => d.bucket)).toEqual([5, 2]);
		expect(r.data[0]).toMatchObject({ prefijo: "B5", fuera_funnel: false });
	});

	test("fuera del funnel: sin bucket, marcado como fuera", async () => {
		estado.filas = [
			{
				numero_credito_sifco: "S-3",
				fuera: true,
				bucket: 3,
				prefijo: null,
				nombre: null,
				estado_mora: null,
			},
		];

		const [d] = (await getBucketPorSifco({ sifcos: ["S-3"] })).data;

		expect(d).toMatchObject({ bucket: null, fuera_funnel: true });
	});

	test("bucket no resoluble: null sin inventar uno", async () => {
		estado.filas = [
			{
				numero_credito_sifco: "S-4",
				fuera: false,
				bucket: null,
				prefijo: null,
				nombre: null,
				estado_mora: null,
			},
		];

		const [d] = (await getBucketPorSifco({ sifcos: ["S-4"] })).data;

		expect(d.bucket).toBeNull();
	});

	test("no consulta la base con una lista vacía", async () => {
		const r = await getBucketPorSifco({ sifcos: [] });

		expect(r.data).toEqual([]);
		expect(estado.llamadas).toBe(0);
	});

	test("deduplica los SIFCOs repetidos del llamador", async () => {
		await getBucketPorSifco({ sifcos: ["S-1", "S-1", "S-1"] });

		expect(estado.llamadas).toBe(1);
	});
});
