import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// Opt in to a disposable PostgreSQL container; never uses application DB credentials.
const container = process.env.PAYMENT_DATE_TEST_CONTAINER;
const integration = container ? test : test.skip;

integration("payment list preserves Nexa calendar dates and legacy Guatemala dates", async () => {
  const source = await Bun.file(new URL("./payments.ts", import.meta.url)).text();
  const expression = source.match(/const fechaPagoLocalSQL = `([^`]+)`/)?.[1]
    ?? "p.fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala'";
  const projection = source.includes("TO_CHAR(${sql.raw(fechaPagoLocalSQL)},")
    ? sql`to_char(${sql.raw(expression)}, 'YYYY-MM-DD HH24:MI:SS')`
    : sql`to_char(${expression}, 'YYYY-MM-DD HH24:MI:SS')`;
  const compiled = new PgDialect().sqlToQuery(projection);
  expect(compiled.params).toEqual([]);
  const query = `
    BEGIN READ ONLY;
    WITH p(id, fecha_pago, nexa_payment_event_id) AS (VALUES
      (1, timestamp '2026-09-30 00:00:00', 1),
      (2, timestamp '2026-09-30 00:00:00', NULL),
      (3, timestamp '2026-10-01 00:00:00', 2),
      (4, timestamp '2027-01-01 00:00:00', 3),
      (5, timestamp '2026-09-30 14:20:38', NULL),
      (6, NULL::timestamp, 4)
    ) SELECT json_agg(row_to_json(result) ORDER BY id) FROM (
      SELECT id, ${compiled.sql} AS displayed,
        (${expression})::date = date '2026-09-30' AS same_day,
        extract(year from (${expression}))::int AS year
      FROM p
    ) result;
    ROLLBACK;`;
  const proc = Bun.spawn(["docker", "exec", "-i", container!, "psql", "-U", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"], {
    stdin: new Blob([query]), stdout: "pipe", stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  expect(JSON.parse(output)).toEqual([
    { id: 1, displayed: "2026-09-30 00:00:00", same_day: true, year: 2026 },
    { id: 2, displayed: "2026-09-29 18:00:00", same_day: false, year: 2026 },
    { id: 3, displayed: "2026-10-01 00:00:00", same_day: false, year: 2026 },
    { id: 4, displayed: "2027-01-01 00:00:00", same_day: false, year: 2027 },
    { id: 5, displayed: "2026-09-30 08:20:38", same_day: true, year: 2026 },
    { id: 6, displayed: null, same_day: null, year: null },
  ]);
  // Projection and all five payment-date filters must share this expression.
  const listing = source.slice(source.indexOf("export async function getPagosConInversionistas"), source.indexOf("fechaPago: r.fechaPago"));
  expect(listing.match(/\$\{fechaPagoLocal\}/g)?.length).toBe(5);
  expect(listing).toContain("TO_CHAR(${sql.raw(fechaPagoLocalSQL)},");
});
