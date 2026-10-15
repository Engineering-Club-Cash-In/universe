import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const migracion = (nombre: string) => Bun.file(new URL(`../../drizzle/${nombre}`, import.meta.url)).text();
const schemaTs = readFileSync(new URL("../database/db/schema.ts", import.meta.url), "utf8");

let sql: ReturnType<typeof postgres> | undefined;
afterAll(async () => { await sql?.end(); });

test("schema.ts declara las columnas, el índice único parcial y el origen nuevo", () => {
  expect(schemaTs).toContain('intento_id: uuid("intento_id")');
  expect(schemaTs).toContain('boletaTardiaIntentoId: uuid("boleta_tardia_intento_id")');
  expect(schemaTs).toContain('"CONDONACION_BOLETA_TARDIA"');
  expect(schemaTs).toContain("uq_moras_condonaciones_intento_viva");
  expect(schemaTs).toContain("pagos_credito_idx_boleta_tardia_intento");
});

integrationTest("0053, 0054 y 0055 son idempotentes y dejan lo prometido", async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  sql = postgres(testDatabaseUrl!, { ssl: false, onnotice: () => undefined });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TYPE cartera.mora_evento_origen AS ENUM
    ('PROCESO_AUTO','API_MANUAL','CONDONACION_INDIVIDUAL','CONDONACION_MASIVA','CONDONACION_NEXA_A_TIEMPO')`;
  await sql`CREATE TABLE cartera.moras_condonaciones (condonacion_id serial PRIMARY KEY,
    credito_id integer NOT NULL, mora_id integer NOT NULL, motivo text NOT NULL,
    usuario_id integer NOT NULL, anulada_at timestamptz)`;
  await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY, credito_id integer)`;

  // Cada archivo dos veces: tiene que ser idempotente. 0053 y 0055 son UNA sola sentencia
  // (ADD VALUE y CONCURRENTLY no corren dentro de un bloque de transacción).
  for (const archivo of [
    "0053_condonacion_boleta_tardia_enum.sql",
    "0054_condonacion_boleta_tardia_columnas.sql",
    "0055_condonacion_boleta_tardia_indice_pagos.sql",
  ]) {
    const texto = await migracion(archivo);
    await sql.unsafe(texto).simple();
    await sql.unsafe(texto).simple();
  }

  const etiquetas = await sql`SELECT unnest(enum_range(NULL::cartera.mora_evento_origen))::text AS e`;
  expect(etiquetas.map((r) => r.e)).toContain("CONDONACION_BOLETA_TARDIA");

  const columnas = await sql`SELECT table_name, column_name, udt_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'cartera' AND column_name IN ('intento_id', 'boleta_tardia_intento_id')
    ORDER BY table_name`;
  expect([...columnas]).toEqual([
    { table_name: "moras_condonaciones", column_name: "intento_id", udt_name: "uuid", is_nullable: "YES" },
    { table_name: "pagos_credito", column_name: "boleta_tardia_intento_id", udt_name: "uuid", is_nullable: "YES" },
  ]);

  const indices = await sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'cartera'
    AND indexname IN ('uq_moras_condonaciones_intento_viva', 'pagos_credito_idx_boleta_tardia_intento')`;
  expect(indices).toHaveLength(2);
  const idxPagos = indices.find((r) => r.indexname === "pagos_credito_idx_boleta_tardia_intento")!;
  expect(idxPagos.indexdef).toContain("boleta_tardia_intento_id IS NOT NULL");
  const validez = await sql`SELECT i.indisvalid FROM pg_index i
    WHERE i.indexrelid = 'cartera.pagos_credito_idx_boleta_tardia_intento'::regclass`;
  expect(validez[0].indisvalid).toBe(true);

  // Único parcial: dos vivas con el mismo intento chocan; una anulada libera el intento.
  const intento = "00000000-0000-4000-8000-000000000001";
  const insertar = () => sql!`INSERT INTO cartera.moras_condonaciones (credito_id, mora_id, motivo, usuario_id, intento_id)
    VALUES (1, 1, 'x', 1, ${intento})`;
  await insertar();
  let codigo: string | undefined;
  try { await insertar(); } catch (error) { codigo = (error as { code?: string }).code; }
  expect(codigo).toBe("23505");
  await sql`UPDATE cartera.moras_condonaciones SET anulada_at = now() WHERE intento_id = ${intento}`;
  await insertar(); // ya no choca
  // Las condonaciones sin intento (Nexa, manuales) no participan del índice.
  await sql`INSERT INTO cartera.moras_condonaciones (credito_id, mora_id, motivo, usuario_id) VALUES (2, 2, 'a', 1), (2, 2, 'b', 1)`;
});
