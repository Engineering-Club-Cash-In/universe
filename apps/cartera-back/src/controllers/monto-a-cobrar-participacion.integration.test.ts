import { expect, test } from "bun:test";
import Big from "big.js";
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
