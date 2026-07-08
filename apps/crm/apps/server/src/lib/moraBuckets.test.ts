import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { carteraBackClient } from "../services/cartera-back-client";
import {
	__resetMoraBucketsCacheForTests,
	estadoMoraPorCuotas,
	labelPorEstadoMora,
	rangoCuotasPorEstadoMora,
	refreshMoraBucketsCache,
} from "./moraBuckets";

describe("estadoMoraPorCuotas", () => {
	// Un solo handle de spy, reusado en todos los tests: llamar `spyOn` de
	// nuevo sobre el mismo método sin restaurar el anterior no está garantizado
	// entre versiones de Bun (hoy re-envuelve limpio, pero es un detalle de
	// implementación, no contrato documentado). Cambiar la implementación del
	// MISMO handle (`mockResolvedValue`/`mockRejectedValue`) es el patrón
	// correcto y no depende de ese detalle.
	let getBucketsCatalogoSpy: ReturnType<typeof spyOn<typeof carteraBackClient, "getBucketsCatalogo">>;

	beforeEach(() => {
		// El módulo es un singleton con estado global (cache + timestamp) que
		// persiste entre tests si no se resetea — sin esto, un test posterior
		// puede "pasar" solo porque el cache ya quedó poblado por uno anterior,
		// no porque su propia lógica sea correcta.
		__resetMoraBucketsCacheForTests();
		getBucketsCatalogoSpy = spyOn(carteraBackClient, "getBucketsCatalogo");
		getBucketsCatalogoSpy.mockRejectedValue(new Error("cartera-back down"));
	});

	test("falls back to al_dia for 0 cuotas atrasadas when catalogo fetch fails", () => {
		expect(estadoMoraPorCuotas(0)).toBe("al_dia");
	});

	test("uses dynamic catalogo from cartera-back once cache is refreshed", async () => {
		getBucketsCatalogoSpy.mockResolvedValue(buildCatalogoCompleto());

		await refreshMoraBucketsCache();

		expect(estadoMoraPorCuotas(0)).toBe("al_dia");
	});

	test("rejects estado_mora values outside the CRM enum, falls back to homólogo por numero", async () => {
		getBucketsCatalogoSpy.mockResolvedValue(
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
		getBucketsCatalogoSpy.mockResolvedValue(
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
		getBucketsCatalogoSpy.mockResolvedValue([...catalogo, { ...catalogo[0] }]);

		await refreshMoraBucketsCache();

		expect(estadoMoraPorCuotas(5)).toBe("mora_120_plus");
	});

	test("discards a new bucket (no homólogo conocido) whose estado_mora is null/invalid, instead of defaulting to al_dia", async () => {
		// B6 no existe en MORA_BUCKETS — no hay homólogo al que caer, y su
		// estado_mora es null. Antes del fix, esto se forzaba a "al_dia" y esa
		// fila fantasma se incluía en el cache con `orden: -1` (primero que B0
		// real) — como `labelPorEstadoMora`/`estadoMoraPorCuotas` hacen
		// first-match, el B0 legítimo (rango 0-0, label "Cartera Sana") habría
		// quedado ensombrecido por el B6 fantasma (label "Bucket nuevo sin
		// estado") para CUALQUIER crédito al día, no solo para cuota 6 — el
		// bug no se limitaba al rango del bucket nuevo. Con el fix, la fila se
		// descarta antes de entrar al cache: el label de "al_dia" sigue siendo
		// el de B0 real.
		const catalogo = buildCatalogoCompleto();
		getBucketsCatalogoSpy.mockResolvedValue([
			{
				numero: 6,
				prefijo: "B6",
				nombre: "Bucket nuevo sin estado",
				descripcion: null,
				cuotas_min: 6,
				cuotas_max: null,
				estados_incluidos: [],
				es_operativo: true,
				orden: -1,
				color: null,
				estado_mora: null,
			},
			...catalogo,
		]);

		await refreshMoraBucketsCache();

		expect(labelPorEstadoMora("al_dia")).toBe("Cartera Sana");
	});

	test("discards a new bucket (no homólogo conocido) even with a VALID estado_mora", async () => {
		// Variante más sutil del test anterior: B6 no existe en MORA_BUCKETS,
		// pero esta vez su estado_mora ("mora_90") SÍ es válido en el enum — no
		// lo filtra la whitelist. Sin el filtro por `numero` conocido, esta fila
		// sobrevivía al mapeo entero y, con `orden: -1`, ensombrecía a B0 real
		// (rango 0-0) para cualquier crédito al día, devolviendo "mora_90" en
		// vez de "al_dia" — un crédito sin atraso persistido con etapa de mora.
		const catalogo = buildCatalogoCompleto();
		getBucketsCatalogoSpy.mockResolvedValue([
			{
				numero: 6,
				prefijo: "B6",
				nombre: "Bucket nuevo con estado válido",
				descripcion: null,
				cuotas_min: 0,
				cuotas_max: 0,
				estados_incluidos: [],
				es_operativo: true,
				orden: -1,
				color: null,
				estado_mora: "mora_90",
			},
			...catalogo,
		]);

		await refreshMoraBucketsCache();

		expect(estadoMoraPorCuotas(0)).toBe("al_dia");
	});

	test("dedups a duplicated numero deterministically (lowest orden wins), not by iteration order", async () => {
		// Catálogo completo + una segunda fila con numero:3 (rango y estado
		// distintos al B3 real), con `orden` MÁS BAJO que el B3 legítimo — sin
		// dedup explícito, ambas entradas convivirían en el cache y cuál "gana"
		// el first-match dependería del orden de iteración, no de una regla.
		const catalogo = buildCatalogoCompleto();
		const b3Real = catalogo.find((b) => b.numero === 3);
		if (!b3Real) throw new Error("fixture inválido: falta B3");
		getBucketsCatalogoSpy.mockResolvedValue([
			{
				...b3Real,
				cuotas_min: 10,
				cuotas_max: 10,
				estado_mora: "mora_120",
				orden: -1,
			},
			...catalogo,
		]);

		await refreshMoraBucketsCache();

		// Debe ganar la fila de `orden` más bajo (la duplicada, orden:-1) —
		// comportamiento determinístico, documentado, no azar de iteración.
		const rango = rangoCuotasPorEstadoMora("mora_120");
		expect(rango).toEqual({ min: 10, max: 10 });
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
