import { describe, expect, it } from "bun:test";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { cuotas_credito, creditos } from "../database/db/schema";
import { eq } from "drizzle-orm";
import { hasPaidPaymentSql } from "./cuotaYaPagadaSql";

const CALIFICADA = 'pc.cuota_id = "cartera"."cuotas_credito"."cuota_id"';

describe("hasPaidPaymentSql compara contra la cuota de AFUERA", () => {
  // Sin join, Drizzle renderizaba la columna sin tabla y el subquery quedaba
  // `pc.cuota_id = pc.cuota_id`: todas las cuotas parecían pagadas.
  it("en un select de una sola tabla", () => {
    const { sql } = new QueryBuilder().select({ h: hasPaidPaymentSql() }).from(cuotas_credito).toSQL();
    expect(sql).toContain(CALIFICADA);
  });
  it("en un select con join", () => {
    const { sql } = new QueryBuilder()
      .select({ h: hasPaidPaymentSql() })
      .from(cuotas_credito)
      .innerJoin(creditos, eq(creditos.credito_id, cuotas_credito.credito_id))
      .toSQL();
    expect(sql).toContain(CALIFICADA);
  });
});
