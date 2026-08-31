import { beforeEach, describe, expect, test, mock } from "bun:test";

const estado = {
	conteo: "0",
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
		return estado.llamadas % 2 === 1
			? { rows: [{ total: estado.conteo }] }
			: { rows: estado.filas };
	},
};

mock.module("../../database", () => ({ db: fakeDb, client: {} }));

const { getSifcosPoolAutoritativos } = await import("./sifcosPoolAutoritativos");

describe("getSifcosPoolAutoritativos", () => {
	beforeEach(() => {
		estado.conteo = "0";
		estado.filas = [];
		estado.llamadas = 0;
		estado.consultas = [];
	});

	test("devuelve solo SIFCOs del pool autoritativo y conserva la paginación", async () => {
		estado.conteo = "501";
		estado.filas = [
			{ numero_credito_sifco: "01010214103540" },
			{ numero_credito_sifco: "01010214103541" },
		];

		const resultado = await getSifcosPoolAutoritativos({
			asesor_id: 7,
			page: 2,
			perPage: 500,
		});

		expect(resultado.data).toEqual(["01010214103540", "01010214103541"]);
		expect(resultado.page).toBe(2);
		expect(resultado.perPage).toBe(500);
		expect(resultado.totalPages).toBe(2);
	});

	test("exige asesor activo aunque conserve filas activas en asesor_bucket", async () => {
		await getSifcosPoolAutoritativos({ asesor_id: 7 });

		expect(estado.consultas.join("\n")).toContain("a.activo = true");
	});
});
