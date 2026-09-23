import { expect, test } from "bun:test";
import { Pool } from "pg";
import { getInvestmentProjectionContext } from "./reportes";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

integrationTest(
  "deduplica cancelaciones, posiciones y versiones autoritativas del calendario",
  async () => {
    const pool = new Pool({ connectionString: testDatabaseUrl });
    try {
      await pool.query(`
        DROP SCHEMA IF EXISTS cartera CASCADE;
        CREATE SCHEMA cartera;
        CREATE TABLE cartera.creditos (
          credito_id integer PRIMARY KEY,
          "statusCredit" text NOT NULL
        );
        CREATE TABLE cartera.credit_cancelations (
          id serial PRIMARY KEY,
          credit_id integer NOT NULL,
          monto_cancelacion numeric NOT NULL,
          fecha_cancelacion timestamptz NOT NULL
        );
        CREATE TABLE cartera.creditos_inversionistas_espejo (
          id serial PRIMARY KEY,
          credito_id integer NOT NULL,
          inversionista_id integer NOT NULL,
          monto_aportado numeric NOT NULL,
          status text NOT NULL
        );
        CREATE TABLE cartera.cuotas_credito (
          cuota_id integer PRIMARY KEY,
          credito_id integer NOT NULL,
          numero_cuota integer NOT NULL,
          fecha_vencimiento date NOT NULL
        );

        INSERT INTO cartera.creditos VALUES
          (1, 'PENDIENTE_CANCELACION'),
          (2, 'ACTIVO'),
          (10, 'ACTIVO'),
          (11, 'ACTIVO'),
          (12, 'CANCELADO');

        INSERT INTO cartera.credit_cancelations
          (credit_id, monto_cancelacion, fecha_cancelacion)
        VALUES
          (1, 100, '2026-09-01T12:00:00Z'),
          (1, 150, '2026-09-10T12:00:00Z'),
          (2, 900, '2026-09-10T12:00:00Z');

        INSERT INTO cartera.creditos_inversionistas_espejo
          (credito_id, inversionista_id, monto_aportado, status)
        VALUES
          (1, 7, 100, 'activo'),
          (1, 8, 200, 'activo'),
          (1, 86, 300, 'activo'),
          (1, 9, 500, 'cancelado'),
          (10, 7, 400, 'activo'),
          (10, 8, 100, 'activo'),
          (10, 86, 50, 'activo'),
          (11, 7, 700, 'activo'),
          (12, 7, 800, 'activo');

        INSERT INTO cartera.cuotas_credito
          (cuota_id, credito_id, numero_cuota, fecha_vencimiento)
        VALUES
          (1, 10, 1, '2026-11-30'),
          (2, 10, 1, '2026-10-20'),
          (3, 10, 2, '2026-10-31'),
          (4, 11, 1, '2026-11-30'),
          (5, 12, 1, '2026-10-15');
      `);

      expect(
        await getInvestmentProjectionContext({
          fechaInicio: "2026-10-01",
          fechaFin: "2026-10-31",
        }),
      ).toEqual({
        cancelaciones_pendientes: {
          cantidad_creditos: 1,
          monto_bruto: "150.00",
          capital_externo_asociado: "300.00",
        },
        cierres_naturales_periodo: {
          cantidad_creditos: 1,
          capital_externo_asociado: "500.00",
        },
      });
    } finally {
      await pool.query("DROP SCHEMA IF EXISTS cartera CASCADE");
      await pool.end();
    }
  },
);
