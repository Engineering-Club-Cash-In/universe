import { describe, it, expect } from "bun:test";
import Big from "big.js";
import { moraPagadaPorCuota } from "./moraPagadaPorCuota";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

describe("moraPagadaPorCuota — Cargador de mora pagada por cuota", () => {
  it("caso 1: sin cuotas, devuelve Map vacío sin consultar", async () => {
    // Mock database que nunca debería ser llamado
    const mockDb = {
      select: () => {
        throw new Error("Query should not be called for empty cuotaIds");
      },
    } as any as NodePgDatabase<any>;

    const resultado = await moraPagadaPorCuota([], mockDb);
    expect(resultado.size).toBe(0);
  });

  it("caso 2: con cuotas, devuelve Map con resultados", async () => {
    // Mock database que devuelve datos
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            groupBy: async () => [
              { cuota_id: 1, total: "50.00" },
              { cuota_id: 2, total: "75.50" },
              { cuota_id: 4, total: null }, // nulls se ignoran
            ],
          }),
        }),
      }),
    } as any as NodePgDatabase<any>;

    const resultado = await moraPagadaPorCuota([1, 2, 3, 4], mockDb);
    expect(resultado.size).toBe(2);
    expect(resultado.get(1)?.toFixed(2)).toBe("50.00");
    expect(resultado.get(2)?.toFixed(2)).toBe("75.50");
    expect(resultado.get(3)).toBeUndefined(); // Sin datos
    expect(resultado.get(4)).toBeUndefined(); // total fue null
  });

  it("caso 3: cuotas sin filas", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            groupBy: async () => [],
          }),
        }),
      }),
    } as any as NodePgDatabase<any>;

    const resultado = await moraPagadaPorCuota([5, 6, 7], mockDb);
    expect(resultado.size).toBe(0);
  });
});
