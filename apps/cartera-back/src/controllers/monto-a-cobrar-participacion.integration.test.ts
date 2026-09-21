import { expect, test } from "bun:test";
import Big from "big.js";
import { PgDialect } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import {
	buildInteresIvaInversionistaSql,
	participacionExternaActualCteSql,
} from "./monto-a-cobrar-participacion-sql";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const integrationTest = testDatabaseUrl ? test : test.skip;

integrationTest("ejecuta la CTE real contra PostgreSQL desechable", async () => {
	const pool = new Pool(parseTestDatabaseUrl(testDatabaseUrl!));
	try {
		await pool.query("DROP SCHEMA IF EXISTS cartera CASCADE");
		await pool.query("CREATE SCHEMA cartera");
		await pool.query(`
      CREATE TABLE cartera.inversionistas (inversionista_id integer PRIMARY KEY, permite_distribucion boolean NOT NULL);
      CREATE TABLE cartera.creditos_inversionistas (credito_id integer, inversionista_id integer, monto_aportado numeric, porcentaje_participacion_inversionista numeric);
      CREATE TABLE cartera.creditos_inversionistas_espejo (credito_id integer, inversionista_id integer, modalidad_facturacion_spread_id integer);
      CREATE TABLE cartera.modalidad_facturacion_spread (id integer PRIMARY KEY, spread numeric);
    `);
		await pool.query(`
      INSERT INTO cartera.inversionistas VALUES (1, false), (2, true), (3, false);
      INSERT INTO cartera.modalidad_facturacion_spread VALUES (10, 80), (11, NULL);
      INSERT INTO cartera.creditos_inversionistas VALUES
        (1, 1, 40, 75), (1, 2, 60, 0),
        (2, 1, 50, 75), (2, 2, 50, 0),
        (3, 1, 50, 70), (3, 2, 50, 0),
        (4, 1, 50, 80), (4, 3, 50, 80),
        (5, 2, 100, 0),
        (6, 1, -10, 80), (6, 2, 110, 0),
        (7, 1, 1, 50), (7, 3, 1, 50), (7, 2, 1, 0),
        (8, 1, 10, 80), (8, 2, -10, 0),
        (9, 1, 1, 80), (9, 2, -3, 0);
      INSERT INTO cartera.creditos_inversionistas_espejo VALUES
        (2, 1, 10), (3, 1, 11);
    `);

		const { rows } = await pool.query(`
      WITH ${participacionExternaActualCteSql}
      SELECT credito_id, factor_capital_inversionista, factor_interes_iva_inversionista, participacion_invalida
      FROM participacion_externa_actual
      ORDER BY credito_id
    `);

		expect(
			rows.map((row) => ({
				...row,
				factor_capital_inversionista: new Big(row.factor_capital_inversionista).toString(),
				factor_interes_iva_inversionista: new Big(
					row.factor_interes_iva_inversionista,
				).toString(),
			})),
		).toEqual([
			{ credito_id: 1, factor_capital_inversionista: "0.4", factor_interes_iva_inversionista: "0.3", participacion_invalida: false },
			{ credito_id: 2, factor_capital_inversionista: "0.5", factor_interes_iva_inversionista: "0.4", participacion_invalida: false },
			{ credito_id: 3, factor_capital_inversionista: "0.5", factor_interes_iva_inversionista: "0.35", participacion_invalida: false },
			{ credito_id: 4, factor_capital_inversionista: "1", factor_interes_iva_inversionista: "0.8", participacion_invalida: false },
			{ credito_id: 5, factor_capital_inversionista: "0", factor_interes_iva_inversionista: "0", participacion_invalida: false },
			{ credito_id: 6, factor_capital_inversionista: "-0.1", factor_interes_iva_inversionista: "-0.08", participacion_invalida: true },
			{ credito_id: 7, factor_capital_inversionista: "0.66666666666666666667", factor_interes_iva_inversionista: "0.33333333333333333333", participacion_invalida: false },
			{ credito_id: 8, factor_capital_inversionista: "0", factor_interes_iva_inversionista: "0", participacion_invalida: true },
			{ credito_id: 9, factor_capital_inversionista: "0", factor_interes_iva_inversionista: "0", participacion_invalida: true },
		]);

		const split = await pool.query(`
      WITH ${participacionExternaActualCteSql}
      SELECT ${buildInteresIvaInversionistaSql("0.03::numeric", "0::numeric", "7")} AS inversionistas,
             0.03::numeric - ${buildInteresIvaInversionistaSql("0.03::numeric", "0::numeric", "7")} AS cube
    `);
		expect(split.rows[0]).toEqual({ inversionistas: "0.02", cube: "0.01" });

		const invalidSplit = await pool.query(`
      WITH ${participacionExternaActualCteSql}
      SELECT
        ${buildInteresIvaInversionistaSql("0.03::numeric", "0::numeric", "8")} AS inv_cero,
        0.03::numeric - ${buildInteresIvaInversionistaSql("0.03::numeric", "0::numeric", "8")} AS cube_cero,
        ${buildInteresIvaInversionistaSql("0.03::numeric", "0::numeric", "9")} AS inv_negativo,
        0.03::numeric - ${buildInteresIvaInversionistaSql("0.03::numeric", "0::numeric", "9")} AS cube_negativo
    `);
		expect(invalidSplit.rows[0]).toEqual({
			inv_cero: "0",
			cube_cero: "0.03",
			inv_negativo: "0",
			cube_negativo: "0.03",
		});

		const invalidCapital = await pool.query(`
      WITH ${participacionExternaActualCteSql}
      SELECT
        100::numeric * factor_capital_inversionista AS inversionistas,
        100::numeric - 100::numeric * factor_capital_inversionista AS cube
      FROM participacion_externa_actual
      WHERE credito_id = 9
    `);
		expect(invalidCapital.rows[0]).toEqual({ inversionistas: "0", cube: "100" });
	} finally {
		await pool.query("DROP SCHEMA IF EXISTS cartera CASCADE");
		await pool.end();
	}
});

integrationTest(
	"separa las cuotas del período de las cuotas anteriores pendientes",
	async () => {
		if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL es requerida");
		process.env.SUPABASE_DB_URL = testDatabaseUrl;
		const { buildMontoACobrarPeriodoQuery } = await import("./reportes");
		const pool = new Pool(parseTestDatabaseUrl(testDatabaseUrl));
		try {
			await pool.query("DROP SCHEMA IF EXISTS cartera CASCADE");
			await pool.query("CREATE SCHEMA cartera");
			await pool.query(`
			CREATE TABLE cartera.usuarios (usuario_id integer PRIMARY KEY);
			CREATE TABLE cartera.asesores (asesor_id integer PRIMARY KEY);
			CREATE TABLE cartera.creditos (
				credito_id integer PRIMARY KEY, "statusCredit" text, capital numeric,
				porcentaje_interes numeric, cuota numeric, seguro_10_cuotas numeric,
				gps numeric, membresias_pago numeric, usuario_id integer, asesor_id integer
			);
			CREATE TABLE cartera.cuotas_credito (
				cuota_id integer PRIMARY KEY, credito_id integer, fecha_vencimiento date
			);
			CREATE TABLE cartera.pagos_credito (
				pago_id integer PRIMARY KEY, credito_id integer, cuota_id integer,
				fecha_vencimiento date, capital_restante numeric, abono_capital numeric,
				interes_restante numeric, abono_interes numeric, iva_12_restante numeric,
				abono_iva_12 numeric, seguro_restante numeric, abono_seguro numeric,
				gps_restante numeric, abono_gps numeric, membresias numeric,
				membresias_pago numeric, monto_boleta numeric, "paymentFalse" boolean,
				pagado boolean, validation_status text, fecha_boleta date, fecha_pago date,
				total_restante numeric
			);
			CREATE TABLE cartera.moras_historial (credito_id integer, monto_nuevo numeric, fecha timestamptz);
			CREATE TABLE cartera.inversionistas (inversionista_id integer PRIMARY KEY, permite_distribucion boolean NOT NULL);
			CREATE TABLE cartera.creditos_inversionistas (credito_id integer, inversionista_id integer, monto_aportado numeric, porcentaje_participacion_inversionista numeric);
			CREATE TABLE cartera.creditos_inversionistas_espejo (credito_id integer, inversionista_id integer, modalidad_facturacion_spread_id integer);
			CREATE TABLE cartera.modalidad_facturacion_spread (id integer PRIMARY KEY, spread numeric);
			CREATE TABLE cartera.pagos_credito_inversionistas (inversionista_id integer, fecha_pago timestamptz, abono_interes numeric, abono_iva_12 numeric);
			`);
			await pool.query(`
			INSERT INTO cartera.usuarios VALUES (1);
			INSERT INTO cartera.asesores VALUES (1);
			INSERT INTO cartera.creditos VALUES
				(1, 'ACTIVO', 1000, 1, 100, 3, 4, 5, 1, 1),
				(2, 'MOROSO', 900, 1, 100, 3, 4, 5, 1, 1),
				(3, 'MOROSO', 500, 1, 100, 3, 4, 5, 1, 1),
				(4, 'MOROSO', 600, 1, 100, 3, 4, 5, 1, 1),
				(5, 'MOROSO', 600, 1, 100, 3, 4, 5, 1, 1);
			INSERT INTO cartera.cuotas_credito VALUES
				(11, 1, '2026-09-15'),
				(21, 2, '2026-07-15'),
				(22, 2, '2026-08-15'),
				(24, 2, '2026-09-05'),
				(23, 2, '2026-09-15'),
				(31, 3, '2026-06-15'),
				(41, 4, '2026-05-15'),
				(51, 5, '2026-04-15');
			INSERT INTO cartera.pagos_credito VALUES
				(11, 1, 11, '2026-09-15', 76.80, 0, 10, 0, 1.20, 0, 3, 0, 4, 0, 5, 0, 0, false, false, 'pending', NULL, NULL, 1000),
				(21, 2, 21, '2026-07-15', 50, 0, 7, 0, 0.84, 0, 2, 0, 1, 0, 3, 0, 0, false, false, 'pending', NULL, NULL, 950),
				(22, 2, 22, '2026-08-15', 40, 0, 5, 0, 0.60, 0, 1, 0, 0.50, 0, 2, 0, 0, false, false, 'pending', NULL, NULL, 900),
				(24, 2, 24, '2026-09-05', 75.92, 0, 9, 0, 1.08, 0, 3, 0, 4, 0, 5, 0, 0, false, false, 'pending', NULL, NULL, 900),
				(23, 2, 23, '2026-09-15', 75.92, 0, 9, 0, 1.08, 0, 3, 0, 4, 0, 5, 0, 0, false, false, 'pending', NULL, NULL, 900),
				(31, 3, 31, '2026-06-15', 30, 0, 4, 0, 0.48, 0, 1, 0, 1, 0, 1, 0, 0, false, false, 'pending', NULL, NULL, 500),
				(51, 5, 51, '2026-04-15', 0, 81.28, 0, 6, 0, 0.72, 0, 3, 0, 4, 0, 5, 100, false, true, 'validated', '2026-10-15', '2026-10-15', 500);

			`);

			const query = new PgDialect().sqlToQuery(
				buildMontoACobrarPeriodoQuery({
					periodo: "mes",
					fechaInicio: "2026-09-01",
					fechaFin: "2026-09-30",
				}),
			);
			const { rows } = await pool.query(query.sql, query.params);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				cuotas_count: 3,
				mora_count: 5,
				acum_total_cuota: "282.56",
				acum_total_interes: "28.00",
				acum_total_iva: "3.36",
				acum_total_seguro: "10",
				acum_total_gps: "10.50",
				acum_total_membresias: "16",
			});

			const partialFirstPeriod = new PgDialect().sqlToQuery(
				buildMontoACobrarPeriodoQuery({
					periodo: "mes",
					fechaInicio: "2026-09-10",
					fechaFin: "2026-09-30",
				}),
			);
			const partialRows = await pool.query(
				partialFirstPeriod.sql,
				partialFirstPeriod.params,
			);
			expect(partialRows.rows).toHaveLength(1);
			expect(partialRows.rows[0]).toMatchObject({
				cuotas_count: 2,
				mora_count: 6,
				acum_total_cuota: "358.48",
				acum_total_interes: "37.00",
				acum_total_iva: "4.44",
				acum_total_seguro: "13",
				acum_total_gps: "14.50",
				acum_total_membresias: "21",
			});
		} finally {
			await pool.query("DROP SCHEMA IF EXISTS cartera CASCADE");
			await pool.end();
		}
	},
	15_000,
);
