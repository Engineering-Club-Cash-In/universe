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

const { levantarRecuperacionSiPagoTodo, restaurarRecuperacionSiEstePagoLaLevanto } =
  await import("./levantarRecuperacion");

/** Ejecutor falso: responde el crédito, luego la mora, y anota los UPDATE. */
function ejecutorFalso(opciones: {
  status: string;
  moraMonto?: string | null;
  levantadaPor?: number | null;
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
              if (selects === 1) {
                return [
                  {
                    statusCredit: opciones.status,
                    levantadaPor: opciones.levantadaPor ?? null,
                  },
                ];
              }
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
    const r = await levantarRecuperacionSiPagoTodo(1, ejecutor as never, 777);
    expect(r).toEqual({ levantado: true });
    // Guarda QUÉ pago lo levantó: es lo único que hace reversible la decisión.
    expect(updates).toEqual([
      { statusCredit: "ACTIVO", recuperacion_levantada_pago_id: 777 },
    ]);
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

/**
 * La vuelta atrás. Sin esto, reversar el pago que levantó la recuperación
 * dejaba el crédito ACTIVO para siempre: el motor a lo sumo lo pone MOROSO y la
 * decisión humana —con su piso en B4— se perdía en silencio.
 */
describe("restaurarRecuperacionSiEstePagoLaLevanto", () => {
  it("devuelve el estado cuando se reversa EL pago que lo levantó", async () => {
    const { ejecutor, updates } = ejecutorFalso({
      status: "ACTIVO",
      levantadaPor: 777,
    });
    const r = await restaurarRecuperacionSiEstePagoLaLevanto(
      1,
      777,
      ejecutor as never,
    );
    expect(r).toBe(true);
    expect(updates).toEqual([
      {
        statusCredit: "EN_RECUPERACION",
        recuperacion_levantada_pago_id: null,
      },
    ]);
  });

  it("reversar OTRO pago no resucita una recuperación ajena", async () => {
    const { ejecutor, updates } = ejecutorFalso({
      status: "ACTIVO",
      levantadaPor: 777,
    });
    const r = await restaurarRecuperacionSiEstePagoLaLevanto(
      1,
      999,
      ejecutor as never,
    );
    expect(r).toBe(false);
    expect(updates).toHaveLength(0);
  });

  // Review de Codex, P1: comparar contra "el estado que acabo de leer" hacía que
  // un régimen POSTERIOR y más específico —convenio, incobrable— se pisara con
  // una decisión anterior.
  it("NO pisa un régimen más nuevo: un convenio le gana a la recuperación", async () => {
    const { ejecutor, updates } = ejecutorFalso({
      status: "EN_CONVENIO",
      levantadaPor: 777,
    });
    const r = await restaurarRecuperacionSiEstePagoLaLevanto(
      1,
      777,
      ejecutor as never,
    );
    expect(r).toBe(false);
    // La marca se limpia igual: ese pago ya no puede restaurar nada.
    expect(updates).toEqual([{ recuperacion_levantada_pago_id: null }]);
  });

  it("tampoco pisa un INCOBRABLE (es un castigo contable posterior)", async () => {
    const { ejecutor, updates } = ejecutorFalso({
      status: "INCOBRABLE",
      levantadaPor: 777,
    });
    const r = await restaurarRecuperacionSiEstePagoLaLevanto(
      1,
      777,
      ejecutor as never,
    );
    expect(r).toBe(false);
    expect(updates).toEqual([{ recuperacion_levantada_pago_id: null }]);
  });

  it("sí restaura sobre MOROSO: es donde lo dejó el motor tras el levantamiento", async () => {
    const { ejecutor, updates } = ejecutorFalso({
      status: "MOROSO",
      levantadaPor: 777,
    });
    const r = await restaurarRecuperacionSiEstePagoLaLevanto(
      1,
      777,
      ejecutor as never,
    );
    expect(r).toBe(true);
    expect(updates).toEqual([
      {
        statusCredit: "EN_RECUPERACION",
        recuperacion_levantada_pago_id: null,
      },
    ]);
  });

  it("un crédito que nunca estuvo en recuperación no se toca", async () => {
    const { ejecutor, updates } = ejecutorFalso({
      status: "MOROSO",
      levantadaPor: null,
    });
    const r = await restaurarRecuperacionSiEstePagoLaLevanto(
      1,
      777,
      ejecutor as never,
    );
    expect(r).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
