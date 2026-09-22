/**
 * El cron no puede escribir un SEGUNDO evento DESACTIVACION por el mismo monto.
 *
 * `procesarMoras` lee las moras activas al arrancar y las apaga al final de la
 * corrida. Su advisory lock lo protege de otra corrida del cron, NO de un
 * convenio (u otra ruta) que apague la misma fila en el medio: con ese hueco,
 * el cron la apagaba "otra vez" y anotaba un DESACTIVACION duplicado — justo la
 * cifra con la que se mide cuánta mora se perdona.
 *
 * Estas pruebas ejercen `procesarMoras` DE VERDAD contra una base falsa y
 * miran qué writes salen, cuáles NO, y qué dicen los contadores.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

type Call = { tabla: any; set?: any; values?: any; where?: any };

const estado: {
  resultados: any[];
  inserts: Call[];
  updates: Call[];
  /** Filas que devuelve cada `.returning()` de un update, en orden. */
  updateReturns: any[][];
  emitidos: any[];
} = { resultados: [], inserts: [], updates: [], updateReturns: [], emitidos: [] };

/**
 * ¿La condición `where` de drizzle menciona esta columna? Recorre los
 * `queryChunks` comparando IDENTIDAD de columna, no strings de SQL, para que el
 * test falle si alguien le quita el filtro `activa` al update del cron.
 * (Mismo helper que usa latefeeMoraPorConvenio.test.ts.)
 */
const mencionaColumna = (nodo: any, columna: unknown): boolean => {
  if (!nodo) return false;
  if (nodo === columna) return true;
  const chunks = Array.isArray(nodo) ? nodo : nodo.queryChunks;
  if (!Array.isArray(chunks)) return false;
  return chunks.some((c) => mencionaColumna(c, columna));
};

const selectChain = () => {
  const b: any = {
    from: () => b,
    innerJoin: () => b,
    leftJoin: () => b,
    where: () => b,
    then: (res: any, rej: any) =>
      Promise.resolve(estado.resultados.shift() ?? []).then(res, rej),
  };
  return b;
};

const dbFalsa = {
  select: () => selectChain(),
  insert: (tabla: any) => ({
    values: (values: any) => {
      estado.inserts.push({ tabla, values });
      const b: any = {
        returning: () => Promise.resolve([{ mora_id: 999, porcentaje_mora: "1.12" }]),
        then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
      };
      return b;
    },
  }),
  update: (tabla: any) => ({
    set: (set: any) => {
      const call: Call = { tabla, set };
      estado.updates.push(call);
      const b: any = {
        where: (w: any) => {
          call.where = w;
          return b;
        },
        // Por defecto el update SÍ afecta la fila (nadie compitió).
        returning: () => Promise.resolve(estado.updateReturns.shift() ?? [{ mora_id: 77 }]),
        then: (res: any, rej: any) => Promise.resolve({ rowCount: 1 }).then(res, rej),
      };
      return b;
    },
  }),
};

const clientFalso = {
  connect: async () => ({
    query: async () => ({ rows: [{ ok: true }] }),
    release: () => {},
  }),
};

mock.module("../database", () => ({ db: dbFalsa, client: clientFalso }));
mock.module("../utils/structuredLogger", () => ({
  emitCreditLateFee: (p: any) => estado.emitidos.push(p),
}));

const { procesarMoras, hoyGuatemala } = await import("./latefee");
const { creditos, moras_credito, moras_historial } = await import("../database/db/schema");

const CREDITO_ID = 4242;

const MORA_ACTIVA = {
  mora_id: 77,
  credito_id: CREDITO_ID,
  monto_mora: "112.00",
  cuotas_atrasadas: 1,
  porcentaje_mora: "1.12",
};

/** Una cuota vencida AYER con el capital dado. */
const cuotaDeAyer = (capital: string) => {
  const hoy = hoyGuatemala();
  const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
  return {
    cuota_id: 1,
    credito_id: CREDITO_ID,
    fecha_vencimiento: ayer,
    pagado: false,
    statusCredit: "ACTIVO",
    capital,
    hasPaidPayment: false,
  };
};

// Capital Q10 con 1 día: 10 × 1.12% × 1/30 ≈ Q0.0037 → "0.00" (rama moraCero).
const CUOTA_MORA_CERO = () => [cuotaDeAyer("10")];
// Capital 0 → rama "sin capital".
const CUOTA_SIN_CAPITAL = () => [cuotaDeAyer("0")];
// Sin cuotas vencidas y con mora activa → paso 6 ("se puso al día").
const SIN_CUOTAS: any[] = [];

const correr = async (cuotas: any[], gano: boolean) => {
  estado.resultados = [cuotas, [MORA_ACTIVA]];
  estado.inserts = [];
  estado.updates = [];
  estado.emitidos = [];
  // `gano = false` simula que otra ruta apagó la fila a media corrida: el
  // UPDATE condicional no afecta ninguna fila.
  estado.updateReturns = gano ? [] : [[]];
  return (await procesarMoras()) as any;
};

const apagadosDeMora = () => estado.updates.filter((c) => c.tabla === moras_credito);
const updatesDeCredito = () => estado.updates.filter((c) => c.tabla === creditos);
const historial = () => estado.inserts.filter((c) => c.tabla === moras_historial);
const skippedCount = () =>
  estado.emitidos.find((e) => e.operation === "process" && e.outcome === "completed")?.skippedCount;

beforeEach(() => {
  estado.resultados = [];
  estado.inserts = [];
  estado.updates = [];
  estado.updateReturns = [];
  estado.emitidos = [];
});

describe("procesarMoras — carrera al desactivar la mora", () => {
  it("el UPDATE del cron filtra por activa=true, no solo por mora_id", async () => {
    await correr(SIN_CUOTAS, true);

    const upd = apagadosDeMora()[0];
    expect(upd).toBeDefined();
    // Sin este filtro, una ruta concurrente que ya la apagó no impide que el
    // cron "gane" también y anote un DESACTIVACION por el mismo monto.
    expect(mencionaColumna(upd.where, moras_credito.activa)).toBe(true);
    expect(mencionaColumna(upd.where, moras_credito.mora_id)).toBe(true);
  });

  // ── Paso 6: el crédito se puso al día ───────────────────────────────────
  it("paso 6, camino normal: apaga, baja el status, anota el historial y cuenta", async () => {
    const r = await correr(SIN_CUOTAS, true);

    expect(apagadosDeMora().length).toBe(1);
    expect(updatesDeCredito().length).toBe(1);
    expect(historial().length).toBe(1);
    expect(historial()[0].values).toMatchObject({
      tipo_evento: "DESACTIVACION",
      monto_anterior: "112.00",
      monto_nuevo: "0",
    });
    expect(r.desactivadas).toBe(1);
    expect(skippedCount()).toBe(0);
  });

  it("paso 6, otra ruta ganó (0 filas): no anota historial, no toca el status y no cuenta", async () => {
    const r = await correr(SIN_CUOTAS, false);

    expect(historial()).toEqual([]);
    expect(updatesDeCredito()).toEqual([]);
    expect(r.desactivadas).toBe(0);
    // No se pierde de la cuenta: cae en los omitidos por concurrencia.
    expect(skippedCount()).toBe(1);
  });

  // ── Rama del loop 5: mora proporcional que redondea a Q0.00 ─────────────
  it("mora cero, camino normal: anota el historial y cuenta la desactivación", async () => {
    const r = await correr(CUOTA_MORA_CERO(), true);

    expect(historial().length).toBe(1);
    expect(updatesDeCredito().length).toBe(1);
    expect(r.desactivadas).toBe(1);
    expect(r.moraCero).toBe(1);
    // Ya se contó como desactivada (succeeded): no puede contarse también omitida.
    expect(skippedCount()).toBe(0);
  });

  it("mora cero, otra ruta ganó (0 filas): no anota historial, no toca el status y no cuenta", async () => {
    const r = await correr(CUOTA_MORA_CERO(), false);

    expect(historial()).toEqual([]);
    expect(updatesDeCredito()).toEqual([]);
    expect(r.desactivadas).toBe(0);
    expect(r.moraCero).toBe(1);
    expect(skippedCount()).toBe(1);
  });

  // ── Rama del loop 5: crédito sin capital ────────────────────────────────
  it("sin capital, camino normal: anota el historial y cuenta la desactivación", async () => {
    const r = await correr(CUOTA_SIN_CAPITAL(), true);

    expect(historial().length).toBe(1);
    expect(r.desactivadas).toBe(1);
    expect(r.sinCapital).toBe(1);
    expect(skippedCount()).toBe(0);
  });

  it("sin capital, otra ruta ganó (0 filas): no anota historial, no toca el status y no cuenta", async () => {
    const r = await correr(CUOTA_SIN_CAPITAL(), false);

    expect(historial()).toEqual([]);
    expect(updatesDeCredito()).toEqual([]);
    expect(r.desactivadas).toBe(0);
    expect(r.sinCapital).toBe(1);
    expect(skippedCount()).toBe(1);
  });
});
