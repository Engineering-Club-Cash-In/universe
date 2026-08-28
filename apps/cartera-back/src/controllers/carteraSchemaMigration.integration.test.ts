import { expect, test } from "bun:test";
import { Pool } from "pg";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

integrationTest("aplica dos veces la migración de clasificación y snapshots", async () => {
  const pool = new Pool(parseTestDatabaseUrl(testDatabaseUrl!));
  const migration = await Bun.file(
    new URL("../../drizzle/0030_add_purchase_classification_liquidation_snapshots.sql", import.meta.url),
  ).text();

  try {
    await pool.query("DROP SCHEMA IF EXISTS cartera CASCADE");
    await pool.query("CREATE SCHEMA cartera");
    await pool.query(`
      CREATE TYPE cartera.tipo_reinversion AS ENUM (
        'sin_reinversion', 'reinversion_capital', 'reinversion_interes',
        'reinversion_total', 'reinversion_variable', 'reinversion_excedente',
        'reinversion_combinada'
      );
      CREATE TYPE cartera.modalidad_facturacion AS ENUM ('A', 'B');
      CREATE TABLE cartera.compras_credito_inversionista (id serial PRIMARY KEY);
      CREATE TABLE cartera.liquidaciones (liquidacion_id serial PRIMARY KEY);
      CREATE TABLE cartera.historico_liquidaciones_espejo (id serial PRIMARY KEY);
    `);

    await pool.query(migration);
    await pool.query(migration);

    const { rows } = await pool.query(`
      SELECT table_name, column_name, is_nullable, column_default, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'cartera'
        AND (
          (table_name = 'compras_credito_inversionista' AND column_name = 'tipo_compra')
          OR (table_name = 'liquidaciones' AND column_name IN ('tipo_reinversion_snapshot', 'modalidad_facturacion_snapshot'))
          OR (table_name = 'historico_liquidaciones_espejo' AND column_name IN ('tipo_reinversion_snapshot', 'modalidad_facturacion_snapshot', 'capital_liquidado', 'capital_restante'))
        )
      ORDER BY table_name, column_name
    `);
    expect(rows).toEqual([
      expect.objectContaining({ table_name: "compras_credito_inversionista", column_name: "tipo_compra", is_nullable: "NO", udt_name: "tipo_compra" }),
      expect.objectContaining({ table_name: "historico_liquidaciones_espejo", column_name: "capital_liquidado", is_nullable: "YES" }),
      expect.objectContaining({ table_name: "historico_liquidaciones_espejo", column_name: "capital_restante", is_nullable: "YES" }),
      expect.objectContaining({ table_name: "historico_liquidaciones_espejo", column_name: "modalidad_facturacion_snapshot", is_nullable: "YES" }),
      expect.objectContaining({ table_name: "historico_liquidaciones_espejo", column_name: "tipo_reinversion_snapshot", is_nullable: "YES" }),
      expect.objectContaining({ table_name: "liquidaciones", column_name: "modalidad_facturacion_snapshot", is_nullable: "YES" }),
      expect.objectContaining({ table_name: "liquidaciones", column_name: "tipo_reinversion_snapshot", is_nullable: "YES" }),
    ]);
    expect(rows[0].column_default).toContain("sin_clasificar");

    await expect(pool.query(`INSERT INTO cartera.compras_credito_inversionista DEFAULT VALUES RETURNING id, tipo_compra`))
      .resolves.toMatchObject({ rows: [{ tipo_compra: "sin_clasificar" }] });
    await expect(pool.query(`UPDATE cartera.compras_credito_inversionista SET tipo_compra = 'nueva_posicion'`))
      .rejects.toThrow("tipo_compra es inmutable");
  } finally {
    await pool.query("DROP SCHEMA IF EXISTS cartera CASCADE");
    await pool.end();
  }
});
