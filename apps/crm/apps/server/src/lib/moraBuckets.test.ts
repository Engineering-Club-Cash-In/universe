import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { carteraBackClient } from "../services/cartera-back-client";
import {
	__resetMoraBucketsCacheForTests,
	estadoMoraPorCuotas,
	refreshMoraBucketsCache,
} from "./moraBuckets";

describe("estadoMoraPorCuotas", () => {
	beforeEach(() => {
		// El módulo es un singleton con estado global (cache + timestamp) que
		// persiste entre tests si no se resetea — sin esto, un test posterior
		// puede "pasar" solo porque el cache ya quedó poblado por uno anterior,
		// no porque su propia lógica sea correcta.
		__resetMoraBucketsCacheForTests();
		spyOn(carteraBackClient, "getBucketsCatalogo").mockRejectedValue(
			new Error("cartera-back down"),
		);
	});

	test("falls back to al_dia for 0 cuotas atrasadas when catalogo fetch fails", () => {
		expect(estadoMoraPorCuotas(0)).toBe("al_dia");
	});

	test("uses dynamic catalogo from cartera-back once cache is refreshed", async () => {
		spyOn(carteraBackClient, "getBucketsCatalogo").mockResolvedValue(
			buildCatalogoCompleto(),
		);

		await refreshMoraBucketsCache();

		expect(estadoMoraPorCuotas(0)).toBe("al_dia");
	});

	test("rejects estado_mora values outside the CRM enum, falls back to homólogo por numero", async () => {
		spyOn(carteraBackClient, "getBucketsCatalogo").mockResolvedValue(
			buildCatalogoCompleto({ 0: "al_dia_custom" }),
		);

		await refreshMoraBucketsCache();

		// "al_dia_custom" no existe en el pgEnum del CRM (casos_cobros.estado_mora)
		// — debe caer al fallback homólogo del bucket 0 ("al_dia"), nunca
		// propagar el valor inválido (revienta el INSERT en sync-casos-cobros.ts).
		expect(estadoMoraPorCuotas(0)).toBe("al_dia");
	});

	test("rejects a partial catalogo (fewer buckets than the fallback), keeps previous cache", async () => {
		// Catálogo con solo B0-B3: sin esto, un crédito con 5 cuotas atrasadas
		// perdería cobertura y estadoMoraPorCuotas(5) caería al "al_dia" final
		// del loop en vez del bucket real (mora_120_plus).
		spyOn(carteraBackClient, "getBucketsCatalogo").mockResolvedValue(
			buildCatalogoCompleto().filter((b) => b.numero <= 3),
		);

		await refreshMoraBucketsCache();

		expect(estadoMoraPorCuotas(5)).toBe("mora_120_plus");
	});

	test("rejects a catalogo with a duplicate numero (same row count, missing coverage)", async () => {
		// Mismo largo que el catálogo completo (6 filas) pero con B0 duplicado
		// en vez de B5 — un guard que solo compara `length` colaría esto, y
		// cuota-5 perdería cobertura igual que en el caso de catálogo parcial.
		const catalogo = buildCatalogoCompleto().filter((b) => b.numero <= 4);
		spyOn(carteraBackClient, "getBucketsCatalogo").mockResolvedValue([
			...catalogo,
			{ ...catalogo[0] },
		]);

		await refreshMoraBucketsCache();

		expect(estadoMoraPorCuotas(5)).toBe("mora_120_plus");
	});
});

function buildCatalogoCompleto(
	estadoMoraOverrides: Record<number, string> = {},
): Array<{
	numero: number;
	prefijo: string;
	nombre: string;
	descripcion: string | null;
	cuotas_min: number;
	cuotas_max: number | null;
	estados_incluidos: string[];
	es_operativo: boolean;
	orden: number;
	color: string | null;
	estado_mora: string | null;
}> {
	const buckets = [
		{ numero: 0, nombre: "Cartera Sana", cuotas_min: 0, cuotas_max: 0, estadoMora: "al_dia" },
		{ numero: 1, nombre: "Alerta Temprana", cuotas_min: 1, cuotas_max: 1, estadoMora: "mora_30" },
		{ numero: 2, nombre: "Gestión Activa", cuotas_min: 2, cuotas_max: 2, estadoMora: "mora_60" },
		{ numero: 3, nombre: "Rescate", cuotas_min: 3, cuotas_max: 3, estadoMora: "mora_90" },
		{ numero: 4, nombre: "Última Instancia", cuotas_min: 4, cuotas_max: 4, estadoMora: "mora_120" },
		{ numero: 5, nombre: "Jurídico", cuotas_min: 5, cuotas_max: null, estadoMora: "mora_120_plus" },
	];
	return buckets.map((b) => ({
		numero: b.numero,
		prefijo: `B${b.numero}`,
		nombre: b.nombre,
		descripcion: null,
		cuotas_min: b.cuotas_min,
		cuotas_max: b.cuotas_max,
		estados_incluidos: [],
		es_operativo: true,
		orden: b.numero,
		color: null,
		estado_mora: estadoMoraOverrides[b.numero] ?? b.estadoMora,
	}));
}
