import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { desactivarNexaPorCancelacion } from "./nexaCancelacion";

const dialect = new PgDialect();

const fakeTx = (rows: unknown[]) => {
  const consultas: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
      const { sql, params } = dialect.sqlToQuery(query);
      consultas.push({ sql, params });
      return { rows };
    },
  };
  return { tx: tx as never, consultas };
};

describe("desactivarNexaPorCancelacion", () => {
  test("con binding activo: desactiva, anota el evento y devuelve true", async () => {
    const { tx, consultas } = fakeTx([{ id: 1 }]);
    expect(await desactivarNexaPorCancelacion(tx, 77)).toBe(true);
    expect(consultas).toHaveLength(1);
    const { sql, params } = consultas[0]!;
    expect(sql).toContain("UPDATE cartera.nexa_credit_bindings");
    expect(sql).toContain("SET activo = false");
    expect(sql).toContain("AND activo");
    expect(sql).toContain("INSERT INTO cartera.nexa_outbox");
    expect(sql).toContain("'credit_cancelled'");
    expect(params).toEqual([77]);
  });

  test("sin binding (o ya inactivo): no hay evento y devuelve false", async () => {
    const { tx } = fakeTx([]);
    expect(await desactivarNexaPorCancelacion(tx, 78)).toBe(false);
  });

  test("el evento sale solo de las filas que el UPDATE desactivó", () => {
    const fuente = readFileSync(new URL("./nexaCancelacion.ts", import.meta.url), "utf8");
    expect(fuente).toMatch(/FROM desactivado/);
  });
});

describe("los tres lugares que dejan un crédito CANCELADO", () => {
  const fuente = readFileSync(new URL("./credits.ts", import.meta.url), "utf8");

  test("CANCELAR: dentro de la tx y solo si el estado nuevo es CANCELADO", () => {
    const i = fuente.indexOf("const newStatus =");
    const tramo = fuente.slice(i, fuente.indexOf("credit_cancelations).values", i));
    expect(tramo).toMatch(/if \(newStatus === "CANCELADO"\) \{\s*await desactivarNexaPorCancelacion\(tx, creditId\);/);
  });

  test("resetCredit: solo la rama CANCELADO, no la INCOBRABLE", () => {
    const i = fuente.indexOf("// CANCELADO: zerear todo");
    const tramo = fuente.slice(i, fuente.indexOf("return { nuevoPago, statusCredit }", i));
    expect(tramo).toContain("await desactivarNexaPorCancelacion(tx, creditId);");
    const incobrable = fuente.slice(fuente.lastIndexOf("16d. Registrar en bad_debts"), i);
    expect(incobrable).not.toContain("desactivarNexaPorCancelacion");
  });

  test("compra de cartera: UPDATE del origen y desactivación en la misma tx", () => {
    const i = fuente.indexOf("PASO 5: MARCAR CRÉDITO ORIGEN COMO CANCELADO");
    const tramo = fuente.slice(i, fuente.indexOf("PASO 6", i));
    // Bajo el candado canónico de pagos (serializa con un pago Nexa en vuelo).
    expect(tramo).toMatch(/await conCandadoDePagos\(creditoOrigen\.credito_id, \(\) => db\.transaction\(async \(tx\) => \{\s*await tx\s*\.update\(creditos\)\s*\.set\(\{\s*statusCredit: "CANCELADO"/);
    expect(tramo).toContain("await desactivarNexaPorCancelacion(tx, creditoOrigen.credito_id);");
  });

  test("CANCELAR y resetCredit corren bajo el candado canónico de pagos", () => {
    expect(fuente).toMatch(/accion === "CANCELAR" \? conCandadoDePagos\(creditId, fn\) : fn\(\)/);
    expect(fuente).toMatch(/const result = await conCandadoSiCancela\(\(\) => db\.transaction\(/);
    expect(fuente).toMatch(/const \{ statusCredit \} = await conCandadoDePagos\(creditId, \(\) => db\.transaction\(/);
  });

  test("no hay llamadas de más", () => {
    expect((fuente.match(/desactivarNexaPorCancelacion\(/g) ?? []).length).toBe(3);
  });
});

describe("registrar token no reactiva", () => {
  test("el ON CONFLICT DO UPDATE no setea activo", () => {
    const fuente = readFileSync(new URL("./nexaTokenRuntime.ts", import.meta.url), "utf8");
    const i = fuente.indexOf("ON CONFLICT (credito_id) DO UPDATE");
    const set = fuente.slice(i, fuente.indexOf("WHERE cartera.nexa_credit_bindings.nexa_token IS NULL", i));
    expect(i).toBeGreaterThan(-1);
    expect(set).not.toMatch(/activo/);
  });
});
