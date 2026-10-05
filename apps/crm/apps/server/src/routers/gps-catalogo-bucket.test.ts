import { beforeEach, describe, expect, it, mock } from "bun:test";
import { call } from "@orpc/server";
import type { Context } from "../lib/context";

let rolUsuario = "admin";
let carteraActiva = true;
let llamadas: string[][] = [];
let respuesta: (sifcos: string[]) => Promise<{
	data: Array<{
		numero_credito_sifco: string;
		bucket: number | null;
		prefijo: string | null;
		nombre: string | null;
		estado_mora: string | null;
		fuera_funnel: boolean;
	}>;
}>;

// El único select de la base es el del middleware de admin (el usuario).
mock.module("../db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => [{ id: "u1", role: rolUsuario }],
				}),
			}),
		}),
	},
}));
mock.module("../services/cartera-back-integration", () => ({
	isCarteraBackEnabled: () => carteraActiva,
}));
mock.module("../services/cartera-back-client", () => ({
	carteraBackClient: {
		getBucketPorSifco: async ({ sifcos }: { sifcos: string[] }) => {
			llamadas.push(sifcos);
			return respuesta(sifcos);
		},
	},
}));

const { gpsCatalogoBucketRouter } = await import("./gps-catalogo-bucket");

const ctx = {
	headers: new Headers(),
	session: { user: { id: "u1", email: "a@example.com" } },
	user: { id: "u1", email: "a@example.com", role: "admin" },
	userId: "u1",
	userRole: "admin",
} as unknown as Context;

const fila = (
	sifco: string,
	bucket: number | null,
	estado: string | null,
	fuera = false,
) => ({
	numero_credito_sifco: sifco,
	bucket,
	prefijo: bucket == null ? null : `B${bucket}`,
	nombre: null,
	estado_mora: estado,
	fuera_funnel: fuera,
});

const pedir = (sifcos: string[]) =>
	call(
		gpsCatalogoBucketRouter.getEstadoMoraPorSifco,
		{ sifcos },
		{ context: ctx },
	);

describe("getEstadoMoraPorSifco (bucket desde cartera-back)", () => {
	beforeEach(() => {
		rolUsuario = "admin";
		carteraActiva = true;
		llamadas = [];
		respuesta = async () => ({ data: [] });
	});

	it("sin SIFCOs no llama a cartera", async () => {
		expect(await pedir([])).toEqual({ estadoMoraPorSifco: {} });
		expect(llamadas).toHaveLength(0);
	});

	it("devuelve el estado de mora del bucket del motor", async () => {
		respuesta = async () => ({
			data: [fila("A", 5, "mora_120_plus"), fila("B", 2, "mora_60")],
		});
		const res = await pedir(["A", "B"]);
		expect(res.estadoMoraPorSifco).toEqual({
			A: "mora_120_plus",
			B: "mora_60",
		});
	});

	it("sin bucket (fuera del funnel / no resoluble) no inventa uno", async () => {
		respuesta = async () => ({
			data: [fila("A", null, null, true), fila("B", null, null)],
		});
		expect((await pedir(["A", "B"])).estadoMoraPorSifco).toEqual({});
	});

	it("si el catálogo no trae estado_mora, lo deduce del número de bucket", async () => {
		respuesta = async () => ({ data: [fila("A", 4, null)] });
		const res = await pedir(["A"]);
		expect(res.estadoMoraPorSifco.A).toBe("mora_120");
	});

	it("parte la lista en tandas de 1000 y une los resultados", async () => {
		const sifcos = Array.from({ length: 1300 }, (_, i) => `S${i}`);
		respuesta = async (lote) => ({
			data: lote.map((s) => fila(s, 1, "mora_30")),
		});
		const res = await pedir(sifcos);
		expect(llamadas.map((l) => l.length)).toEqual([1000, 300]);
		expect(Object.keys(res.estadoMoraPorSifco)).toHaveLength(1300);
	});

	it("no hay tope por solicitud: una flota grande se parte en tandas", async () => {
		const sifcos = Array.from({ length: 6001 }, (_, i) => `S${i}`);
		respuesta = async (lote) => ({
			data: lote.map((s) => fila(s, 1, "mora_30")),
		});
		const res = await pedir(sifcos);
		expect(llamadas.map((l) => l.length)).toEqual([
			1000, 1000, 1000, 1000, 1000, 1000, 1,
		]);
		expect(Object.keys(res.estadoMoraPorSifco)).toHaveLength(6001);
	});

	it("deduplica los SIFCOs", async () => {
		await pedir(["A", "A", "A"]);
		expect(llamadas).toEqual([["A"]]);
	});

	it("cartera apagada: error claro, sin respaldo local", async () => {
		carteraActiva = false;
		await expect(pedir(["A"])).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
		});
		expect(llamadas).toHaveLength(0);
	});

	it("cartera falla: error, no datos parciales", async () => {
		respuesta = async () => {
			throw new Error("boom");
		};
		await expect(pedir(["A"])).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
		});
	});

	it("solo admin", async () => {
		rolUsuario = "cobros";
		await expect(pedir(["A"])).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});
