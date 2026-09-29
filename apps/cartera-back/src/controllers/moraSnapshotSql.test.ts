import { describe, expect, it } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { snapCte } from "./moraSnapshotSql";
import { inicioDiaGTComoTimestampUTC } from "../utils/functions/diaGuatemala";

const render = (fecha: string, incluirFecha?: boolean) =>
	new PgDialect().sqlToQuery(sql`WITH ${snapCte(fecha, incluirFecha)} SELECT 1`);

const render2 = (fecha: string, incluirFecha?: boolean, creditos?: number[]) =>
	new PgDialect().sqlToQuery(
		sql`WITH ${snapCte(fecha, incluirFecha, creditos)} SELECT 1`,
	);

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

describe("snapCte — el lote acota la foto", () => {
	// EL DEFECTO que este parámetro cierra: el reporte de recuperación corre por
	// lotes de 500 créditos, pero la foto se reconstruía SIEMPRE sobre la cartera
	// entera y los créditos ajenos se descartaban recién en el JOIN final. N
	// lotes = N fotos completas.
	it("con lote, cada CTE se ata al crédito por LATERAL", () => {
		const { sql: texto, params } = render2("2026-08-06", false, [7, 9]);
		expect(texto).toMatch(/snap_ultimo AS \([\s\S]*?unnest\(ARRAY\[/);
		expect(texto).toMatch(/snap_cuotas AS \([\s\S]*?unnest\(ARRAY\[/);
		// Dos veces: una por CTE. Es lo que ata la lectura al crédito del lote.
		expect(texto.match(/h\.credito_id = l\.credito_id/g)).toHaveLength(2);
		expect(params).toContain(7);
		expect(params).toContain(9);
	});

	// NO es el DISTINCT ON con un `credito_id = ANY (...)` pegado: medido contra
	// el dump inflado a 164.000 filas, esa forma le hace elegir al planner
	// Seq Scan + Sort externo A DISCO, que es justo el modo de falla que la 0041
	// existe para eliminar. Si alguien "simplifica" a esa forma, este test cae.
	it("con lote NO usa DISTINCT ON (que a escala se va a Seq Scan + Sort)", () => {
		const { sql: texto } = render2("2026-08-06", false, [7, 9]);
		expect(texto).not.toContain("DISTINCT ON");
	});

	it("el LATERAL pide UNA fila por crédito, la más reciente", () => {
		const { sql: texto } = render2("2026-08-06", false, [7, 9]);
		// Sin el LIMIT 1 el LATERAL devolvería el historial entero del crédito.
		expect(texto.match(/LIMIT 1/g)).toHaveLength(2);
		expect(
			texto.match(/ORDER BY h\.fecha DESC, h\.historial_id DESC/g),
		).toHaveLength(2);
	});

	it("el corte por día de Guatemala sigue siendo sargable con lote", () => {
		const { sql: texto } = render2("2026-08-06", false, [7, 9]);
		expect(texto).not.toMatch(/h\.fecha\s+AT TIME ZONE/i);
		expect(texto.match(/h\.fecha < \$\d+::timestamp/g)).toHaveLength(2);
	});

	it("de-duplica: un id repetido no duplica el crédito en la foto", () => {
		// El LATERAL emite una fila por ENTRADA de la lista; el DISTINCT ON no
		// podía tener este problema. Duplicar un crédito lo contaría dos veces.
		const { params } = render2("2026-08-06", false, [7, 7, 9, 7]);
		expect(params.filter((p) => p === 7)).toHaveLength(2); // uno por CTE
	});
});

describe("snapCte — los otros llamadores siguen funcionando sin el parámetro", () => {
	// `moraHistorial.ts` (Mora Histórica) y `reportes.ts` (mora por etapa/asesor)
	// piden la foto de TODA la cartera y no tienen lista de créditos que pasar.
	// El parámetro nuevo es opcional y sin él la CTE tiene que ser byte por byte
	// la de antes.
	it("sin el parámetro, el SQL es EXACTAMENTE el mismo que con `undefined`", () => {
		for (const incluir of [true, false]) {
			const a = render("2026-08-06", incluir);
			const b = render2("2026-08-06", incluir, undefined);
			expect(b.sql).toBe(a.sql);
			expect(b.params).toEqual(a.params);
		}
	});

	it("sin lote sigue siendo el DISTINCT ON de siempre, sin unnest", () => {
		const { sql: texto } = render("2026-08-06");
		expect(texto.match(/DISTINCT ON \(h\.credito_id\)/g)).toHaveLength(2);
		expect(texto).not.toContain("unnest(");
		expect(texto).not.toContain("LATERAL");
	});

	it("una lista VACÍA es 'sin filtro', no 'ningún crédito'", () => {
		// Un lote vacío que se interpretara como `IN ()` volvería vacío un
		// reporte completo. `partirEnLotes` no produce lotes vacíos, pero el
		// parámetro es público.
		const a = render("2026-08-06");
		const b = render2("2026-08-06", true, []);
		expect(b.sql).toBe(a.sql);
	});

	it("`snap` expone las mismas columnas con y sin lote", () => {
		// Los llamadores hacen `SELECT ... FROM snap s`: si el lote cambiara las
		// columnas, romperían.
		const columnas = (texto: string) =>
			texto.slice(texto.indexOf("snap AS (")).match(/u\.\w+|COALESCE\([^)]*\) AS \w+/g);
		expect(columnas(render2("2026-08-06", true, [7]).sql)).toEqual(
			columnas(render("2026-08-06").sql),
		);
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

		// La forma CON lote y la forma SIN lote tienen que dar la MISMA foto para
		// los créditos del lote: es lo único que autoriza a usar una por la otra.
		it("la foto acotada al lote es fila por fila la de la cartera entera", async () => {
			const creditos = rowsOf(
				await db.execute<any>(sql`
          SELECT DISTINCT credito_id FROM cartera.moras_historial
          ORDER BY credito_id LIMIT 500
        `),
			).map((c: any): number => Number(c.credito_id));
			expect(creditos.length).toBeGreaterThan(100);

			const foto = async (lote?: number[]) =>
				rowsOf(
					await db.execute<any>(sql`
            WITH ${snapCte("2026-08-06", true, lote)}
            SELECT credito_id, tipo_evento, monto::text AS monto, cuotas, fecha
            FROM snap
            ${
							lote
								? sql``
								: sql`WHERE credito_id = ANY (ARRAY[${sql.join(
										creditos.map((id: number) => sql`${id}`),
										sql`, `,
									)}]::int[])`
						}
            ORDER BY credito_id
          `),
				).map((r: any) => JSON.stringify(r));

			const entera = await foto();
			const porLote = await foto(creditos);
			expect(porLote.length).toBe(entera.length);
			expect(porLote).toEqual(entera);
		});

		it("el plan de la foto ACOTADA no ordena ni barre la tabla", async () => {
			// El mismo contrato que abajo, pero para la rama del lote. Con
			// `DISTINCT ON` + `credito_id = ANY (...)` este test cae: medido contra
			// el dump inflado, el planner elige Seq Scan + Sort externo a disco.
			const migracion = await Bun.file(
				new URL(
					"../../drizzle/0041_idx_moras_historial_snapshot.sql",
					import.meta.url,
				).pathname,
			).text();
			const creditos = rowsOf(
				await db.execute<any>(sql`
          SELECT DISTINCT credito_id FROM cartera.moras_historial
          ORDER BY credito_id LIMIT 500
        `),
			).map((c: any) => Number(c.credito_id));

			let plan = "";
			await db
				.transaction(async (tx) => {
					await tx.execute(sql.raw(migracion));
					await tx.execute(sql.raw("ANALYZE cartera.moras_historial"));
					plan = rowsOf(
						await tx.execute<any>(sql`
              EXPLAIN (ANALYZE, COSTS OFF)
              WITH ${snapCte("2026-08-06", true, creditos)}
              SELECT COUNT(*), SUM(cuotas) FROM snap
            `),
					)
						.map((r: any) => r["QUERY PLAN"])
						.join("\n");
					throw new Error("ROLLBACK_INTENCIONAL");
				})
				.catch((e) => {
					if (String(e?.message) !== "ROLLBACK_INTENCIONAL") throw e;
				});

			expect(plan).toContain("ix_moras_historial_snapshot");
			expect(plan).toContain("ix_moras_historial_snapshot_cuotas");
			expect(plan).not.toContain("Sort Method");
			expect(plan).not.toContain("Seq Scan");
			// Un descenso de índice por crédito, no un barrido: el LATERAL corre
			// una vez por entrada del lote.
			expect(plan).toContain(`loops=${creditos.length}`);
			expect(plan.match(/Heap Fetches: 0/g)).toHaveLength(2);
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
