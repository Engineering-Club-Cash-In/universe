import { expect, test } from "bun:test";
import { Pool } from "pg";
import { getOfficialClosure, saveOfficialClosure } from "./cierreMoraOficial";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

function createTestPool() {
	if (!testDatabaseUrl)
		throw new Error("TEST_DATABASE_URL no está configurada");
	return new Pool(parseTestDatabaseUrl(testDatabaseUrl));
}

const migrationUrl = new URL(
	"../../drizzle/0036_add_cierre_mora_oficial.sql",
	import.meta.url,
);
const rateMigrationUrl = new URL(
	"../../drizzle/0037_add_cierre_mora_porcentaje.sql",
	import.meta.url,
);

async function prepareDatabase(pool: Pool) {
	await pool.query("DROP SCHEMA IF EXISTS cartera CASCADE");
	await pool.query("CREATE SCHEMA cartera");
	await pool.query(`
    CREATE TABLE cartera.asesores (
      asesor_id integer PRIMARY KEY,
      nombre text NOT NULL
    );
    INSERT INTO cartera.asesores VALUES (7, 'Asesora Uno');
  `);
	const migration = await Bun.file(migrationUrl).text();
	const rateMigration = await Bun.file(rateMigrationUrl).text();
	await pool.query(migration);
	await pool.query(rateMigration);
	await pool.query(rateMigration);
	return migration;
}

integrationTest("crea cierres oficiales inmutables por asesor", async () => {
	const pool = createTestPool();
	try {
		const migration = await prepareDatabase(pool);
		await pool.query(migration);
		await pool.query(`
      INSERT INTO cartera.cierre_mora_oficial (
        periodo, asesor_id, asesor_nombre, capital_cierre,
        capital_mora_30, capital_mora_60, capital_mora_90, capital_mora_120,
        cantidad_mora_30, cantidad_mora_60, cantidad_mora_90, cantidad_mora_120,
        fecha_corte, regla_version, fuente, fuente_hash
      ) VALUES (
        DATE '2026-08-01', 7, 'Asesora Uno', 150, 40, 50, 0, 0,
        1, 1, 0, 0, TIMESTAMPTZ '2026-08-31 23:59:59-06', 'finanzas-v1', 'fixture.xlsx',
        repeat('a', 64)
      );
    `);

		await expect(
			pool.query("UPDATE cartera.cierre_mora_oficial SET capital_cierre = 151"),
		).rejects.toThrow("cierre_mora_oficial es inmutable");
		await expect(
			pool.query(`
        INSERT INTO cartera.cierre_mora_oficial (
          periodo, asesor_id, asesor_nombre, capital_cierre, fecha_corte, regla_version, fuente, fuente_hash
        ) VALUES (DATE '2026-08-01', 7, 'Asesora Uno', 150, NOW(), 'finanzas-v1', 'fixture.xlsx', repeat('a', 64))
      `),
		).rejects.toThrow();
	} finally {
		await pool.query("DROP SCHEMA IF EXISTS cartera CASCADE");
		await pool.end();
	}
});

integrationTest("importa y consulta un período una sola vez", async () => {
	const pool = createTestPool();
	try {
		await prepareDatabase(pool);
		const input = {
			periodo: "2026-08-01",
			fechaCorte: "2026-08-31T23:59:59-06:00",
			reglaVersion: "finanzas-v1",
			porcentajeMora: "1.12",
			fuente: "fixture.xlsx",
			fuenteHash: "a".repeat(64),
			rows: [
				{
					asesorId: 7,
					asesorNombre: "Asesora Uno",
					capital: "150.00",
					mora30: "40.00",
					mora60: "50.00",
					mora90: "0.00",
					mora120: "0.00",
					cantidadMora30: 1,
					cantidadMora60: 1,
					cantidadMora90: 0,
					cantidadMora120: 0,
				},
			],
		};

		await expect(saveOfficialClosure(pool, input)).resolves.toEqual({
			periodo: "2026-08-01",
			asesores: 1,
			imported: true,
		});
		await expect(getOfficialClosure(pool, "2026-08-01")).resolves.toMatchObject(
			{
				periodo: "2026-08-01",
				capitalCartera: { total: "150.00" },
				moraMensual: {
					porcentaje: "1.12",
					esperado: "1.01",
					porAsesor: [
						{ asesorId: 7, nombre: "Asesora Uno", esperado: "1.01" },
					],
				},
				totales: {
					mora_30: { cantidad: 1, sumaCapital: "40.00" },
					mora_60: { cantidad: 1, sumaCapital: "50.00" },
				},
				metadata: { fuente: "oficial", inmutable: true },
			},
		);
		await pool.query(
			"UPDATE cartera.asesores SET nombre = 'Nombre posterior' WHERE asesor_id = 7",
		);
		await expect(getOfficialClosure(pool, "2026-08-01")).resolves.toMatchObject(
			{
				porAsesor: [{ asesorId: 7, nombre: "Asesora Uno" }],
			},
		);
		await expect(saveOfficialClosure(pool, input)).resolves.toEqual({
			periodo: "2026-08-01",
			asesores: 1,
			imported: false,
		});
		await expect(
			saveOfficialClosure(pool, { ...input, porcentajeMora: "2.00" }),
		).rejects.toThrow("otra tasa");
		await expect(
			saveOfficialClosure(pool, {
				...input,
				fuenteHash: "b".repeat(64),
			}),
		).rejects.toThrow("otra fuente");
		await expect(
			saveOfficialClosure(pool, {
				...input,
				periodo: "2026-09-01",
				fechaCorte: "2026-09-30T23:59:59-06:00",
			}),
		).rejects.toThrow("ya fue importada");
	} finally {
		await pool.query("DROP SCHEMA IF EXISTS cartera CASCADE");
		await pool.end();
	}
});

integrationTest("rechaza una fecha de corte fuera del período", async () => {
	const pool = createTestPool();
	try {
		await prepareDatabase(pool);
		await expect(
			saveOfficialClosure(pool, {
				periodo: "2026-08-01",
				fechaCorte: "2026-09-01T00:00:00-06:00",
				reglaVersion: "finanzas-v1",
				porcentajeMora: "1.12",
				fuente: "fixture.xlsx",
				fuenteHash: "a".repeat(64),
				rows: [
					{
						asesorId: 7,
						asesorNombre: "Asesora Uno",
						capital: "150.00",
						mora30: "40.00",
						mora60: "50.00",
						mora90: "0.00",
						mora120: "0.00",
						cantidadMora30: 1,
						cantidadMora60: 1,
						cantidadMora90: 0,
						cantidadMora120: 0,
					},
				],
			}),
		).rejects.toThrow("fecha de corte");
	} finally {
		await pool.query("DROP SCHEMA IF EXISTS cartera CASCADE");
		await pool.end();
	}
});
