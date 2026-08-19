import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { columnaEnAgenda } from "../lib/historial-agendas";

/**
 * Compila el SQL del EXISTS de `columnaEnAgenda` sin tocar la DB — mismo
 * patrón que `lib/historial-agendas.test.ts` para `whereHistorial`.
 */
const dialect = new PgDialect();
function compilar(sql: Parameters<PgDialect["sqlToQuery"]>[0]) {
	const query = dialect.sqlToQuery(sql);
	return { sql: query.sql.toLowerCase(), params: query.params };
}

describe("columnaEnAgenda", () => {
	test("con snapshotId compila un EXISTS que compara caso y SIFCO", () => {
		const { sql, params } = compilar(columnaEnAgenda("snap-123"));

		expect(sql).toContain("exists");
		expect(sql).toContain("caso_cobro_id");
		expect(sql).toContain("numero_credito_sifco");
		expect(params).toContain("snap-123");
	});

	test("sin snapshotId compila a NULL, sin EXISTS", () => {
		const { sql, params } = compilar(columnaEnAgenda(null));

		expect(sql).not.toContain("exists");
		expect(sql).toContain("null");
		expect(params).toEqual([]);
	});

	// Guarda de regresión: la semántica es por CRÉDITO, no por la llamada que
	// cerró el item. Si esto empieza a fallar, alguien cambió el EXISTS para
	// comparar contacto_cobro_id — ver la nota en columnaEnAgenda sobre por
	// qué eso marca mal una segunda gestión sobre un crédito planificado.
	test("no compara por contacto_cobro_id", () => {
		const { sql } = compilar(columnaEnAgenda("snap-123"));

		expect(sql).not.toContain("contacto_cobro_id");
	});

	// Guarda de regresión: el fallback por SIFCO solo debe aplicar cuando el
	// item del snapshot NO tiene caso_cobro_id (los D-0, que nacen sin caso).
	// Sin este `is null`, dos casos_cobros con el mismo SIFCO (reapertura o
	// migración) hacían que una gestión sobre el caso B se marcara "en
	// agenda" solo porque el caso A —un caso DISTINTO— sí estaba planificado
	// (hallazgo de code review, Codex).
	test("el fallback por SIFCO exige que el item no tenga caso_cobro_id", () => {
		const { sql } = compilar(columnaEnAgenda("snap-123"));

		expect(sql).toContain("ai.caso_cobro_id is null");
	});
});
