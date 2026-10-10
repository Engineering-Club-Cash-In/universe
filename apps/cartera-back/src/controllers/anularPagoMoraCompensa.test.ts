/**
 * Anular una boleta falsa deshace la mora que esa boleta había anotado.
 *
 * Cuando un pago cobra mora, lo registra en `mora_pagada_cuota` con `tipo: PAGO`.
 * Al anular ese pago, la boleta nunca existió, así que lo que anotó tiene que
 * desaparecer: se inserta una fila compensatoria con `tipo: ANULACION` y monto
 * negativo que apunta a la original. Es distinto de restituir la mora: restituir
 * es devolverle al crédito el monto que se le debe por las fórmulas de cálculo;
 * esto es descartar lo que esa boleta particular había contribuido al histórico.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { convenios_pago, pagos_credito, mora_pagada_cuota } from "../database/db/schema";

process.env.SUPABASE_DB_URL ??= "postgresql://nadie:nadie@127.0.0.1:1/ninguna";
const { anularPagoYRestituirMora } = await import("./anularPagoMora");

const PAGO_ID = 401;
const CREDITO_ID = 5252;
const AYER = new Date("2026-09-22T10:00:00.000Z");

type Llamada = { tabla: any; via: "select for update" | "select" | "update" | "insert" };

const estado: {
  selects: any[][];
  llamadas: Llamada[];
  rowCount: number;
  updateMoraArgs: any[];
  updateMoraResultado: { success: boolean; message?: string };
  resets: number[];
  rubrosRevertidos: number[];
  wheres: any[];
  /** Las filas insertadas en `mora_pagada_cuota`, en orden. */
  moraInsertadas: any[];
} = {
  selects: [],
  llamadas: [],
  rowCount: 1,
  updateMoraArgs: [],
  updateMoraResultado: { success: true },
  resets: [],
  rubrosRevertidos: [],
  wheres: [],
  moraInsertadas: [],
};

const txFalso: any = {
  select: () => {
    let tabla: any = null;
    let candado = false;
    const b: any = {
      from: (t: any) => ((tabla = t), b),
      where: (cond: any) => (estado.wheres.push(cond), b),
      limit: () => b,
      orderBy: () => b,
      for: () => ((candado = true), b),
      then: (res: any, rej: any) => {
        // Guard del abono inicial de un convenio (COBROS-02 W4): sin convenio, y sin consumir la cola posicional.
        if (tabla === convenios_pago) return Promise.resolve([]).then(res, rej);
        estado.llamadas.push({
          tabla,
          via: candado ? "select for update" : "select",
        });
        return Promise.resolve(estado.selects.shift() ?? []).then(res, rej);
      },
    };
    return b;
  },
  update: (tabla: any) => ({
    set: () => {
      const b: any = {
        where: () => b,
        returning: () => {
          estado.llamadas.push({ tabla, via: "update" });
          return Promise.resolve([]);
        },
        then: (res: any, rej: any) => {
          estado.llamadas.push({ tabla, via: "update" });
          return Promise.resolve({ rowCount: estado.rowCount }).then(res, rej);
        },
      };
      return b;
    },
  }),
  insert: (tabla: any) => ({
    values: (rows: any) => ({
      // El insert de compensatorias encadena onConflictDoNothing().returning().
      onConflictDoNothing() { return this; },
      returning: () => {
        if (tabla === mora_pagada_cuota) {
          estado.moraInsertadas.push(...rows);
        }
        estado.llamadas.push({ tabla, via: "insert" });
        return Promise.resolve([]);
      },
      then: (res: any, rej: any) => {
        if (tabla === mora_pagada_cuota) {
          estado.moraInsertadas.push(...rows);
        }
        estado.llamadas.push({ tabla, via: "insert" });
        return Promise.resolve().then(res, rej);
      },
    }),
  }),
};

const deps = {
  updateMora: (async (args: any) => {
    estado.updateMoraArgs.push(args);
    return estado.updateMoraResultado;
  }) as any,
  resetAjusteFechaIdeal: (async (pago_id: number) => {
    estado.resets.push(pago_id);
  }) as any,
  revertirRubros: (async (pago_id: number) => {
    estado.rubrosRevertidos.push(pago_id);
    return [];
  }) as any,
};

const anular = () =>
  anularPagoYRestituirMora(
    txFalso,
    { pago_id: PAGO_ID, credito_id: CREDITO_ID },
    deps,
  );

const prepararBase = ({
  pago,
  decremento = [],
  posteriores = [],
  eventosDelCron = [],
  credito = [{ credito_id: CREDITO_ID }],
  moraPagada = [],
}: {
  pago: any[];
  decremento?: any[];
  posteriores?: any[];
  eventosDelCron?: any[];
  credito?: any[];
  moraPagada?: any[];
}) => {
  // El orden de selects es importante:
  // 1. credito (FOR UPDATE)
  // 2. pago (FOR UPDATE)
  // 3. decremento (estadoMoraTrasElPago busca el decremento marcado)
  // 4. posteriores (si hay decremento) o eventosDelCron (si no hay)
  // 5. mora_pagada_cuota (revertirMoraPagadaDePago)
  const selects = decremento.length
    ? [credito, pago, decremento, posteriores, moraPagada]
    : [credito, pago, decremento, eventosDelCron, moraPagada];
  estado.selects = selects;
};

const PAGO_CON_MORA = [
  { mora: "100.00", paymentFalse: false, created_at: AYER },
];

beforeEach(() => {
  estado.selects = [];
  estado.llamadas = [];
  estado.rowCount = 1;
  estado.updateMoraArgs = [];
  estado.updateMoraResultado = { success: true };
  estado.resets = [];
  estado.rubrosRevertidos = [];
  estado.wheres = [];
  estado.moraInsertadas = [];
});

describe("anular un pago compensa lo que había anotado en mora_pagada_cuota", () => {
  it("inserta filas compensatorias con tipo ANULACION para cada fila PAGO del pago anulado", async () => {
    // Simular que el pago había anotado 2 filas de mora en diferentes cuotas
    const moraAnotada = [
      {
        id: 1001,
        credito_id: CREDITO_ID,
        cuota_id: 10,
        pago_id: PAGO_ID,
        monto: "50.00",
        tipo: "PAGO",
        revierte_a: null,
      },
      {
        id: 1002,
        credito_id: CREDITO_ID,
        cuota_id: 11,
        pago_id: PAGO_ID,
        monto: "50.00",
        tipo: "PAGO",
        revierte_a: null,
      },
    ];

    prepararBase({ pago: PAGO_CON_MORA, moraPagada: moraAnotada });

    await anular();

    // Se debe haber insertado 2 filas compensatorias con tipo ANULACION
    expect(
      estado.llamadas.some(
        (l) => l.tabla === mora_pagada_cuota && l.via === "insert",
      ),
    ).toBe(true);

    // Verificar que las filas compensatorias tienen el tipo correcto
    const compuestas = estado.moraInsertadas.filter(
      (f) => f.tipo === "ANULACION",
    );
    expect(compuestas.length).toBe(2);

    // Cada compuesta debe revertir a una original
    expect(compuestas.every((f) => f.revierte_a !== null)).toBe(true);

    // Los montos deben ser negativos
    expect(compuestas.every((f) => parseFloat(f.monto) < 0)).toBe(true);
  });

  it("anular un pago sin mora anotada no falla ni intenta compensar", async () => {
    prepararBase({
      pago: [{ mora: "0.00", paymentFalse: false, created_at: AYER }],
      moraPagada: [], // Sin filas de mora_pagada_cuota
    });

    await anular();

    // Sin mora en el pago, no hay nada en mora_pagada_cuota que compensar.
    const moraCompensada = estado.moraInsertadas.filter(
      (f) => f.tipo === "ANULACION",
    );
    expect(moraCompensada.length).toBe(0);
  });

  it("si la compensación falla, toda la transacción se revierte", async () => {
    const moraAnotada = [
      {
        id: 1001,
        credito_id: CREDITO_ID,
        cuota_id: 10,
        pago_id: PAGO_ID,
        monto: "100.00",
        tipo: "PAGO",
        revierte_a: null,
      },
    ];

    prepararBase({ pago: PAGO_CON_MORA, moraPagada: moraAnotada });

    // Crear un tx falso que lance al insertar en mora_pagada_cuota
    const txConError: any = {
      select: txFalso.select,
      update: txFalso.update,
      insert: (tabla: any) => ({
        values: (rows: any) => ({
          // El insert de compensatorias encadena onConflictDoNothing().returning().
          onConflictDoNothing() { return this; },
          returning: () => {
            if (tabla === mora_pagada_cuota) {
              throw new Error("Error de índice único en mora_pagada_cuota");
            }
            return Promise.resolve([]);
          },
          then: (res: any, rej: any) => {
            if (tabla === mora_pagada_cuota) {
              return Promise.reject(
                new Error("Error de índice único en mora_pagada_cuota"),
              ).then(res, rej);
            }
            return Promise.resolve().then(res, rej);
          },
        }),
      }),
    };

    // Esperamos que la función lance
    await expect(
      anularPagoYRestituirMora(txConError, { pago_id: PAGO_ID, credito_id: CREDITO_ID }, deps),
    ).rejects.toThrow("Error de índice único en mora_pagada_cuota");
  });

  it("anular dos veces compensa solo una vez", async () => {
    // Primera anulación: el pago anotó mora
    const moraAnotada = [
      {
        id: 1001,
        credito_id: CREDITO_ID,
        cuota_id: 10,
        pago_id: PAGO_ID,
        monto: "100.00",
        tipo: "PAGO",
        revierte_a: null,
      },
    ];

    prepararBase({ pago: PAGO_CON_MORA, moraPagada: moraAnotada });

    await anular();

    // Verificar que se compensó una vez
    let compensadas = estado.moraInsertadas.filter(
      (f) => f.tipo === "ANULACION",
    );
    expect(compensadas.length).toBe(1);

    // Resetear para la segunda anulación
    estado.moraInsertadas = [];
    estado.llamadas = [];
    estado.selects = [
      [{ credito_id: CREDITO_ID }], // crédito
      [{ mora: "100.00", paymentFalse: true, created_at: AYER }], // pago YA falso
      [], // mora_pagada_cuota: vacío (no hay más anotaciones vivas)
    ];
    estado.rowCount = 0; // El UPDATE no encuentra la fila

    // La segunda anulación tira porque el pago ya estaba falso
    await expect(anular()).rejects.toThrow("No payment found");

    // No se intentó compensar de nuevo
    expect(estado.moraInsertadas.length).toBe(0);
  });

  it("la compensación va DENTRO de la misma transacción que el UPDATE", async () => {
    const moraAnotada = [
      {
        id: 1001,
        credito_id: CREDITO_ID,
        cuota_id: 10,
        pago_id: PAGO_ID,
        monto: "100.00",
        tipo: "PAGO",
        revierte_a: null,
      },
    ];

    prepararBase({ pago: PAGO_CON_MORA, moraPagada: moraAnotada });

    await anular();

    // El orden de llamadas debe ser:
    // 1. SELECT creditos FOR UPDATE
    // 2. SELECT pagos_credito FOR UPDATE
    // 3. SELECT mora_pagada_cuota (para revertirMoraPagadaDePago)
    // 4. UPDATE pagos_credito
    // 5. INSERT mora_pagada_cuota (compensación)
    // 6. ...

    const updateIdx = estado.llamadas.findIndex(
      (l) => l.tabla === pagos_credito && l.via === "update",
    );
    const selectMoraIdx = estado.llamadas.findIndex(
      (l) => l.tabla === mora_pagada_cuota && l.via === "select",
    );
    const insertMoraIdx = estado.llamadas.findIndex(
      (l) => l.tabla === mora_pagada_cuota && l.via === "insert",
    );

    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(selectMoraIdx).toBeGreaterThanOrEqual(0);
    expect(insertMoraIdx).toBeGreaterThanOrEqual(0);
    // El select para revertirMoraPagadaDePago debe ser antes del insert
    expect(selectMoraIdx).toBeLessThan(insertMoraIdx);
    // El insert debe ser después del UPDATE
    expect(insertMoraIdx).toBeGreaterThan(updateIdx);
  });
});
