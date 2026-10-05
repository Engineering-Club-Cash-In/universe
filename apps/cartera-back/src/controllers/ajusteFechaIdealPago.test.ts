import { describe, expect, it } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";

const previousDatabaseUrl = process.env.SUPABASE_DB_URL;
process.env.SUPABASE_DB_URL = "postgresql://127.0.0.1:1/synthetic";
const { claimAjusteFechaIdealPago } = await import("./ajusteFechaIdealPago");
if (previousDatabaseUrl === undefined) process.env.SUPABASE_DB_URL = undefined;
else process.env.SUPABASE_DB_URL = previousDatabaseUrl;

describe("claimAjusteFechaIdealPago", () => {
  it("falla si otro pago ya reclamó el ajuste", async () => {
    let setValues: Record<string, unknown> | undefined;
    let whereClause: Parameters<PgDialect["sqlToQuery"]>[0] | undefined;

    const capturingExecutor = {
      update: () => ({
        set: (values: Record<string, unknown>) => {
          setValues = values;
          return {
            where: (predicate: Parameters<PgDialect["sqlToQuery"]>[0]) => {
              whereClause = predicate;
              return { returning: async () => [] };
            },
          };
        },
      }),
    } as unknown as Parameters<typeof claimAjusteFechaIdealPago>[2];

    await expect(
      claimAjusteFechaIdealPago(7, 101, capturingExecutor)
    ).rejects.toThrow("ya fue cobrado por otro pago");

    expect(setValues?.pago_id).toBe(101);
    expect(setValues?.fecha_cobro).toBeInstanceOf(Date);
    expect(whereClause).toBeDefined();
    const query = new PgDialect().sqlToQuery(whereClause!);
    expect(query.sql).toContain('"ajuste_fecha_ideal_pago"."id" = $1');
    expect(query.sql.match(/is null/g)).toHaveLength(2);
    expect(query.params).toEqual([7]);
  });

  it("confirma el claim cuando la comparación pending gana", async () => {
    const executor = {
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [{ id: 7 }] }),
        }),
      }),
    } as unknown as Parameters<typeof claimAjusteFechaIdealPago>[2];

    await expect(
      claimAjusteFechaIdealPago(7, 101, executor)
    ).resolves.toBeUndefined();
  });
});
