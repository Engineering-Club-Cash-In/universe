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
    // body.inversionista_id/creditos vienen vacíos en la mayoría de estos
    // tests (prueban solo el wrapper de cierre), pero cuando no lo están
    // el guard igual consulta esto — sin stub cae al real y pega contra la DB.
    obtenerEstadosDevolucion: async (creditoIds: number[]) => new Map(creditoIds.map((id) => [id, null])),
  };
}

beforeEach(() => {
  marcarLlamadoCon = null;
  marcarDebeFallar = false;
});

describe("exitInvestorHandler — lock de créditos y revalidación (P1: race con pagos)", () => {
  it("pasa revalidarGuard a exitInvestor para serializarse bajo el lock FOR NO KEY UPDATE", async () => {
    marcarDebeFallar = false;
    let revalidarGuardRecibido: any = null;
    const deps = {
      ...makeDeps({
        success: true,
        inversionista: { inversionista_id: 13 },
        creditos_procesados: [{ credito_id: 78 }, { credito_id: 141 }],
      }),
      exitInvestor: async (_ctx: any, opts: any) => {
        revalidarGuardRecibido = opts?.revalidarGuard;
        return {
          success: true,
          inversionista: { inversionista_id: 13 },
          creditos_procesados: [{ credito_id: 78 }, { credito_id: 141 }],
        };
      },
    };

    const res = await exitInvestorHandler(
      { body: { inversionista_id: 13, creditos: [141, 78] }, set: { status: 200 } },
      deps as any
    );

    expect(res.success).toBe(true);
    expect(typeof revalidarGuardRecibido).toBe("function");
  });

  it("revalidarGuard bajo la transacción detecta abonos/pagos creados concurrentemente y aborta", async () => {
    let ejecutorUsadoEnRevalidacion: any = null;
    const fakeTx = { id: "fake-tx", select: () => {} };

    const deps = {
      ...makeDeps({ success: true }),
      exitInvestor: async (_ctx: any, opts: any) => {
        // Simula que exitInvestor corre revalidarGuard dentro de su transacción con tx
        const guardRes = await opts.revalidarGuard(fakeTx);
        if (!guardRes.ok) {
          return {
            success: false,
            message: guardRes.message,
            creditos_invalidos: guardRes.creditos_invalidos,
          };
        }
        return { success: true, creditos_procesados: [{ credito_id: 78 }] };
      },
      obtenerEstadosDevolucion: async (ids: number[], ejecutor?: any) => {
        ejecutorUsadoEnRevalidacion = ejecutor;
        return new Map(ids.map((id) => [id, "VERIFICADO"]));
      },
      obtenerMontoAportadoEspejo: async () => new Map([[78, 0]]),
      tienePendientesLiquidacion: async (_inv: number, _ids: number[], ejecutor?: any) => {
        // Durante el pre-check (sin fakeTx) no había pendientes, pero bajo fakeTx (concurrencia) sí hay
        if (ejecutor === fakeTx) {
          return new Set([78]);
        }
        return new Set();
      },
    };

    const res = await exitInvestorHandler(
      { body: { inversionista_id: 13, creditos: [78] }, set: { status: 200 } },
      deps as any
    );

    expect(res.success).toBe(false);
    expect(res.creditos_invalidos).toEqual([78]);
    expect(ejecutorUsadoEnRevalidacion).toBe(fakeTx);
  });

  it("GuardRechazadoError encapsula el mensaje y la lista de créditos inválidos", async () => {
    const { GuardRechazadoError } = await import("./investor");
    const error = new GuardRechazadoError("devolucion pendiente", [78, 99]);
    expect(error.name).toBe("GuardRechazadoError");
    expect(error.message).toBe("devolucion pendiente");
    expect(error.creditosInvalidos).toEqual([78, 99]);
  });
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
// Guard de monto_aportado==0, activado SOLO con body.motivo ===
// "devolucion_verificado". El endpoint es genérico (salida total de un
// inversionista, transfiere saldo != 0 a CUBE a propósito); sin el flag debe
// comportarse exactamente igual que antes de este guard, aunque venga
// inversionista_id + creditos (ver revert 3d433df5e y el hilo de Codex sobre
// por qué el guard incondicional rompía la salida total).
// ============================================================================
describe("exitInvestorHandler — guard de monto_aportado==0 (motivo=devolucion_verificado)", () => {
  function makeDepsConGuard(
    exitInvestorResultado: any,
    montoPorCredito: Record<number, number | undefined>,
    creditosConPendientes: number[] = [],
    estadosDevolucion: Record<number, string | null> = {}
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
        obtenerMontoAportadoEspejo: async (_inversionista_id: number, creditoIds: number[]) => {
          const map = new Map<number, number>();
          for (const id of creditoIds) {
            if (montoPorCredito[id] !== undefined) {
              map.set(id, montoPorCredito[id]!);
            }
          }
          return map;
        },
        tienePendientesLiquidacion: async (_inversionista_id: number, _creditoIds: number[]) =>
          new Set(creditosConPendientes),
        obtenerEstadosDevolucion: async (creditoIds: number[]) =>
          new Map(creditoIds.map((id) => [id, estadosDevolucion[id] ?? null])),
      },
      getExitInvestorLlamadoCon: () => exitInvestorLlamadoCon,
    };
  }

  it("SIN motivo y sin crédito VERIFICADO: saldo != 0 pasa igual a exitInvestor (comportamiento default, salida total)", async () => {
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, inversionista: { inversionista_id: 13 }, creditos_procesados: [{ credito_id: 78 }] },
      { 78: 1500 },
      [],
      { 78: "NO_APLICA" }
    );

    const res = await exitInvestorHandler(
      { body: { inversionista_id: 13, creditos: [78] }, set: { status: 200 } },
      deps as any
    );

    expect(res.success).toBe(true);
    expect(res.creditos_invalidos).toBeUndefined();
    expect(getExitInvestorLlamadoCon()).toEqual({ inversionista_id: 13, creditos: [78] });
  });

  it("SIN motivo pero con crédito en VERIFICADO: activa el guard automáticamente y rechaza con 400 si saldo != 0", async () => {
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, creditos_procesados: [] },
      { 78: 1500 },
      [],
      { 78: "VERIFICADO" }
    );

    const ctx = { body: { inversionista_id: 13, creditos: [78] }, set: { status: 200 } };
    const res = await exitInvestorHandler(ctx, deps as any);

    expect(res.success).toBe(false);
    expect(res.creditos_invalidos).toEqual([78]);
    expect(getExitInvestorLlamadoCon()).toBeNull();
    expect(ctx.set.status).toBe(400);
  });

  it("SIN motivo pero con crédito en VERIFICADO y saldo en 0: pasa el guard automático y llega a exitInvestor", async () => {
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, inversionista: { inversionista_id: 13 }, creditos_procesados: [{ credito_id: 78 }] },
      { 78: 0 },
      [],
      { 78: "VERIFICADO" }
    );

    const ctx = { body: { inversionista_id: 13, creditos: [78] }, set: { status: 200 } };
    const res = await exitInvestorHandler(ctx, deps as any);

    expect(res.success).toBe(true);
    expect(res.creditos_invalidos).toBeUndefined();
    expect(ctx.set.status).toBe(200);
    expect(getExitInvestorLlamadoCon()).toEqual({ inversionista_id: 13, creditos: [78] });
  });

  it("con motivo=devolucion_verificado y espejo en 0: pasa el guard y llega a exitInvestor", async () => {
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, inversionista: { inversionista_id: 13 }, creditos_procesados: [{ credito_id: 78 }] },
      { 78: 0 }
    );

    const ctx = { body: { inversionista_id: 13, creditos: [78], motivo: "devolucion_verificado" }, set: { status: 200 } };
    const res = await exitInvestorHandler(ctx, deps as any);

    expect(res.success).toBe(true);
    expect(res.creditos_invalidos).toBeUndefined();
    expect(ctx.set.status).toBe(200);
    expect(getExitInvestorLlamadoCon()).toEqual({
      inversionista_id: 13,
      creditos: [78],
      motivo: "devolucion_verificado",
    });
  });

  it("con motivo=devolucion_verificado y espejo != 0: rechaza el lote entero con status 400, NO llega a exitInvestor", async () => {
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, inversionista: { inversionista_id: 13 }, creditos_procesados: [] },
      { 78: 1500 }
    );

    const ctx = { body: { inversionista_id: 13, creditos: [78], motivo: "devolucion_verificado" }, set: { status: 200 } };
    const res = await exitInvestorHandler(ctx, deps as any);

    expect(res.success).toBe(false);
    expect(res.creditos_invalidos).toEqual([78]);
    expect(getExitInvestorLlamadoCon()).toBeNull();
    expect(ctx.set.status).toBe(400);
  });

  it("crédito en VERIFICADO sin fila en el espejo (P1 guard): se rechaza con 400 para revisión manual (no asume saldo en 0)", async () => {
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, creditos_procesados: [] },
      {}, // sin fila espejo (saldo === undefined)
      [],
      { 999: "VERIFICADO" }
    );

    const ctx = { body: { inversionista_id: 13, creditos: [999] }, set: { status: 200 } };
    const res = await exitInvestorHandler(ctx, deps as any);

    expect(res.success).toBe(false);
    expect(res.creditos_invalidos).toEqual([999]);
    expect(getExitInvestorLlamadoCon()).toBeNull();
    expect(ctx.set.status).toBe(400);
  });

  it("SIN motivo, lote mixto con VERIFICADO en 0 y crédito ordinario con saldo (P2 guard): pasa exitInvestor porque solo el VERIFICADO exige saldo 0", async () => {
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, inversionista: { inversionista_id: 13 }, creditos_procesados: [{ credito_id: 78 }, { credito_id: 200 }] },
      { 78: 0, 200: 10000 }, // 78 en 0 (devolución), 200 con saldo (crédito ordinario para CUBE)
      [],
      { 78: "VERIFICADO", 200: "NO_APLICA" }
    );

    const ctx = { body: { inversionista_id: 13, creditos: [78, 200] }, set: { status: 200 } };
    const res = await exitInvestorHandler(ctx, deps as any);

    expect(res.success).toBe(true);
    expect(res.creditos_invalidos).toBeUndefined();
    expect(ctx.set.status).toBe(200);
    expect(getExitInvestorLlamadoCon()).toEqual({ inversionista_id: 13, creditos: [78, 200] });
  });

  it("SIN motivo, lote mixto con VERIFICADO inválido (saldo != 0): rechaza el lote completo (todo o nada)", async () => {
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, creditos_procesados: [] },
      { 78: 1500, 200: 10000 }, // 78 en devolución pero con saldo pendiente
      [],
      { 78: "VERIFICADO", 200: "NO_APLICA" }
    );

    const ctx = { body: { inversionista_id: 13, creditos: [78, 200] }, set: { status: 200 } };
    const res = await exitInvestorHandler(ctx, deps as any);

    expect(res.success).toBe(false);
    expect(res.creditos_invalidos).toEqual([78]);
    expect(getExitInvestorLlamadoCon()).toBeNull();
    expect(ctx.set.status).toBe(400);
  });

  it("con motivo=devolucion_verificado, lote mixto: se rechaza TODO (no se filtra un subconjunto)", async () => {
    // Antes filtraba y pasaba solo el subconjunto en 0 a exitInvestor, pero
    // exitInvestor marca inactivo con que UN crédito se procese — el lote
    // mixto dejaba al inversionista inactivo con la posición omitida
    // (capital pendiente) todavía a su nombre. Ahora es todo o nada.
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, inversionista: { inversionista_id: 13 }, creditos_procesados: [{ credito_id: 78 }] },
      { 78: 0, 141: 500 }
    );

    const ctx = { body: { inversionista_id: 13, creditos: [78, 141], motivo: "devolucion_verificado" }, set: { status: 200 } };
    const res = await exitInvestorHandler(ctx, deps as any);

    expect(res.success).toBe(false);
    expect(res.creditos_invalidos).toEqual([141]);
    expect(getExitInvestorLlamadoCon()).toBeNull();
    expect(ctx.set.status).toBe(400);
    expect(marcarLlamadoCon).toBeNull();
  });

  it("con motivo=devolucion_verificado y abonos/pagos pendientes de liquidar: rechaza el lote entero con 400 aunque el saldo esté en 0", async () => {
    // Al calcular pagos, el saldo en el espejo ya baja a 0 antes de la liquidación,
    // pero el dinero todavía no se liquida. Salir en esa ventana rompería la liquidación.
    const { deps, getExitInvestorLlamadoCon } = makeDepsConGuard(
      { success: true, inversionista: { inversionista_id: 13 }, creditos_procesados: [] },
      { 78: 0 },
      [78] // credito 78 tiene abonos_capital o pagos espejo pendientes de liquidar
    );

    const ctx = { body: { inversionista_id: 13, creditos: [78], motivo: "devolucion_verificado" }, set: { status: 200 } };
    const res = await exitInvestorHandler(ctx, deps as any);

    expect(res.success).toBe(false);
    expect(res.creditos_invalidos).toEqual([78]);
    expect(getExitInvestorLlamadoCon()).toBeNull();
    expect(ctx.set.status).toBe(400);
    expect(marcarLlamadoCon).toBeNull();
  });
});
