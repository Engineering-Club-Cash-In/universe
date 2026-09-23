import { describe, expect, it, mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { asesores } from "../database/db/schema";

let matchedAdvisorId: number | null = null;
const creditQueries: unknown[] = [];
const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      if (table === asesores) {
        return {
          where: () => ({
            limit: async () => matchedAdvisorId === null ? [] : [{ asesor_id: matchedAdvisorId }],
          }),
        };
      }
      const aggregate = {
        where: async (condition: unknown) => {
          creditQueries.push(condition);
          return [{ total: 2, cantidad: 1, sumaCapital: "100", sumaMora: "0" }];
        },
      };
      return { ...aggregate, leftJoin: () => aggregate };
    },
  }),
};
mock.module("@cci/email", () => ({
  sendPlainEmail: async () => undefined,
  sendSimpleEmail: async () => undefined,
  sendInvestorAddedToCreditsNotification: async () => undefined,
  sendNewCreditNotification: async () => undefined,
  sendLiquidationEmail: async () => undefined,
  sendPasswordResetEmail: async () => undefined,
  sendPortalWelcomeEmail: async () => undefined,
  sendPortalCompanyAddedEmail: async () => undefined,
  sendCompraCarteraAcceptedNotification: async () => undefined,
  sendCompraCarteraExpiradaNotification: async () => undefined,
  sendSessionCancelledNotification: async () => undefined,
  getEmailDeliveryMode: () => "dry_run",
  resolveEmailDeliveryMode: () => "dry_run",
}));
mock.module("../database/index", () => ({ db: dbMock, client: {}, lockPool: {} }));
const { getCreditStats } = await import("./credits");

const sql = new PgDialect();

describe("credit statistics advisor scope", () => {
  it("returns an empty, compatible response for an unknown email without querying global credit aggregates", async () => {
    matchedAdvisorId = null;
    creditQueries.length = 0;
    const result = await getCreditStats("missing@example.invalid");
    expect(result.totalCreditos).toBe(0);
    expect(result.efectividad).toBe("0");
    const empty = { cantidad: 0, porcentaje: "0", sumaCapital: "0", sumaMora: "0" };
    expect(result.porCuotasAtrasadas).toEqual({
      "0": empty, "1": empty, "2": empty, "3": empty, "4": empty,
    });
    expect(result.porEstado).toEqual({ cancelado: empty, incobrable: empty });
    expect(creditQueries).toHaveLength(0);
  });

  it("does not treat an explicitly empty email as a global request", async () => {
    matchedAdvisorId = null;
    creditQueries.length = 0;
    const result = await getCreditStats("");
    expect(result.totalCreditos).toBe(0);
    expect(creditQueries).toHaveLength(0);
  });

  it("preserves the scoped and intentionally unscoped queries", async () => {
    matchedAdvisorId = 7;
    creditQueries.length = 0;
    const scoped = await getCreditStats("advisor@example.invalid");
    expect(scoped.totalCreditos).toBe(2);
    expect(creditQueries.length).toBeGreaterThan(0);
    expect(creditQueries.every((condition) =>
      sql.sqlToQuery(condition as Parameters<typeof sql.sqlToQuery>[0]).sql.includes("asesor_id")
    )).toBe(true);

    creditQueries.length = 0;
    const global = await getCreditStats();
    expect(global.totalCreditos).toBe(2);
    expect(creditQueries.length).toBeGreaterThan(0);
    expect(creditQueries.every((condition) =>
      !sql.sqlToQuery(condition as Parameters<typeof sql.sqlToQuery>[0]).sql.includes("asesor_id")
    )).toBe(true);
  });
});
