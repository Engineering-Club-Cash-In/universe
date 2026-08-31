import { beforeEach, describe, expect, test, mock } from "bun:test";

const estado = {
	filas: [] as Array<{ numero_credito_sifco: string }>,
	llamadas: 0,
	consultas: [] as string[],
};

const fakeDb = {
	execute: async (query: any) => {
		estado.llamadas += 1;
		estado.consultas.push(
			(query?.queryChunks ?? [])
				.map((chunk: unknown) =>
					typeof chunk === "string" ? chunk : JSON.stringify(chunk),
				)
				.join(" "),
		);
		return { rows: estado.filas };
	},
};

mock.module("../../database", () => ({ db: fakeDb, client: {} }));

const { getSifcosPoolAutoritativos } = await import("./sifcosPoolAutoritativos");

describe("getSifcosPoolAutoritativos", () => {
	beforeEach(() => {
		estado.filas = [];
		estado.llamadas = 0;
		estado.consultas = [];
	});

	test("devuelve scope completo del pool con una sola consulta", async () => {
		estado.filas = [
			{ numero_credito_sifco: "01010214103540" },
			{ numero_credito_sifco: "01010214103541" },
		];

		const resultado = await getSifcosPoolAutoritativos({
			asesor_id: 7,
		});

		expect(resultado.data).toEqual(["01010214103540", "01010214103541"]);
		expect(estado.llamadas).toBe(1);
	});

	test("exige asesor activo aunque conserve filas activas en asesor_bucket", async () => {
		await getSifcosPoolAutoritativos({ asesor_id: 7 });

		expect(estado.consultas.join("\n")).toContain("a.activo = true");
	});
});
