import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NexaDb } from "./index";
import { DbPaymentTransactionRepository } from "./repositories";
import * as schema from "./schema";

// Captures the SQL of the first UPDATE of finalizeApplication (the billing_pending branch)
// without a database: the update is built on drizzle.mock() and rendered with toSQL().
function captureBillingUpdate() {
  const mock = drizzle.mock({ schema });
  const queries: { sql: string; params: unknown[] }[] = [];
  const tx = {
    update(table: typeof schema.nexaPaymentTransactions) {
      return {
        set(values: Record<string, unknown>) {
          const built = mock.update(table).set(values as never);
          return {
            where(condition: never) {
              const filtered = built.where(condition);
              return {
                async returning(columns: never) {
                  queries.push(filtered.returning(columns).toSQL());
                  return [{ id: 1 }]; // the billing row matched: finalize returns early
                },
              };
            },
          };
        },
      };
    },
  };
  const db = { transaction: async (cb: (t: typeof tx) => Promise<void>) => cb(tx) } as unknown as NexaDb;
  return { repository: new DbPaymentTransactionRepository(db), queries };
}

describe("finalizeApplication billing_pending retry", () => {
  test("persists every payment id Cartera reports", async () => {
    const { repository, queries } = captureBillingUpdate();
    await repository.finalizeApplication(7, {
      paymentId: 10, paymentIds: [10, 11, 12], reviewStatus: "APPROVED", failureReason: "billing_pending",
    }, new Date("2026-10-06T00:00:00Z"), 3);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain(`"cartera_payment_ids" = $`);
    expect(queries[0].params).toContain("{10,11,12}");
  });

  test("keeps the stored list when Cartera sends no ids", async () => {
    const { repository, queries } = captureBillingUpdate();
    await repository.finalizeApplication(7, {
      paymentId: 10, reviewStatus: "APPROVED", failureReason: "billing_pending",
    }, new Date("2026-10-06T00:00:00Z"), 3);
    expect(queries[0].sql).toContain(`"cartera_payment_ids" = "nexa_payment_transactions"."cartera_payment_ids"`);
    expect(queries[0].params).not.toContain("{10}");
  });
});

describe("finalizeApplication new application", () => {
  test("stores [paymentId] when Cartera sends no ids", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const mock = drizzle.mock({ schema });
    const tx = {
      update(table: typeof schema.nexaPaymentTransactions) {
        return {
          set(values: Record<string, unknown>) {
            const built = mock.update(table).set(values as never);
            return {
              where(condition: never) {
                const filtered = built.where(condition);
                return {
                  async returning(columns: never) {
                    queries.push(filtered.returning(columns).toSQL());
                    // Primera UPDATE (billing) sin coincidencia; la segunda es la aplicación nueva.
                    if (queries.length === 2) throw new Error("captured");
                    return [];
                  },
                };
              },
            };
          },
        };
      },
    };
    const db = { transaction: async (cb: (t: typeof tx) => Promise<void>) => cb(tx) } as unknown as NexaDb;
    const repository = new DbPaymentTransactionRepository(db);
    await expect(repository.finalizeApplication(7, {
      paymentId: 10, reviewStatus: "APPROVED", failureReason: null,
    }, new Date("2026-10-06T00:00:00Z"), 3)).rejects.toThrow("captured");
    expect(queries).toHaveLength(2);
    expect(queries[1].params).toContain("{10}");
  });
});
