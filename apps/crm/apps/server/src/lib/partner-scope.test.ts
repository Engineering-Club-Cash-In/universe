import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, mock, test } from "bun:test";

mock.module("../db", () => ({ db: {} }));

const { casoDentroDeAlcance, resolvePartnerScope } = await import("./partner-scope");

describe("resolvePartnerScope", () => {
	function conexionQueCapturaElWhere() {
		const capturado: { sql: string } = { sql: "" };
		const nodo = {
			from: () => nodo,
			where: (condicion: unknown) => {
				capturado.sql = new PgDialect().sqlToQuery(condicion as never).sql;
				return Promise.resolve([{ companyId: "agencia-1", sellerId: null }]);
			},
		};
		return { capturado, conexion: { select: () => nodo } as never };
	}

	test("solo pide las membresías activas (desactivado_at IS NULL) del usuario", async () => {
		const { capturado, conexion } = conexionQueCapturaElWhere();

		await resolvePartnerScope("socio-1", conexion);

		expect(capturado.sql).toContain('"desactivado_at" is null');
		expect(capturado.sql).toContain('"user_id" = $');
	});
});

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
