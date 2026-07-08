import { describe, expect, it, mock, beforeEach } from "bun:test";
import Big from "big.js";

// registrarCancelacionEspejo (invocado dentro de aceptarDevolucion) resta las
// compras pendientes; aquí no hay ninguna, así que devolvemos 0.
mock.module("../utils/comprasAjuste", () => ({
  obtenerSumaComprasPendientes: () => Promise.resolve(new Big(0)),
}));

// ---------------------------------------------------------------------------
// Estado mutable que leen los mocks; cada test lo configura antes de llamar.
// ---------------------------------------------------------------------------
let currentCreditRows: any[] = [];
let txUpdatedRows: any[] = [];
let txEspejoRows: any[] = [];
let lastInserted: any[] = [];

// Mock del handle de transacción usado dentro de db.transaction(cb).
// Cubre las cadenas que ejecuta aceptarDevolucion + registrarCancelacionEspejo:
//   tx.update().set().where().returning()   -> filas afectadas (0 = carrera perdida)
//   tx.insert().values(vals)[.returning()]  -> capturado en lastInserted
//   tx.select().from().innerJoin().where()  -> inversionistas del espejo
function makeTx() {
  const inserted: any[] = [];
  lastInserted = inserted;
  const tx: any = {
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve(txUpdatedRows) }),
      }),
    }),
    insert: () => ({
      values: (vals: any) => {
        inserted.push(vals);
        const p: any = Promise.resolve([vals]);
        p.returning = () => Promise.resolve([vals]);
        return p;
      },
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => Promise.resolve(txEspejoRows) }),
      }),
    }),
  };
  return tx;
}

// Import DESPUÉS de mock.module para que use el db mockeado.
mock.module("../database", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(currentCreditRows) }),
    }),
    transaction: async (cb: any) => cb(makeTx()),
  },
}));

const { aceptarDevolucion } = await import("./devolucion");

function makeCtx(id: string) {
  const set: any = { status: 200 };
  return { params: { id }, set };
}

beforeEach(() => {
  currentCreditRows = [{ estado_devolucion: "PENDIENTE_AUTORIZACION" }];
  txUpdatedRows = [{ credito_id: 5 }];
  txEspejoRows = [{ inversionista_id: 10, monto_aportado: "1000", nombre: "Ana" }];
  lastInserted = [];
});

describe("aceptarDevolucion", () => {
  it("rechaza (400) un id de crédito inválido sin tocar la base", async () => {
    const ctx = makeCtx("abc");
    const res: any = await aceptarDevolucion(ctx);
    expect(ctx.set.status).toBe(400);
    expect(res.message).toMatch(/inválido/i);
  });

  it("devuelve 404 cuando el crédito no existe", async () => {
    currentCreditRows = [];
    const ctx = makeCtx("5");
    const res: any = await aceptarDevolucion(ctx);
    expect(ctx.set.status).toBe(404);
  });

  it("devuelve 400 si el crédito no está en PENDIENTE_AUTORIZACION", async () => {
    currentCreditRows = [{ estado_devolucion: "VERIFICADO" }];
    const ctx = makeCtx("5");
    const res: any = await aceptarDevolucion(ctx);
    expect(ctx.set.status).toBe(400);
    expect(res.message).toMatch(/pendiente/i);
  });

  it("acepta: registra el log VERIFICADO y una fila CANCELACION por inversionista", async () => {
    const ctx = makeCtx("5");
    const res: any = await aceptarDevolucion(ctx);

    expect(res.success).toBe(true);
    expect(res.abonos_cancelacion.insertados).toBe(1);

    const log = lastInserted.find((v) => v.estado_nuevo === "VERIFICADO");
    expect(log).toBeDefined();
    expect(log.estado_anterior).toBe("PENDIENTE_AUTORIZACION");

    const abono = lastInserted.find((v) => v.tipo === "CANCELACION");
    expect(abono).toBeDefined();
    expect(abono.monto).toBe("1000");
    expect(abono.liquidado).toBe(false);
  });

  it("carrera de doble-aceptación: si el UPDATE atómico afecta 0 filas, aborta (500) y NO registra abonos", async () => {
    // El guard previo (SELECT) ve PENDIENTE_AUTORIZACION, pero para cuando corre
    // el UPDATE condicionado otra transacción ya lo movió → 0 filas afectadas.
    txUpdatedRows = [];
    const ctx = makeCtx("5");
    const res: any = await aceptarDevolucion(ctx);

    expect(res.success).toBe(false);
    expect(ctx.set.status).toBe(500);
    // Nada se insertó: el throw ocurre antes del log y de los abonos.
    expect(lastInserted.find((v) => v.tipo === "CANCELACION")).toBeUndefined();
    expect(lastInserted).toHaveLength(0);
  });
});
