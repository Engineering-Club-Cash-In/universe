import { describe, expect, mock, test } from "bun:test";

mock.module("../db", () => ({ db: {} }));

const { casoDentroDeAlcance } = await import("./partner-scope");

describe("casoDentroDeAlcance", () => {
	const gerente = [{ companyId: "agencia-1", sellerId: null }];
	const vendedor = [{ companyId: "agencia-1", sellerId: "v1" }];

	test("el gerente ve todo lo de su agencia, con o sin vendedor", () => {
		expect(
			casoDentroDeAlcance({ companyId: "agencia-1", sellerId: null }, gerente),
		).toBe(true);
		expect(
			casoDentroDeAlcance({ companyId: "agencia-1", sellerId: "v2" }, gerente),
		).toBe(true);
		expect(
			casoDentroDeAlcance({ companyId: "agencia-2", sellerId: null }, gerente),
		).toBe(false);
	});

	test("el vendedor solo ve sus oportunidades", () => {
		expect(
			casoDentroDeAlcance({ companyId: "agencia-1", sellerId: "v1" }, vendedor),
		).toBe(true);
		expect(
			casoDentroDeAlcance({ companyId: "agencia-1", sellerId: "v2" }, vendedor),
		).toBe(false);
		expect(
			casoDentroDeAlcance({ companyId: "agencia-1", sellerId: null }, vendedor),
		).toBe(false);
	});

	test("un caso de otra agencia no entra aunque el vendedor coincida", () => {
		expect(
			casoDentroDeAlcance({ companyId: "agencia-2", sellerId: "v1" }, vendedor),
		).toBe(false);
	});

	test("sin membresías o sin agencia no se ve nada", () => {
		expect(
			casoDentroDeAlcance({ companyId: "agencia-1", sellerId: null }, []),
		).toBe(false);
		expect(
			casoDentroDeAlcance({ companyId: null, sellerId: null }, gerente),
		).toBe(false);
	});
});
