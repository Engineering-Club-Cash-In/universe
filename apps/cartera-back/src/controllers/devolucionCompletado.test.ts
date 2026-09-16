import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";


// ============================================================================
// COMPLETADO solo cuando todos los inversionistas fueron devueltos.
//
// Un crédito puede tener varios inversionistas y cada uno se liquida por su
// cuenta. Cerrar la devolución con el primero sacaba al crédito del flujo para
// los demás: el filtro de la RAMA 2 pide VERIFICADO, así que los que venían
// atrás nunca llegaban a exitInvestor y su fila en el padre quedaba viva con
// monto mientras su espejo ya estaba en cero.
// ============================================================================

// ── Estado mutable que leen los mocks; cada test lo configura antes de llamar ──
let padreRestantes: Array<{ credito_id: number; restantes: number }> = [];
let espejoResidual: Array<{
  credito_id: number;
  inversionista_id: number;
  monto_aportado: string;
}> = [];
let updateReturning: Array<{ credito_id: number }> = [];
let historialInsertado: any[] = [];

let updateWasCalled = false;
let lastUpdateData: Record<string, unknown> | undefined;
let lastUpdateWhere: unknown;
let lockedWithFor: string | undefined;
let lockedSql: string | undefined;
let selectCallCount = 0;

const dialect = new PgDialect();
const sqlDe = (condicion: unknown) => dialect.sqlToQuery(condicion as any).sql;

// El handle de transacción cubre las tres cadenas que se ejecutan adentro:
//   tx.select().from().where().orderBy().for()  -> lock de los créditos
//   tx.select().from().where().groupBy()        -> conteo de no-CUBE en el padre
//   tx.select().from().where()                  -> filas espejo no-CUBE
//   tx.update().set().where().returning()       -> el COMPLETADO
//   tx.insert().values()                        -> la fila de historial
function makeTx() {
  return {
    select: () => ({
      from: () => ({
        where: (condicion: unknown) => {
          selectCallCount++;
          const resultado: any = Promise.resolve(espejoResidual);
          resultado.groupBy = () => Promise.resolve(padreRestantes);
          resultado.orderBy = () => ({
            for: (modo: string) => {
              lockedWithFor = modo;
              lockedSql = sqlDe(condicion);
              return Promise.resolve([]);
            },
          });
          return resultado;
        },
      }),
    }),
    update: () => ({
      set: (data: Record<string, unknown>) => {
        updateWasCalled = true;
        lastUpdateData = data;
        return {
          where: (condicion: unknown) => {
            lastUpdateWhere = condicion;
            return { returning: () => Promise.resolve(updateReturning) };
          },
        };
      },
    }),
    insert: () => ({
      values: (filas: any) => {
        historialInsertado.push(...(Array.isArray(filas) ? filas : [filas]));
        return Promise.resolve([]);
      },
    }),
  } as any;
}

// Los helpers reciben su ejecutor por parámetro, así que las pruebas corren
// contra este handle falso y no contra una conexión real.
const ejecutorFalso = { transaction: async (cb: any) => cb(makeTx()) };

// Los helpers viven en utils/devolucionCompletada.ts, fuera de investor.ts, y
// reciben el ejecutor por parámetro. Eso permite importarlos directo y sin
// `mock.module`: no arrastran el grafo de imports de investor.ts —que incluye
// `lockPool`— hasta los mocks de "../database" que instalan otros archivos de
// la suite (aseguradoras, abonosCapital, devolucion, latefee...) sin ese
// export. Con un import top-level de investor.ts, estas pruebas pasaban
// aisladas pero fallaban en una corrida completa, protegiendo nada en CI.
import {
  filtrarCreditosTotalmenteDevueltos,
  marcarDevolucionCompletadaSiCorresponde,
} from "../utils/devolucionCompletada";

beforeEach(() => {
  padreRestantes = [];
  espejoResidual = [];
  updateReturning = [];
  historialInsertado = [];
  updateWasCalled = false;
  lastUpdateData = undefined;
  lastUpdateWhere = undefined;
  lockedWithFor = undefined;
  lockedSql = undefined;
  selectCallCount = 0;
});

describe("filtrarCreditosTotalmenteDevueltos", () => {
  it("un crédito sin filas no-CUBE en el padre queda completado", async () => {
    const { completados, diferidos } = await filtrarCreditosTotalmenteDevueltos(
      makeTx(),
      [500],
    );

    expect(completados).toEqual([500]);
    expect(diferidos.size).toBe(0);
  });

  it("un crédito con un inversionista restante NO se completa", async () => {
    padreRestantes = [{ credito_id: 500, restantes: 1 }];

    const { completados, diferidos } = await filtrarCreditosTotalmenteDevueltos(
      makeTx(),
      [500],
    );

    expect(completados).toEqual([]);
    expect(diferidos.get(500)).toEqual({ tipo: "inversionistas_en_padre", restantes: 1 });
  });

  it("la fila de CUBE no cuenta como inversionista pendiente", async () => {
    // El mock devuelve solo lo que la query ya filtró con ne(..., CUBE_ID):
    // si el crédito solo tiene a CUBE, no hay filas y el crédito cierra.
    padreRestantes = [];

    const { completados } = await filtrarCreditosTotalmenteDevueltos(makeTx(), [500]);

    expect(completados).toEqual([500]);
  });

  it("parte correctamente un lote mixto", async () => {
    padreRestantes = [
      { credito_id: 141, restantes: 2 },
      { credito_id: 8730, restantes: 1 },
    ];

    const { completados, diferidos } = await filtrarCreditosTotalmenteDevueltos(
      makeTx(),
      [8730, 78, 141],
    );

    expect(completados).toEqual([78]);
    expect(diferidos.get(141)).toEqual({ tipo: "inversionistas_en_padre", restantes: 2 });
    expect(diferidos.get(8730)).toEqual({ tipo: "inversionistas_en_padre", restantes: 1 });
  });

  it("con lista vacía no toca la base", async () => {
    const { completados, diferidos } = await filtrarCreditosTotalmenteDevueltos(
      makeTx(),
      [],
    );

    expect(completados).toEqual([]);
    expect(diferidos.size).toBe(0);
    expect(selectCallCount).toBe(0);
  });

  it("padre limpio con espejo residual EN CERO: completa igual y avisa de la divergencia", async () => {
    padreRestantes = [];
    espejoResidual = [
      { credito_id: 500, inversionista_id: 42, monto_aportado: "0" },
    ];
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    const { completados } = await filtrarCreditosTotalmenteDevueltos(makeTx(), [500]);

    expect(completados).toEqual([500]);
    expect(warn).toHaveBeenCalled();
    const mensaje = warn.mock.calls[0].join(" ");
    expect(mensaje).toContain("DIVERGENCIA");
    expect(mensaje).toContain("inversionista_id=42");
    warn.mockRestore();
  });

  it("padre limpio pero espejo CON SALDO: NO se cierra el crédito", async () => {
    // Al inversionista todavía le deben capital. La RAMA 2 tiene un guard de
    // monto_aportado==0 para esto, pero solo corre sobre créditos VERIFICADO:
    // si se cerrara acá, ese guard nunca llegaría a ejecutarse.
    padreRestantes = [];
    espejoResidual = [
      { credito_id: 500, inversionista_id: 42, monto_aportado: "52941.82" },
    ];
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    const { completados, diferidos } = await filtrarCreditosTotalmenteDevueltos(
      makeTx(),
      [500],
    );

    expect(completados).toEqual([]);
    expect(diferidos.get(500)).toEqual({ tipo: "saldo_en_espejo" });
    expect(warn.mock.calls[0].join(" ")).toContain("NO se cierra");
    warn.mockRestore();
  });

  it("lote mixto en el espejo: cierra el de saldo cero y retiene el otro", async () => {
    padreRestantes = [];
    espejoResidual = [
      { credito_id: 500, inversionista_id: 42, monto_aportado: "0" },
      { credito_id: 501, inversionista_id: 43, monto_aportado: "1500.00" },
    ];
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    const { completados, diferidos } = await filtrarCreditosTotalmenteDevueltos(
      makeTx(),
      [500, 501],
    );

    expect(completados).toEqual([500]);
    expect(diferidos.get(501)).toEqual({ tipo: "saldo_en_espejo" });
    warn.mockRestore();
  });
});

describe("marcarDevolucionCompletadaSiCorresponde", () => {
  it("toma el lock de los créditos con FOR NO KEY UPDATE antes de decidir", async () => {
    updateReturning = [{ credito_id: 500 }];

    await marcarDevolucionCompletadaSiCorresponde([500], "test", ejecutorFalso);

    // Mismo lock, y con el mismo orden por credito_id, que toma el guard de
    // devolución al inicio de la liquidación: si divergen, las dos rutas pueden
    // trabarse entre sí.
    expect(lockedWithFor).toBe("no key update");
    expect(lockedSql).toContain("credito_id");
  });

  it("NO marca COMPLETADO si todavía queda un inversionista", async () => {
    // Éste es el bug reportado: al liquidar al primer inversionista de un
    // crédito compartido, el crédito entero se marcaba COMPLETADO y los demás
    // quedaban fuera del flujo de devolución.
    padreRestantes = [{ credito_id: 500, restantes: 1 }];

    const { completados, diferidos } = await marcarDevolucionCompletadaSiCorresponde(
      [500],
      "devolución VERIFICADO inv 42",
      ejecutorFalso,
    );

    expect(updateWasCalled).toBe(false);
    expect(completados).toEqual([]);
    expect(diferidos).toEqual([500]);
  });

  it("marca COMPLETADO exigiendo que el crédito siga en VERIFICADO", async () => {
    padreRestantes = [];
    updateReturning = [{ credito_id: 500 }];

    const { completados, diferidos } = await marcarDevolucionCompletadaSiCorresponde(
      [500],
      "devolución VERIFICADO inv 42",
      ejecutorFalso,
    );

    expect(updateWasCalled).toBe(true);
    expect(lastUpdateData).toEqual({ estado_devolucion: "COMPLETADO" });
    expect(completados).toEqual([500]);
    expect(diferidos).toEqual([]);

    // El guard de VERIFICADO faltaba en la RAMA 2: sin él, el UPDATE podía
    // pisar un crédito que ya había cambiado de estado por otra vía.
    const where = sqlDe(lastUpdateWhere);
    expect(where).toContain("estado_devolucion");
    expect(where).toContain("in (");
  });

  it("no reporta como cerrado un crédito que el UPDATE no cambió", async () => {
    // El crédito ya no estaba en VERIFICADO (returning vacío), típico de la
    // RAMA 1: pasa todo lo que movió exitInvestor, mucho en NO_APLICA. Antes
    // se devolvían los candidatos y la función mentía diciendo que cerró.
    padreRestantes = [];
    updateReturning = [];

    const { completados } = await marcarDevolucionCompletadaSiCorresponde([500], "test", ejecutorFalso);

    expect(updateWasCalled).toBe(true);
    expect(completados).toEqual([]);
    expect(historialInsertado).toEqual([]);
  });

  it("registra la transición en historial_devolucion_credito al cerrar", async () => {
    padreRestantes = [];
    updateReturning = [{ credito_id: 500 }];

    await marcarDevolucionCompletadaSiCorresponde([500], "salida total inv 42", ejecutorFalso);

    expect(historialInsertado).toHaveLength(1);
    expect(historialInsertado[0]).toMatchObject({
      credito_id: 500,
      estado_anterior: "VERIFICADO",
      estado_nuevo: "COMPLETADO",
    });
    expect(historialInsertado[0].motivo).toContain("salida total inv 42");
  });

  it("con lista vacía no abre transacción ni actualiza", async () => {
    const { completados, diferidos } = await marcarDevolucionCompletadaSiCorresponde(
      [],
      "test",
      ejecutorFalso,
    );

    expect(updateWasCalled).toBe(false);
    expect(completados).toEqual([]);
    expect(diferidos).toEqual([]);
  });

  it("es idempotente: dos llamadas seguidas dan el mismo resultado", async () => {
    padreRestantes = [];
    updateReturning = [{ credito_id: 500 }];

    const primera = await marcarDevolucionCompletadaSiCorresponde([500], "test", ejecutorFalso);
    const segunda = await marcarDevolucionCompletadaSiCorresponde([500], "test", ejecutorFalso);

    expect(primera).toEqual(segunda);
  });

  it("el crédito compartido cierra recién cuando sale el último inversionista", async () => {
    // Liquidación del inversionista A: B sigue en el padre.
    padreRestantes = [{ credito_id: 500, restantes: 1 }];
    const trasA = await marcarDevolucionCompletadaSiCorresponde(
      [500],
      "devolución VERIFICADO inv A",
      ejecutorFalso,
    );

    expect(updateWasCalled).toBe(false);
    expect(trasA.diferidos).toEqual([500]);

    // Liquidación del inversionista B: el padre queda solo con CUBE.
    padreRestantes = [];
    updateReturning = [{ credito_id: 500 }];
    const trasB = await marcarDevolucionCompletadaSiCorresponde(
      [500],
      "devolución VERIFICADO inv B",
      ejecutorFalso,
    );

    expect(updateWasCalled).toBe(true);
    expect(trasB.completados).toEqual([500]);
    expect(trasB.diferidos).toEqual([]);
  });
});
