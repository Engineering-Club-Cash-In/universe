import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { enRangoSql, rangoDiasGT } from "./rango-dias-gt";

describe("rangoDiasGT", () => {
	test("incluye el último día completo", () => {
		const r = rangoDiasGT("2026-10-01", "2026-10-02");
		expect(r.desde?.toISOString()).toBe("2026-10-01T06:00:00.000Z");
		expect(r.hastaExcl?.toISOString()).toBe("2026-10-03T06:00:00.000Z");
	});

	test("rango abierto", () => {
		expect(rangoDiasGT()).toEqual({ desde: null, hastaExcl: null });
		expect(rangoDiasGT("2026-10-01").hastaExcl).toBeNull();
		expect(rangoDiasGT(null, "2026-10-01").desde).toBeNull();
	});
});

describe("enRangoSql", () => {
	const dialecto = new PgDialect();

	test("manda los instantes como ISO en UTC con cast, no como Date", () => {
		const r = rangoDiasGT("2026-10-03", "2026-10-03");
		const cond = enRangoSql(sql`coalesce(a, b)`, r);
		const q = dialecto.sqlToQuery(cond as never);
		expect(q.sql).toContain("::timestamp");
		expect(q.params).toEqual([
			"2026-10-03T06:00:00.000Z",
			"2026-10-04T06:00:00.000Z",
		]);
	});

	test("rango abierto sin extremos no agrega condiciones", () => {
		expect(
			enRangoSql(sql`x`, { desde: null, hastaExcl: null }),
		).toBeUndefined();
		const q = dialecto.sqlToQuery(
			enRangoSql(sql`x`, rangoDiasGT("2026-10-03")) as never,
		);
		expect(q.params).toEqual(["2026-10-03T06:00:00.000Z"]);
	});
});
