import { describe, expect, it } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildCapitalCarteraQuery } from "./moraCapitalCartera";

describe("capital de cartera para aging", () => {
  it("parte de una fila por crédito y aplica filtros de cartera y asesor", () => {
    const query = new PgDialect().sqlToQuery(
      buildCapitalCarteraQuery("ana@example.com", [7, 9]),
    );

    expect(query.sql).toContain("SELECT DISTINCT c.credito_id");
    expect(query.sql).toContain("SUM(capital)");
    expect(query.sql).toContain("IN ('ACTIVO', 'MOROSO')");
    expect(query.sql).not.toContain("PENDIENTE_CANCELACION");
    expect(query.sql).not.toContain("INCOBRABLE");
    expect(query.sql).not.toContain("EN_CONVENIO");
    expect(query.sql).not.toContain("CANCELADO");
    expect(query.sql).not.toContain("CAIDO");
    expect(query.sql).toContain("LOWER(a.email_cash_in) = LOWER(TRIM($1))");
    expect(query.params).toEqual(["ana@example.com", 7, 9]);
  });

  it("usa la misma población vigente en mora live, histórica y capital", async () => {
    const source = await Bun.file(new URL("./reportes.ts", import.meta.url)).text();
    const getMoraSource = source.slice(
      source.indexOf("export async function getMoraByEtapaYAsesor"),
      source.indexOf("// Mora COBRADA por asesor"),
    );

    expect(
      getMoraSource.match(/c\."statusCredit" IN \(\$\{creditosElegiblesMoraSql\}\)/g),
    ).toHaveLength(2);
  });

  it("lee mora, capital y cobertura secuencialmente en un solo snapshot", async () => {
    const source = await Bun.file(new URL("./reportes.ts", import.meta.url)).text();
    const getMoraSource = source.slice(
      source.indexOf("export async function getMoraByEtapaYAsesor"),
      source.indexOf("// Mora COBRADA por asesor"),
    );

    expect(getMoraSource).toContain("return db.transaction(");
    expect(getMoraSource).toContain('isolationLevel: "repeatable read"');
    expect(getMoraSource).toContain('accessMode: "read only"');
    expect(getMoraSource).toContain("tx.execute<MoraRow>");
    expect(getMoraSource).toContain("tx.execute<CapitalCarteraRow>");
    expect(getMoraSource).toContain("tx.execute<{ min_fecha: string | null }>");
    expect(getMoraSource).not.toContain("Promise.all");
    expect(getMoraSource).not.toContain("db.execute");
  });
});
