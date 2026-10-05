import { describe, expect, it } from "bun:test";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { cuotas_credito, creditos } from "../database/db/schema";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { coberturaDeCuotaSql, DIAS_PAGO_PENDIENTE_FRENA_MORA, hasPaidPaymentSql } from "./cuotaYaPagadaSql";

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

describe("coberturaDeCuotaSql cuenta las mismas filas de pago que hasPaidPaymentSql", () => {
  // La proyección de mora del mes separa «validado» de «pendiente» para poder
  // evaluar la ventana del pendiente en cualquier día; QUÉ fila de pago cuenta
  // tiene que seguir siendo lo mismo que cobra el cron.
  const fuente = readFileSync(new URL("./cuotaYaPagadaSql.ts", import.meta.url), "utf8");
  it("repite el filtro de fila, una vez en cada función", () => {
    for (const condicion of [
      'WHERE pc.cuota_id = "cartera"."cuotas_credito"."cuota_id"',
      'AND pc."paymentFalse" = false',
      "AND pc.pagado = true",
      "AND COALESCE(pc.monto_aplicado, 0) > 0",
      "validation_status IN ('validated', 'no_required')",
      "pc.validation_status = 'pending'",
    ]) {
      expect(fuente.split(condicion).length - 1).toBe(2);
    }
  });
  it("las dos mitades comparan contra la cuota de AFUERA y no miran now()", () => {
    const c = coberturaDeCuotaSql();
    const { sql } = new QueryBuilder()
      .select({ v: c.validado, f: c.fechasPendiente })
      .from(cuotas_credito)
      .toSQL();
    expect(sql.split(CALIFICADA).length - 1).toBe(2);
    expect(sql).not.toContain("now()");
    expect(sql).toContain("string_agg(to_char(pc.fecha_pago::date, 'YYYY-MM-DD'), ',')");
  });
});
