import { beforeEach, describe, expect, it } from "bun:test";

// ============================================================================
// Vista HISTORIAL de listPendingDevolucion: todos los estados de devolución
// (no solo la bandeja de pendientes), con el motivo por el que un crédito
// VERIFICADO todavía no cierra.
//
// Se mockean AMBAS rutas de la base ("../database" y "../database/index"):
// resuelven al mismo módulo y devolucion.ts importa por la corta mientras
// devolucionCompletada.ts (de donde sale filtrarCreditosTotalmenteDevueltos)
// importa por la larga. Un mock de una sola ruta deja rota la otra para
// cualquier test que corra después en la misma suite (ver el caso ya resuelto
// en devolucionCompletado.test.ts).
// ============================================================================

let creditosRows: any[] = [];
let totalRow: { count: number } = { count: 0 };
let padreRestantes: Array<{ credito_id: number; inversionista_id: number; nombre: string }> = [];
let espejoResidual: Array<{ credito_id: number; inversionista_id: number; monto_aportado: string; nombre: string }> = [];
// Cuenta las llamadas a innerJoin().where() DENTRO de una sola invocación de
// filtrarCreditosTotalmenteDevueltos (padre=1ra, espejo=2da). Vive fuera de
// dbMock() porque fabricaDb()/dbMock() corren una sola vez al registrar el
// mock.module, no por test — un contador local ahí quedaría pegado tras el
// primer test.
let joinCallCount = 0;

// db.select(...).from(creditos).leftJoin(...).where(...) tiene DOS formas:
//   - con .orderBy().limit().offset()  -> la query paginada de créditos
//   - sola, resuelta directo           -> el count(*)
// Se distinguen por si el caller encadena algo más antes de esperar la promesa.
function dbMock() {
  return {
    select: () => ({
      from: () => ({
        leftJoin: () => {
          const base: any = Promise.resolve([totalRow]);
          base.where = (..._args: any[]) => {
            const conPaginacion: any = Promise.resolve(creditosRows);
            conPaginacion.orderBy = () => ({
              limit: () => ({
                offset: () => Promise.resolve(creditosRows),
              }),
            });
            return conPaginacion;
          };
          return base;
        },
        // Usado por filtrarCreditosTotalmenteDevueltos vía el ejecutor `db`
        // (no una tx): lock plano, o join+where para las filas crudas
        // (padre/espejo, en ese orden) que la función filtra en JS con esCube.
        where: (..._args: any[]) => {
          const r: any = Promise.resolve([]);
          r.orderBy = () => ({ for: () => Promise.resolve([]) });
          return r;
        },
        innerJoin: () => ({
          where: () => {
            joinCallCount++;
            return Promise.resolve(joinCallCount === 1 ? padreRestantes : espejoResidual);
          },
        }),
      }),
    }),
    transaction: async (cb: any) => cb(dbMock()),
  } as any;
}

const fabricaDb = () => ({ client: {}, lockPool: { connect: () => Promise.resolve({ query: () => Promise.resolve(), release: () => {} }) }, db: dbMock() });
import { mock } from "bun:test";
mock.module("../database", fabricaDb);
mock.module("../database/index", fabricaDb);

const { listPendingDevolucion } = await import("./devolucion");

function makeCtx(query: Record<string, string>) {
  const set: any = { status: 200 };
  return { query, set };
}

beforeEach(() => {
  creditosRows = [];
  totalRow = { count: 0 };
  padreRestantes = [];
  espejoResidual = [];
  joinCallCount = 0;
});

describe("listPendingDevolucion — status=HISTORIAL", () => {
  it("no filtra por un solo estado: excluye NO_APLICA vía SQL, no por JS", async () => {
    creditosRows = [
      { credito_id: 1, numero_credito_sifco: "S1", usuario_nombre: "A", capital: "100", cuota: "10", fecha_creacion: new Date(), estado_devolucion: "PENDIENTE_AUTORIZACION", motivo_contextual: null },
      { credito_id: 2, numero_credito_sifco: "S2", usuario_nombre: "B", capital: "100", cuota: "10", fecha_creacion: new Date(), estado_devolucion: "VERIFICADO", motivo_contextual: null },
      { credito_id: 3, numero_credito_sifco: "S3", usuario_nombre: "C", capital: "100", cuota: "10", fecha_creacion: new Date(), estado_devolucion: "COMPLETADO", motivo_contextual: null },
      { credito_id: 4, numero_credito_sifco: "S4", usuario_nombre: "D", capital: "100", cuota: "10", fecha_creacion: new Date(), estado_devolucion: "RECHAZADO", motivo_contextual: null },
    ];
    totalRow = { count: 4 };

    const res: any = await listPendingDevolucion(makeCtx({ status: "HISTORIAL" }));

    expect(res.success).toBe(true);
    expect(res.data.credits).toHaveLength(4);
    expect(res.data.status).toBe("HISTORIAL");
  });

  it("marca pendiente_cierre=null para créditos que no están en VERIFICADO", async () => {
    creditosRows = [
      { credito_id: 1, numero_credito_sifco: "S1", usuario_nombre: "A", capital: "100", cuota: "10", fecha_creacion: new Date(), estado_devolucion: "COMPLETADO", motivo_contextual: null },
    ];
    totalRow = { count: 1 };

    const res: any = await listPendingDevolucion(makeCtx({ status: "HISTORIAL" }));

    expect(res.data.credits[0].pendiente_cierre).toBeNull();
  });

  it("VERIFICADO con inversionistas restantes en el padre: pendiente_cierre los reporta", async () => {
    creditosRows = [
      { credito_id: 78, numero_credito_sifco: "S78", usuario_nombre: "Cliente", capital: "100", cuota: "10", fecha_creacion: new Date(), estado_devolucion: "VERIFICADO", motivo_contextual: null },
    ];
    totalRow = { count: 1 };
    padreRestantes = [{ credito_id: 78, inversionista_id: 42, nombre: "Inv 42" }];

    const res: any = await listPendingDevolucion(makeCtx({ status: "HISTORIAL" }));

    expect(res.data.credits[0].pendiente_cierre).toEqual({
      motivo: "inversionistas_en_padre",
      restantes: 1,
    });
  });

  it("VERIFICADO con padre limpio y espejo residual con saldo: pendiente_cierre lo distingue", async () => {
    creditosRows = [
      { credito_id: 500, numero_credito_sifco: "S500", usuario_nombre: "Cliente", capital: "100", cuota: "10", fecha_creacion: new Date(), estado_devolucion: "VERIFICADO", motivo_contextual: null },
    ];
    totalRow = { count: 1 };
    padreRestantes = [];
    espejoResidual = [{ credito_id: 500, inversionista_id: 42, monto_aportado: "1500.00", nombre: "Inv 42" }];

    const res: any = await listPendingDevolucion(makeCtx({ status: "HISTORIAL" }));

    expect(res.data.credits[0].pendiente_cierre).toEqual({ motivo: "saldo_en_espejo" });
  });

  it("VERIFICADO totalmente limpio: pendiente_cierre es null (el barrido debería haberlo cerrado)", async () => {
    creditosRows = [
      { credito_id: 999, numero_credito_sifco: "S999", usuario_nombre: "Cliente", capital: "100", cuota: "10", fecha_creacion: new Date(), estado_devolucion: "VERIFICADO", motivo_contextual: null },
    ];
    totalRow = { count: 1 };
    padreRestantes = [];
    espejoResidual = [];

    const res: any = await listPendingDevolucion(makeCtx({ status: "HISTORIAL" }));

    expect(res.data.credits[0].pendiente_cierre).toBeNull();
  });

  it("sin créditos VERIFICADO en la página: no llama al helper de padre/espejo", async () => {
    creditosRows = [
      { credito_id: 1, numero_credito_sifco: "S1", usuario_nombre: "A", capital: "100", cuota: "10", fecha_creacion: new Date(), estado_devolucion: "RECHAZADO", motivo_contextual: null },
    ];
    totalRow = { count: 1 };

    const res: any = await listPendingDevolucion(makeCtx({ status: "HISTORIAL" }));

    expect(res.data.credits[0].pendiente_cierre).toBeNull();
  });

  it("status distinto de HISTORIAL (ej. BANDEJA_DEVOLUCION): pendiente_cierre siempre null, sin consultar padre/espejo", async () => {
    // El campo se agrega siempre (así el frontend no distingue undefined de
    // null), pero fuera de HISTORIAL nunca se calcula el diferido real: sale
    // null aunque el crédito esté VERIFICADO. Es la bandeja de aceptar/
    // rechazar, no la vista de seguimiento.
    creditosRows = [
      { credito_id: 1, numero_credito_sifco: "S1", usuario_nombre: "A", capital: "100", cuota: "10", fecha_creacion: new Date(), estado_devolucion: "PENDIENTE_AUTORIZACION", motivo_contextual: null },
    ];
    totalRow = { count: 1 };

    const res: any = await listPendingDevolucion(makeCtx({}));

    expect(res.data.credits[0].pendiente_cierre).toBeNull();
  });
});
