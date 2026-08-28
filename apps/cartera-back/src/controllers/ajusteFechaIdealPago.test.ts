import { describe, expect, it } from "bun:test";

const previousDatabaseUrl = process.env.SUPABASE_DB_URL;
process.env.SUPABASE_DB_URL = "postgresql://127.0.0.1:1/synthetic";
const { claimAjusteFechaIdealPago } = await import("./ajusteFechaIdealPago");
if (previousDatabaseUrl === undefined) process.env.SUPABASE_DB_URL = undefined;
else process.env.SUPABASE_DB_URL = previousDatabaseUrl;

describe("claimAjusteFechaIdealPago", () => {
  it("falla si otro pago ya reclamó el ajuste", async () => {
    const executor = {
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [] }),
        }),
      }),
    } as unknown as Parameters<typeof claimAjusteFechaIdealPago>[2];

    await expect(
      claimAjusteFechaIdealPago(7, 101, executor)
    ).rejects.toThrow("ya fue cobrado por otro pago");
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
