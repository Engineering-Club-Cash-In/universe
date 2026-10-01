import { describe, expect, it } from "bun:test";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { cuotas_credito, creditos } from "../database/db/schema";
import { eq } from "drizzle-orm";
import { DIAS_PAGO_PENDIENTE_FRENA_MORA, hasPaidPaymentSql } from "./cuotaYaPagadaSql";

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

const render = (opciones?: { excluirPagoId?: number }) =>
  new QueryBuilder().select({ h: hasPaidPaymentSql(opciones) }).from(cuotas_credito).toSQL();

describe("hasPaidPaymentSql: un pago PENDIENTE frena la mora solo 7 días", () => {
  it("el tope es 7 días", () => {
    expect(DIAS_PAGO_PENDIENTE_FRENA_MORA).toBe(7);
  });
  it("lo validado sigue cubriendo y lo pendiente cubre acotado por fecha_pago en Guatemala", () => {
    const { sql } = render();
    expect(sql).toContain("pc.validation_status IN ('validated', 'no_required')");
    expect(sql).toContain("pc.validation_status = 'pending'");
    expect(sql).toContain(
      "pc.fecha_pago::date >= ((now() AT TIME ZONE 'America/Guatemala')::date - 7)",
    );
    // Y con tope de arriba: una fecha futura no alarga el freno.
    expect(sql).toContain("pc.fecha_pago::date <= ((now() AT TIME ZONE 'America/Guatemala')::date + 1)");
    // El pendiente es una ALTERNATIVA al validado, no una condición extra.
    expect(sql).toMatch(/IN \('validated', 'no_required'\)\s+OR \(\s+pc\.validation_status = 'pending'/);
    // Anulado, pago especial (monto 0) y pagado=false siguen sin cubrir, también pendiente.
    expect(sql).toContain(`pc."paymentFalse" = false`);
    expect(sql).toContain("COALESCE(pc.monto_aplicado, 0) > 0");
  });
  it("sin opciones no excluye ningún pago", () => {
    const { sql, params } = render();
    expect(sql).not.toContain("pc.pago_id <>");
    expect(params).toEqual([]);
  });
  it("excluirPagoId saca ESE pago de la cobertura", () => {
    const { sql, params } = render({ excluirPagoId: 4321 });
    expect(sql).toContain("AND pc.pago_id <> $1");
    expect(params).toEqual([4321]);
    expect(sql).toContain(CALIFICADA);
  });
});
