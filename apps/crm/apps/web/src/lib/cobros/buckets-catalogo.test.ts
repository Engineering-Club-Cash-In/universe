import { describe, expect, test } from "bun:test";
import { type BucketsCatalogoQueryData, esBucketB2 } from "./buckets-catalogo";

const CATALOGO_ESTANDAR: BucketsCatalogoQueryData = [
	{
		numero: 0,
		estadoMora: "al_dia",
		label: "Cartera Sana",
		prefijo: "B0",
		color: null,
		orden: 0,
	},
	{
		numero: 1,
		estadoMora: "mora_30",
		label: "Alerta Temprana",
		prefijo: "B1",
		color: null,
		orden: 1,
	},
	{
		numero: 2,
		estadoMora: "mora_60",
		label: "Gestión Activa",
		prefijo: "B2",
		color: null,
		orden: 2,
	},
	{
		numero: 3,
		estadoMora: "mora_90",
		label: "Rescate",
		prefijo: "B3",
		color: null,
		orden: 3,
	},
];

// Catálogo con la numeración REASIGNADA por un admin: numero=2 ya no es
// "mora_60" (B2), es "mora_30" (B1) — exactamente el escenario que el commit
// 78c92c9c / PR #1205 corrigió en otros helpers de este mismo archivo.
const CATALOGO_REASIGNADO: BucketsCatalogoQueryData = [
	{
		numero: 0,
		estadoMora: "al_dia",
		label: "Cartera Sana",
		prefijo: "B0",
		color: null,
		orden: 0,
	},
	{
		numero: 2,
		estadoMora: "mora_30",
		label: "Alerta Temprana",
		prefijo: "B2",
		color: null,
		orden: 1,
	},
	{
		numero: 1,
		estadoMora: "mora_60",
		label: "Gestión Activa",
		prefijo: "B1",
		color: null,
		orden: 2,
	},
];

describe("esBucketB2", () => {
	test("null (sin traza en historial) nunca es B2", () => {
		expect(esBucketB2(null, CATALOGO_ESTANDAR)).toBe(false);
	});

	test("con catálogo estándar, numero=2 SÍ es B2 (mora_60)", () => {
		expect(esBucketB2(2, CATALOGO_ESTANDAR)).toBe(true);
	});

	test("con catálogo estándar, numero=1 (B1) NO es B2", () => {
		expect(esBucketB2(1, CATALOGO_ESTANDAR)).toBe(false);
	});

	test("con catálogo estándar, numero=3 (B3) NO es B2", () => {
		expect(esBucketB2(3, CATALOGO_ESTANDAR)).toBe(false);
	});

	// Caso central del fix: la numeración cruda NO decide el resultado, la
	// clave estable "mora_60" sí. Antes del fix esto comparaba
	// `bucketPrevio === 2` y hubiera dado un falso positivo/negativo según
	// cuál número quedó reasignado.
	test("con numeración reasignada, numero=2 YA NO es B2 (ahora es mora_30/B1)", () => {
		expect(esBucketB2(2, CATALOGO_REASIGNADO)).toBe(false);
	});

	test("con numeración reasignada, numero=1 SÍ es B2 (mora_60 se movió ahí)", () => {
		expect(esBucketB2(1, CATALOGO_REASIGNADO)).toBe(true);
	});

	test("sin catálogo cargado (undefined), cae al fallback ESTADO_MORA_POR_NUMERO donde numero=2 es mora_60", () => {
		expect(esBucketB2(2, undefined)).toBe(true);
		expect(esBucketB2(1, undefined)).toBe(false);
	});

	test("número fuera de rango (sin fila en catálogo ni fallback) no revienta y no es B2", () => {
		expect(esBucketB2(99, CATALOGO_ESTANDAR)).toBe(false);
	});
});
