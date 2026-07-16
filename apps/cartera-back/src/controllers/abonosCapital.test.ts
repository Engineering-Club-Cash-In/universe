import { describe, expect, it, mock, beforeEach } from "bun:test";
import Big from "big.js";

// Evita que database/index.ts abra la conexión (y truene por falta de
// SUPABASE_DB_URL) al importar el controller. registrarCancelacionEspejo no usa
// el `db` del módulo: opera sobre el handle `tx` que recibe por parámetro.
mock.module("../database", () => ({ db: {} }));

// Compras pendientes por inversionista (config mutable por test). Simula el
// helper canónico que resta del monto_aportado el capital aún no real.
let pendientesPorInv: Record<number, string> = {};
mock.module("../utils/comprasAjuste", () => ({
  obtenerSumaComprasPendientes: (_credito: number, invId: number) =>
    Promise.resolve(new Big(pendientesPorInv[invId] ?? 0)),
}));

const { registrarCancelacionEspejo, revertirAbonoCapitalEspejo } = await import(
  "./abonosCapital"
);

// Mock del handle de transacción (tx) de drizzle. Simula:
//   tx.select().from().innerJoin().where()  -> filas del espejo
//   tx.delete().where()                     -> borrado idempotente (contado)
//   tx.insert().values(vals).returning()    -> eco de lo insertado
// y captura en `inserted` cada values() para poder afirmar sobre él.
function makeTx(espejoRows: any[]) {
  const inserted: any[] = [];
  const state = { deleteCalls: 0 };
  const tx: any = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(espejoRows),
        }),
      }),
    }),
    delete: () => ({
      where: () => {
        state.deleteCalls++;
        return Promise.resolve([]);
      },
    }),
    insert: () => ({
      values: (vals: any) => {
        inserted.push(vals);
        return { returning: () => Promise.resolve([vals]) };
      },
    }),
  };
  return { tx, inserted, state };
}

beforeEach(() => {
  pendientesPorInv = {};
});

describe("registrarCancelacionEspejo", () => {
  it("inserta una fila CANCELACION por inversionista con monto = su monto_aportado", async () => {
    const { tx, inserted, state } = makeTx([
      { inversionista_id: 10, monto_aportado: "1000.50", nombre: "Ana" },
      { inversionista_id: 20, monto_aportado: "250.25", nombre: "Beto" },
    ]);

    const res = await registrarCancelacionEspejo(tx, 777);

    // Idempotencia: siempre limpia las cancelaciones abiertas antes de insertar.
    expect(state.deleteCalls).toBe(1);

    expect(res.insertados).toBe(2);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toEqual({
      credito_id: 777,
      inversionista_id: 10,
      monto: "1000.5",
      tipo: "CANCELACION",
      liquidado: false,
    });
    expect(inserted[1].monto).toBe("250.25");
    expect(inserted[1].tipo).toBe("CANCELACION");
    expect(inserted[1].liquidado).toBe(false);

    expect(res.detalle).toHaveLength(2);
    expect(res.detalle[0]).toEqual({
      inversionista: "Ana",
      inversionista_id: 10,
      monto: "1000.5",
    });
  });

  it("resta las compras pendientes: registra solo el capital REAL", async () => {
    // Ana aportó 1000 pero 300 son de una compra pendiente → real 700.
    // Beto aportó 500 y todo es pendiente → real 0 → se omite.
    pendientesPorInv = { 10: "300", 20: "500" };
    const { tx, inserted } = makeTx([
      { inversionista_id: 10, monto_aportado: "1000", nombre: "Ana" },
      { inversionista_id: 20, monto_aportado: "500", nombre: "Beto" },
    ]);

    const res = await registrarCancelacionEspejo(tx, 1);

    expect(res.insertados).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].inversionista_id).toBe(10);
    expect(inserted[0].monto).toBe("700");
  });

  it("omite inversionistas con aporte en cero (nada que cancelar)", async () => {
    const { tx, inserted } = makeTx([
      { inversionista_id: 10, monto_aportado: "0", nombre: "Ana" },
      { inversionista_id: 20, monto_aportado: "500", nombre: "Beto" },
    ]);

    const res = await registrarCancelacionEspejo(tx, 1);

    expect(res.insertados).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].inversionista_id).toBe(20);
  });

  it("no inserta ni borra nada y devuelve 0 cuando el crédito no tiene espejo", async () => {
    const { tx, inserted, state } = makeTx([]);

    const res = await registrarCancelacionEspejo(tx, 1);

    expect(res).toEqual({ insertados: 0, detalle: [] });
    expect(inserted).toHaveLength(0);
    expect(state.deleteCalls).toBe(0);
  });

  it("normaliza el monto con Big (recorta ceros de la escala 8 del espejo)", async () => {
    const { tx, inserted } = makeTx([
      { inversionista_id: 10, monto_aportado: "1000.50000000", nombre: "Ana" },
    ]);

    await registrarCancelacionEspejo(tx, 1);

    expect(inserted[0].monto).toBe("1000.5");
  });
});

// Mock del executor para revertirAbonoCapitalEspejo. Simula:
//   ex.select().from().where()   -> las filas de abonos_capital de ese pago
//   ex.delete().where()          -> borrado (contado en state.deleteCalls)
function makeExecutor(filas: any[]) {
  const state = { deleteCalls: 0 };
  const ex: any = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(filas) }) }),
    delete: () => ({
      where: () => {
        state.deleteCalls++;
        return Promise.resolve([]);
      },
    }),
  };
  return { ex, state };
}

describe("revertirAbonoCapitalEspejo", () => {
  it("borra las filas que generó ese pago", async () => {
    const { ex, state } = makeExecutor([
      { abono_id: 1, inversionista_id: 10, monto: "600", tipo: "CAPITAL", liquidado: false },
      { abono_id: 2, inversionista_id: 20, monto: "400", tipo: "CAPITAL", liquidado: false },
    ]);

    const res = await revertirAbonoCapitalEspejo(555, ex);

    expect(res.success).toBe(true);
    expect(state.deleteCalls).toBe(1);
    expect(res.data!.borrados).toHaveLength(2);
    expect(res.data!.borrados[0]).toMatchObject({ abono_id: 1, inversionista_id: 10, monto: "600" });
    expect(res.data!.omitidos).toHaveLength(0);
  });

  it("no hace nada si el pago no generó ningún abono", async () => {
    // Caso normal: una cuota corriente nunca creó filas en abonos_capital.
    const { ex, state } = makeExecutor([]);

    const res = await revertirAbonoCapitalEspejo(555, ex);

    expect(res.success).toBe(true);
    expect(state.deleteCalls).toBe(0);
    expect(res.data!.borrados).toHaveLength(0);
  });

  it("no borra las filas ya liquidadas: las reporta como omitidas", async () => {
    // La plata ya le salió al inversionista: borrarla la haría desaparecer.
    const { ex, state } = makeExecutor([
      { abono_id: 1, inversionista_id: 10, monto: "600", tipo: "CAPITAL", liquidado: true },
    ]);

    const res = await revertirAbonoCapitalEspejo(555, ex);

    expect(state.deleteCalls).toBe(0);
    expect(res.data!.borrados).toHaveLength(0);
    expect(res.data!.omitidos).toHaveLength(1);
    expect(res.data!.omitidos[0]).toMatchObject({
      abono_id: 1,
      motivo: "YA_LIQUIDADO_LA_PLATA_YA_SALIO",
    });
  });

  it("borra las abiertas y conserva las liquidadas cuando vienen mezcladas", async () => {
    const { ex, state } = makeExecutor([
      { abono_id: 1, inversionista_id: 10, monto: "600", tipo: "CAPITAL", liquidado: false },
      { abono_id: 2, inversionista_id: 20, monto: "400", tipo: "CAPITAL", liquidado: true },
    ]);

    const res = await revertirAbonoCapitalEspejo(555, ex);

    expect(state.deleteCalls).toBe(1);
    expect(res.data!.borrados).toHaveLength(1);
    expect(res.data!.borrados[0].abono_id).toBe(1);
    expect(res.data!.omitidos).toHaveLength(1);
    expect(res.data!.omitidos[0].abono_id).toBe(2);
  });
});
