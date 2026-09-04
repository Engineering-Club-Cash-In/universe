import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const migrationsDirectory = new URL("../../drizzle/", import.meta.url);
const migrationFileName = readdirSync(migrationsDirectory).find((file) =>
  file.endsWith("_add_origen_historico_monto_aportado.sql"),
);

if (!migrationFileName) {
  throw new Error("No se encontró la migración de origen del historial de monto aportado");
}

const migrationFile = new URL(`../../drizzle/${migrationFileName}`, import.meta.url);

integrationTest(
  "rebuild audited only for changed IDs while unscoped writes keep legacy audit",
  async () => {
    const pool = new Pool(parseTestDatabaseUrl(testDatabaseUrl!));
    try {
      await pool.query("DROP SCHEMA IF EXISTS cartera CASCADE");
      await pool.query("CREATE SCHEMA cartera");
      await pool.query(`
        CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY);
        CREATE TABLE cartera.inversionistas (inversionista_id integer PRIMARY KEY);
        CREATE TABLE cartera.platform_users (id integer PRIMARY KEY, email varchar(200));
        CREATE TABLE cartera.creditos_inversionistas (
          credito_id integer NOT NULL REFERENCES cartera.creditos,
          inversionista_id integer NOT NULL REFERENCES cartera.inversionistas,
          monto_aportado numeric NOT NULL
        );
        CREATE TABLE cartera.creditos_inversionistas_espejo (
          credito_id integer NOT NULL REFERENCES cartera.creditos,
          inversionista_id integer NOT NULL REFERENCES cartera.inversionistas,
          monto_aportado numeric NOT NULL
        );
        CREATE TABLE cartera.historico_monto_aportado_espejo (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          txid bigint NOT NULL,
          operacion text NOT NULL,
          credito_id integer NOT NULL REFERENCES cartera.creditos,
          inversionista_id integer NOT NULL REFERENCES cartera.inversionistas,
          monto_anterior numeric,
          monto_nuevo numeric,
          platform_user_id integer REFERENCES cartera.platform_users,
          user_email varchar(200),
          source text NOT NULL DEFAULT 'unknown',
          fecha timestamptz NOT NULL DEFAULT now()
        );
      `);
      await pool.query(readFileSync(migrationFile, "utf8"));
      await pool.query(`
        CREATE TRIGGER trg_audit_monto_aportado_espejo
        AFTER INSERT OR UPDATE OR DELETE
        ON cartera.creditos_inversionistas_espejo
        FOR EACH ROW
        EXECUTE FUNCTION cartera.audit_monto_aportado_espejo_fn();
      `);
      await pool.query(`
        INSERT INTO cartera.creditos VALUES (1);
        INSERT INTO cartera.inversionistas VALUES (10), (20);
        INSERT INTO cartera.creditos_inversionistas VALUES (1, 10, 100), (1, 20, 200);
      `);
      await pool.query("TRUNCATE cartera.historico_monto_aportado_espejo");

      await pool.query("BEGIN");
      await pool.query(
        "SELECT set_config('app.monto_aportado_rebuild_padre', 'true', true)",
      );
      await pool.query(
        "SELECT set_config('app.monto_aportado_ids_padre', '10', true)",
      );
      await pool.query(
        "SELECT set_config('app.monto_aportado_motivo_padre', 'Ajuste validado', true)",
      );
      await pool.query(
        "DELETE FROM cartera.creditos_inversionistas WHERE credito_id = 1",
      );
      await pool.query(`
        INSERT INTO cartera.creditos_inversionistas VALUES (1, 10, 125), (1, 20, 200)
      `);
      await pool.query("COMMIT");

      const parentHistory = await pool.query(`
        SELECT operacion, origen, inversionista_id, monto_anterior, monto_nuevo, motivo
        FROM cartera.historico_monto_aportado_espejo
        ORDER BY id
      `);
      expect(parentHistory.rows).toEqual([
        {
          operacion: "DELETE",
          origen: "PADRE",
          inversionista_id: 10,
          monto_anterior: "100",
          monto_nuevo: null,
          motivo: "Ajuste validado",
        },
        {
          operacion: "INSERT",
          origen: "PADRE",
          inversionista_id: 10,
          monto_anterior: null,
          monto_nuevo: "125",
          motivo: "Ajuste validado",
        },
      ]);

      await pool.query("TRUNCATE cartera.historico_monto_aportado_espejo");
      await pool.query(
        "INSERT INTO cartera.creditos_inversionistas_espejo VALUES (1, 10, 125)",
      );
      await pool.query("TRUNCATE cartera.historico_monto_aportado_espejo");
      await pool.query("BEGIN");
      await pool.query(
        "DELETE FROM cartera.creditos_inversionistas_espejo WHERE credito_id = 1",
      );
      await pool.query(
        "INSERT INTO cartera.creditos_inversionistas_espejo VALUES (1, 10, 130)",
      );
      await pool.query("COMMIT");

      const mirrorHistory = await pool.query(`
        SELECT operacion, origen, inversionista_id, monto_anterior, monto_nuevo, motivo
        FROM cartera.historico_monto_aportado_espejo
        ORDER BY id
      `);
      expect(mirrorHistory.rows).toEqual([
        {
          operacion: "DELETE",
          origen: "ESPEJO",
          inversionista_id: 10,
          monto_anterior: "125",
          monto_nuevo: null,
          motivo: null,
        },
        {
          operacion: "INSERT",
          origen: "ESPEJO",
          inversionista_id: 10,
          monto_anterior: null,
          monto_nuevo: "130",
          motivo: null,
        },
      ]);
    } finally {
      await pool.query("DROP SCHEMA IF EXISTS cartera CASCADE");
      await pool.end();
    }
  },
);
