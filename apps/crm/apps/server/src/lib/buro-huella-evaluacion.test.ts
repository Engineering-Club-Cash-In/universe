import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { huellaEvaluacionSql } from "../services/buro-interno";

describe("huella de aprobación del buró interno", () => {
	test("versiona los cambios en las fuentes automáticas de Cartera", () => {
		const consulta = new PgDialect().sqlToQuery(
			huellaEvaluacionSql(sql.raw("opportunity_id"), sql.raw("lead_id")),
		);

		expect(consulta.sql).toContain("public.buro_interno_fuentes_cartera");
	});
});
