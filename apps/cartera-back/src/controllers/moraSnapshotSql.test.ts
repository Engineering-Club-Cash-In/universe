import { describe, expect, it } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { snapCte } from "./moraSnapshotSql";
import { inicioDiaGTComoTimestampUTC } from "../utils/functions/diaGuatemala";

const render = (fecha: string, incluirFecha?: boolean) =>
	new PgDialect().sqlToQuery(sql`WITH ${snapCte(fecha, incluirFecha)} SELECT 1`);

describe("snapCte — el corte de fecha es sargable", () => {
	// EL CONTRATO. El filtro anterior era
	//   (h.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date <= $1
	// que envuelve la columna y deja fuera de juego a cualquier índice sobre
	// `fecha`: el plan hacía Seq Scan + Sort del historial COMPLETO. Con el
	// RECALCULO diario de la mora proporcional ese sort cruza `work_mem`.
	// Si alguien vuelve a envolver la columna, este test cae.
	it("no envuelve `h.fecha` en AT TIME ZONE", () => {
		const { sql: texto } = render("2026-08-06");
		expect(texto).not.toMatch(/h\.fecha\s+AT TIME ZONE/i);
		expect(texto).not.toMatch(/AT TIME ZONE 'America\/Guatemala'/);
	});

	it("compara la columna CRUDA contra un límite parametrizado", () => {
		const { sql: texto } = render("2026-08-06");
		// Afirmación en positivo: la forma que SÍ tiene que estar, dos veces (el
		// último evento y el carry-forward).
		expect(texto.match(/h\.fecha < \$\d+::timestamp/g)).toHaveLength(2);
	});

	it("'al día X inclusive' es `< medianoche GT del X+1`, en UTC", () => {
		const { params } = render("2026-08-06");
		expect(params).toContain(inicioDiaGTComoTimestampUTC("2026-08-06", 1));
		// 06:00 UTC porque Guatemala es GMT-6: el cron corre ~23:59 GT.
		expect(params).toContain("2026-08-07 06:00:00.000");
	});

	it("`incluirFecha = false` corta en la medianoche GT del mismo día", () => {
		const { params } = render("2026-08-06", false);
		expect(params).toContain("2026-08-06 06:00:00.000");
	});

	it("una fecha inválida revienta en vez de armar SQL basura", () => {
		expect(() => render("2026-02-31")).toThrow(RangeError);
		expect(() => render("ayer")).toThrow(RangeError);
	});
});

describe("snapCte — el carry-forward de las cuotas sigue vivo", () => {
	// Los eventos "payment-only" (updateMora sin cuotas, p.ej. la reversa de
	// pago de reversePayment.ts) registran cuotas_atrasadas_nuevas = 0. Sin el
	// carry-forward, un crédito con mora > 0 cuyo ÚLTIMO evento sea uno de esos
	// caería a "Al día" y desaparecería de los buckets 30/60/90/120.
	it("las cuotas salen de un DISTINCT ON restringido a cuotas > 0", () => {
		const { sql: texto } = render("2026-08-06");
		expect(texto).toContain("snap_cuotas AS (");
		expect(texto).toContain("h.cuotas_atrasadas_nuevas > 0");
		expect(texto).toMatch(
			/snap_cuotas AS \([\s\S]*?DISTINCT ON \(h\.credito_id\)[\s\S]*?h\.cuotas_atrasadas_nuevas > 0/,
		);
	});

	it("un crédito sin ningún evento con cuotas > 0 NO se pierde", () => {
		const { sql: texto } = render("2026-08-06");
		// LEFT JOIN (no INNER) y COALESCE al último evento (no a un 0 literal):
		// así el resultado es idéntico al FIRST_VALUE que había antes.
		expect(texto).toContain("LEFT JOIN snap_cuotas k");
		expect(texto).toContain("COALESCE(k.cuotas, u.cuotas_ultimo) AS cuotas");
	});

	it("el orden de desempate es el mismo de antes (fecha, historial_id)", () => {
		const { sql: texto } = render("2026-08-06");
		expect(
			texto.match(
				/ORDER BY h\.credito_id, h\.fecha DESC, h\.historial_id DESC/g,
			),
		).toHaveLength(2);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Integración (solo lectura) contra SUPABASE_DB_URL: el dump local. Prueba que
// la reescritura NO cambió el resultado, comparando fila por fila contra la
// forma VIEJA (las dos window functions con el filtro AT TIME ZONE), escrita
// acá literal.
// ─────────────────────────────────────────────────────────────────────────────
if (!process.env.SUPABASE_DB_URL) {
	describe("snapCte (integración)", () => {
		it.skip("requiere SUPABASE_DB_URL apuntando al dump local", () => {});
	});
} else {
	const { db } = await import("../database/index");

	const VIEJO = (fecha: string) => sql`
    viejo_raw AS (
      SELECT h.credito_id, h.tipo_evento, h.monto_nuevo::numeric AS monto, h.fecha,
        ROW_NUMBER() OVER (PARTITION BY h.credito_id ORDER BY h.fecha DESC, h.historial_id DESC) AS rn,
        FIRST_VALUE(h.cuotas_atrasadas_nuevas) OVER (
          PARTITION BY h.credito_id
          ORDER BY (h.cuotas_atrasadas_nuevas > 0) DESC, h.fecha DESC, h.historial_id DESC
        ) AS cuotas
      FROM cartera.moras_historial h
      WHERE (h.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date <= ${fecha}::date
    ),
    viejo AS (SELECT credito_id, tipo_evento, monto, cuotas, fecha FROM viejo_raw WHERE rn = 1)`;

	const rowsOf = (r: any) => (Array.isArray(r) ? r : (r.rows ?? []));

	const diff = async (fecha: string) =>
		rowsOf(
			await db.execute<any>(sql`
        WITH ${VIEJO(fecha)}, ${snapCte(fecha)}
        SELECT
          (SELECT COUNT(*) FROM viejo)::int AS n_viejo,
          (SELECT COUNT(*) FROM snap)::int AS n_nuevo,
          (SELECT COUNT(*) FROM (SELECT * FROM viejo EXCEPT SELECT * FROM snap) d)::int AS solo_viejo,
          (SELECT COUNT(*) FROM (SELECT * FROM snap EXCEPT SELECT * FROM viejo) d)::int AS solo_nuevo
      `),
		)[0];

	describe("snapCte (integración)", () => {
		// Varias fechas: una dentro del historial, el borde final y una anterior a
		// todo (conjunto vacío, que es donde el LEFT JOIN podría romperse).
		for (const fecha of ["2026-06-15", "2026-08-06", "2026-01-01"]) {
			it(`da EXACTAMENTE el mismo snapshot que la forma vieja al ${fecha}`, async () => {
				const d = await diff(fecha);
				expect(Number(d.solo_viejo)).toBe(0);
				expect(Number(d.solo_nuevo)).toBe(0);
				expect(Number(d.n_nuevo)).toBe(Number(d.n_viejo));
			});
		}

		it("el carry-forward NO es teórico: hay créditos que dependen de él", async () => {
			// Créditos cuyo ÚLTIMO evento tiene cuotas = 0 (payment-only) y que aun
			// así conservan cuotas > 0 en el snapshot. Si el carry-forward se cayera,
			// estos se irían a "Al día" y saldrían de los buckets 30/60/90/120.
			const filas = rowsOf(
				await db.execute<any>(sql`
          WITH ${snapCte("2026-08-06")},
          ultimo AS (
            SELECT DISTINCT ON (h.credito_id) h.credito_id, h.cuotas_atrasadas_nuevas AS cu
            FROM cartera.moras_historial h
            WHERE h.fecha < '2026-08-07 06:00:00.000'::timestamp
            ORDER BY h.credito_id, h.fecha DESC, h.historial_id DESC
          )
          SELECT COUNT(*)::int AS n
          FROM snap s JOIN ultimo u ON u.credito_id = s.credito_id
          WHERE u.cu = 0 AND s.cuotas > 0
        `),
			);
			expect(Number(filas[0].n)).toBeGreaterThan(0);
		});

		it("el plan del snapshot ya no ordena el historial completo", async () => {
			// La migración 0041 se aplica DENTRO de una transacción que se revierte:
			// el dump local es de solo lectura y así no le queda rastro. Es también
			// un test de la migración: si el archivo deja de crear los índices que
			// la consulta necesita, el plan vuelve a tener Sort y esto cae.
			const migracion = await Bun.file(
				new URL(
					"../../drizzle/0041_idx_moras_historial_snapshot.sql",
					import.meta.url,
				).pathname,
			).text();

			let plan = "";
			await db
				.transaction(async (tx) => {
					await tx.execute(sql.raw(migracion));
					await tx.execute(sql.raw("ANALYZE cartera.moras_historial"));
					plan = rowsOf(
						await tx.execute<any>(sql`
              EXPLAIN (ANALYZE, COSTS OFF)
              -- SUM(cuotas) a propósito: sin leer la columna cuotas el planner elimina el LEFT
              -- JOIN del carry-forward y el plan deja de ser el que corre de verdad.
              WITH ${snapCte("2026-08-06")} SELECT COUNT(*), SUM(cuotas) FROM snap
            `),
					)
						.map((r: any) => r["QUERY PLAN"])
						.join("\n");
					// Revierte: la base de pruebas queda como estaba.
					throw new Error("ROLLBACK_INTENCIONAL");
				})
				.catch((e) => {
					if (String(e?.message) !== "ROLLBACK_INTENCIONAL") throw e;
				});

			expect(plan).toContain("ix_moras_historial_snapshot");
			expect(plan).toContain("ix_moras_historial_snapshot_cuotas");
			// Lo que el arreglo promete: ni un sort del conjunto completo.
			expect(plan).not.toContain("Sort Method");
			expect(plan).not.toContain("Seq Scan");
			// Index ONLY scan: sin el INCLUDE de la migración el plan sigue sin sort
			// pero vuelve al heap una vez por fila (medido: 23.521 buffers contra 164).
			expect(plan.match(/Heap Fetches: 0/g)).toHaveLength(2);
		});
	});
}
