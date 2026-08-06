import { describe, expect, it, mock, beforeEach } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";

// Evita que database/index.ts abra la conexión al importar el controller.
// El db mockeado captura la condición WHERE del select de pagos para poder
// afirmar sobre el SQL que genera; devuelve 0 filas para que el recálculo
// termine ahí (early return) sin tocar nada más.
const capturedWheres: any[] = [];
const fakeCredito = {
  credito_id: 794,
  capital: "18493.39",
  porcentaje_interes: "1.50",
  cuota_interes: "277.40",
  seguro_10_cuotas: "260.93",
  gps: "0.00",
  membresias_pago: "399.73",
  cuota: "2021.83",
};
const dbMock = {
  select: () => ({
    from: () => ({
      // select del crédito: .where().limit(1)
      where: () => ({ limit: () => Promise.resolve([fakeCredito]) }),
      // select de pagos: .innerJoin().where(cond).orderBy()
      innerJoin: () => ({
        where: (cond: any) => {
          capturedWheres.push(cond);
          return { orderBy: () => Promise.resolve([]) };
        },
      }),
    }),
  }),
};
mock.module("../database", () => ({ db: dbMock, client: {}, lockPool: {} }));
mock.module("../services/sifcoIntegrations", () => ({
  consultarEstadoCuentaPrestamo: () => Promise.resolve(null),
}));

const { recalcularPagosCredito } = await import("./updateCredit");

const renderSql = (cond: any) => new PgDialect().sqlToQuery(cond);

beforeEach(() => {
  capturedWheres.length = 0;
});

describe("recalcularPagosCredito — exclusión de pagos de reset", () => {
  it("excluye filas validation_status='reset' al recalcular desde una cuota", async () => {
    await recalcularPagosCredito({
      numero_credito_sifco: "01010214120190",
      numero_cuota: 1,
    });

    expect(capturedWheres.length).toBe(1);
    const q = renderSql(capturedWheres[0]);
    // El NOT IN de estados excluidos debe cubrir también 'reset': un pago de
    // reset de incobrable no es un pago de cuota y redistribuir su split lo
    // convierte en pago normal (caso real: crédito 794).
    expect(q.params).toContain("reset");
    expect(q.params).toContain("capital");
    expect(q.params).toContain("capital_validated");
  });

  it("excluye filas validation_status='reset' también en el modo sin numero_cuota", async () => {
    await recalcularPagosCredito({ numero_credito_sifco: "01010214120190" });

    expect(capturedWheres.length).toBe(1);
    const q = renderSql(capturedWheres[0]);
    expect(q.params).toContain("reset");
    expect(q.params).toContain("capital");
    expect(q.params).toContain("capital_validated");
  });
});
