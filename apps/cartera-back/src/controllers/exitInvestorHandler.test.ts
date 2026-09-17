import { beforeEach, describe, expect, it } from "bun:test";

// ============================================================================
// exitInvestorHandler envuelve exitInvestor con el cierre de la devolución.
// Se prueba con `deps` inyectado (exitInvestor y
// marcarDevolucionCompletadaSiCorresponde falsos): no hace falta pasar por
// la conexión real, ni mockear "../database" — el módulo vive fuera de
// investor.ts justamente para que este test no arrastre ese grafo de
// imports (ver el comentario en exitInvestorHandler.ts).
// ============================================================================

const { exitInvestorHandler } = await import("./exitInvestorHandler");

let marcarLlamadoCon: { creditoIds: number[]; contexto: string } | null;
let marcarDebeFallar: boolean;

function makeDeps(exitInvestorResultado: any) {
  return {
    exitInvestor: async () => exitInvestorResultado,
    marcarDevolucionCompletadaSiCorresponde: async (creditoIds: number[], contexto: string) => {
      marcarLlamadoCon = { creditoIds, contexto };
      if (marcarDebeFallar) throw new Error("fallo simulado del cierre");
      return { completados: creditoIds, diferidos: [] };
    },
  };
}

beforeEach(() => {
  marcarLlamadoCon = null;
  marcarDebeFallar = false;
});

describe("exitInvestorHandler", () => {
  it("si exitInvestor tiene éxito, cierra la devolución de los créditos procesados", async () => {
    const deps = makeDeps({
      success: true,
      inversionista: { inversionista_id: 13 },
      creditos_procesados: [{ credito_id: 78 }, { credito_id: 141 }],
    });

    const res = await exitInvestorHandler({ body: {}, set: { status: 200 } }, deps as any);

    expect(res.success).toBe(true);
    expect(marcarLlamadoCon?.creditoIds).toEqual([78, 141]);
    expect(marcarLlamadoCon?.contexto).toContain("13");
    expect(marcarLlamadoCon?.contexto).toContain("/investor/exit");
  });

  it("si exitInvestor falla, NO llama al cierre", async () => {
    const deps = makeDeps({ success: false, message: "error de validación" });

    const res = await exitInvestorHandler({ body: {}, set: { status: 400 } }, deps as any);

    expect(res.success).toBe(false);
    expect(marcarLlamadoCon).toBeNull();
  });

  it("con creditos_procesados vacío, llama al cierre con lista vacía (el helper la ignora)", async () => {
    const deps = makeDeps({
      success: true,
      inversionista: { inversionista_id: 5 },
      creditos_procesados: [],
    });

    await exitInvestorHandler({ body: {}, set: { status: 200 } }, deps as any);

    expect(marcarLlamadoCon?.creditoIds).toEqual([]);
  });

  it("si el cierre falla, la respuesta de exitInvestor se devuelve igual (no se convierte en error)", async () => {
    const deps = makeDeps({
      success: true,
      inversionista: { inversionista_id: 13 },
      creditos_procesados: [{ credito_id: 78 }],
    });
    marcarDebeFallar = true;

    const res = await exitInvestorHandler({ body: {}, set: { status: 200 } }, deps as any);

    // exitInvestor ya hizo su COMMIT: un fallo del cierre (paso secundario)
    // no debe pisar una salida que sí se completó.
    expect(res.success).toBe(true);
    expect(res.creditos_procesados).toEqual([{ credito_id: 78 }]);
  });

  it("sin resultado.inversionista, el contexto no revienta (usa '?')", async () => {
    const deps = makeDeps({
      success: true,
      creditos_procesados: [{ credito_id: 9 }],
    });

    await exitInvestorHandler({ body: {}, set: { status: 200 } }, deps as any);

    expect(marcarLlamadoCon?.contexto).toContain("?");
  });
});

// ============================================================================
// Guard de monto_aportado==0: mismo chequeo que ya hace RAMA 2 de
// liquidateByInvestorId antes de llamar a exitInvestor, para no dejar una
// CANCELACION huérfana (ver comentario largo en exitInvestorHandler.ts).
// Solo corre cuando el body trae inversionista_id + creditos (forma real del
// endpoint); con body={} (como en los tests de arriba) se salta sin romper.
// ============================================================================
describe("exitInvestorHandler — guard de monto_aportado==0 en el espejo", () => {
  function makeDepsConGuard(
    exitInvestorResultado: any,
    montoPorCredito: Record<number, number>
  ) {
    let exitInvestorLlamadoCon: any = null;
    return {
      deps: {
        exitInvestor: async (ctx: any) => {
          exitInvestorLlamadoCon = ctx.body;
          return exitInvestorResultado;
        },
        marcarDevolucionCompletadaSiCorresponde: async (creditoIds: number[], contexto: string) => {
          marcarLlamadoCon = { creditoIds, contexto };
          return { completados: creditoIds, diferidos: [] };
        },
        obtenerMontoAportadoEspejo: async (_inversionista_id: number, creditoIds: number[]) =>
          new Map(creditoIds.map((id) => [id, montoPorCredito[id]])),
      },
      getExitInvestorLlamadoCon: () => exitInvestorLlamadoCon,
    };
  }

  it("crédito con espejo en 0: pasa el guard y llega a exitInvestor", async () => {
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, inversionista: { inversionista_id: 13 }, creditos_procesados: [{ credito_id: 78 }] },
      { 78: 0 }
    );

    const res = await exitInvestorHandler(
      { body: { inversionista_id: 13, creditos: [78] }, set: { status: 200 } },
      deps as any
    );

    expect(res.success).toBe(true);
    expect(getExitInvestorLlamadoCon()).toEqual({ inversionista_id: 13, creditos: [78] });
  });

  it("crédito con espejo != 0: se omite, NO llega a exitInvestor", async () => {
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, inversionista: { inversionista_id: 13 }, creditos_procesados: [] },
      { 78: 1500 }
    );

    const res = await exitInvestorHandler(
      { body: { inversionista_id: 13, creditos: [78] }, set: { status: 200 } },
      deps as any
    );

    expect(res.success).toBe(false);
    expect(res.creditos_omitidos).toEqual([78]);
    expect(getExitInvestorLlamadoCon()).toBeNull();
  });

  it("crédito sin fila en el espejo: se omite igual que uno con saldo (undefined !== 0)", async () => {
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, creditos_procesados: [] },
      {}
    );

    const res = await exitInvestorHandler(
      { body: { inversionista_id: 13, creditos: [999] }, set: { status: 200 } },
      deps as any
    );

    expect(res.success).toBe(false);
    expect(res.creditos_omitidos).toEqual([999]);
    expect(getExitInvestorLlamadoCon()).toBeNull();
  });

  it("lote mixto: solo pasan al exitInvestor los créditos con espejo en 0, el resto se reporta omitido", async () => {
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, inversionista: { inversionista_id: 13 }, creditos_procesados: [{ credito_id: 78 }] },
      { 78: 0, 141: 500 }
    );

    const res = await exitInvestorHandler(
      { body: { inversionista_id: 13, creditos: [78, 141] }, set: { status: 200 } },
      deps as any
    );

    expect(res.success).toBe(true);
    expect(res.creditos_omitidos).toEqual([141]);
    expect(getExitInvestorLlamadoCon()).toEqual({ inversionista_id: 13, creditos: [78] });
    expect(marcarLlamadoCon?.creditoIds).toEqual([78]);
  });

  it("body sin inversionista_id/creditos (uso interno, otra forma de body): el guard se salta y exitInvestor recibe el body tal cual", async () => {
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, creditos_procesados: [] },
      {}
    );

    await exitInvestorHandler({ body: { algoDistinto: true }, set: { status: 200 } }, deps as any);

    expect(getExitInvestorLlamadoCon()).toEqual({ algoDistinto: true });
  });
});
