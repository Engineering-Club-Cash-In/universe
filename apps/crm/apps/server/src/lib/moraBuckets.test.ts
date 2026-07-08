import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { carteraBackClient } from "../services/cartera-back-client";
import { estadoMoraPorCuotas, refreshMoraBucketsCache } from "./moraBuckets";

describe("estadoMoraPorCuotas", () => {
	beforeEach(() => {
		spyOn(carteraBackClient, "getBucketsCatalogo").mockRejectedValue(
			new Error("cartera-back down"),
		);
	});

	test("falls back to al_dia for 0 cuotas atrasadas when catalogo fetch fails", () => {
		expect(estadoMoraPorCuotas(0)).toBe("al_dia");
	});

	test("uses dynamic catalogo from cartera-back once cache is refreshed", async () => {
		spyOn(carteraBackClient, "getBucketsCatalogo").mockResolvedValue([
			{
				numero: 0,
				prefijo: "B0",
				nombre: "Cartera Sana Custom",
				descripcion: null,
				cuotas_min: 0,
				cuotas_max: 0,
				estados_incluidos: [],
				es_operativo: true,
				orden: 0,
				color: null,
				estado_mora: "al_dia_custom",
			},
		]);

		await refreshMoraBucketsCache();

		expect(estadoMoraPorCuotas(0)).toBe("al_dia_custom");
	});
});
