import { describe, expect, it, mock } from "bun:test";

/**
 * COBROS-02 Fase 4 — el levantamiento del estado. Lo que cuidan estas pruebas
 * es lo que NO debe levantarlo: la decisión 5 dice "paga el total de lo que
 * debe" y la 18 aclara que el total incluye la mora. Un levantamiento de más
 * regala una recuperación ya decidida.
 */

let cuotasVencidas = 0;

mock.module("../latefee", () => ({
  contarCuotasVencidasReales: async () => cuotasVencidas,
  STATUS_EN_RECUPERACION: "EN_RECUPERACION",
}));

const { levantarRecuperacionSiPagoTodo } = await import("./levantarRecuperacion");

/** Ejecutor falso: responde el crédito, luego la mora, y anota los UPDATE. */
function ejecutorFalso(opciones: {
  status: string;
  moraMonto?: string | null;
}) {
  const updates: Record<string, unknown>[] = [];
  let selects = 0;
  return {
    updates,
    ejecutor: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              selects += 1;
              if (selects === 1) return [{ statusCredit: opciones.status }];
              return opciones.moraMonto == null
                ? []
                : [{ monto: opciones.moraMonto }];
            },
          }),
        }),
      }),
      update: () => ({
        set: (valores: Record<string, unknown>) => ({
          where: async () => {
            updates.push(valores);
          },
        }),
      }),
      execute: async () => ({ rows: [] }),
    },
  };
}

describe("levantarRecuperacionSiPagoTodo", () => {
  it("no hace nada si el crédito no está en recuperación", async () => {
    cuotasVencidas = 0;
    const { ejecutor, updates } = ejecutorFalso({ status: "MOROSO" });
    const r = await levantarRecuperacionSiPagoTodo(1, ejecutor as never);
    expect(r).toEqual({ levantado: false, motivo: "no_estaba_en_recuperacion" });
    expect(updates).toHaveLength(0);
  });

  it("NO levanta si todavía debe cuotas vencidas", async () => {
    cuotasVencidas = 1;
    const { ejecutor, updates } = ejecutorFalso({ status: "EN_RECUPERACION" });
    const r = await levantarRecuperacionSiPagoTodo(1, ejecutor as never);
    expect(r).toEqual({ levantado: false, motivo: "debe_cuotas" });
    expect(updates).toHaveLength(0);
  });

  it("NO levanta si pagó las cuotas pero le queda mora (decisión 18)", async () => {
    cuotasVencidas = 0;
    const { ejecutor, updates } = ejecutorFalso({
      status: "EN_RECUPERACION",
      moraMonto: "350.00",
    });
    const r = await levantarRecuperacionSiPagoTodo(1, ejecutor as never);
    expect(r).toEqual({ levantado: false, motivo: "debe_mora" });
    expect(updates).toHaveLength(0);
  });

  it("levanta cuando no debe NADA: ni cuotas ni mora", async () => {
    cuotasVencidas = 0;
    const { ejecutor, updates } = ejecutorFalso({
      status: "EN_RECUPERACION",
      moraMonto: "0",
    });
    const r = await levantarRecuperacionSiPagoTodo(1, ejecutor as never);
    expect(r).toEqual({ levantado: true });
    expect(updates).toEqual([{ statusCredit: "ACTIVO" }]);
  });

  it("una mora inactiva (sin fila) no bloquea el levantamiento", async () => {
    cuotasVencidas = 0;
    const { ejecutor, updates } = ejecutorFalso({
      status: "EN_RECUPERACION",
      moraMonto: null,
    });
    const r = await levantarRecuperacionSiPagoTodo(1, ejecutor as never);
    expect(r).toEqual({ levantado: true });
    expect(updates).toHaveLength(1);
  });
});
