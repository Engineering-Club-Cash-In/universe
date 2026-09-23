/**
 * Las escrituras del cron (CREACION y RECALCULO) son todo o nada.
 *
 * Para que el cron no le pisara el estado a un convenio recién confirmado, la
 * rama puso el `UPDATE creditos SET statusCredit='MOROSO' … RETURNING` PRIMERO:
 * hace de candado y de escritura a la vez. Eso cerró la carrera, pero ese
 * update autocommiteaba: si el INSERT de la mora fallaba después con cualquier
 * cosa que no fuera el 23505 contemplado (un error transitorio, otra
 * restricción), `procesarMoras` salía con error y el crédito quedaba MOROSO sin
 * mora activa ni evento de CREACION — un estado que ni el cron ni una segunda
 * pasada corrigen, porque los dos parten de "hay mora activa".
 *
 * La rama RECALCULO tenía el mismo hermano: update de la mora, update del
 * status e historial sueltos. Si el status o el historial fallaban, el monto de
 * la mora ya había cambiado y quedaba SIN RASTRO en moras_historial — justo la
 * garantía que esta rama vino a dar, y encima lo que se le cobra al cliente.
 *
 * Acá el fake de la base MODELA EL COMMIT: los writes de una transacción se
 * guardan aparte y solo se vuelven "confirmados" si el callback termina bien;
 * una transacción anidada (el savepoint alrededor del insert) descarta solo sus
 * propios writes. Así las pruebas miran lo que de verdad quedaría escrito en
 * Postgres, no la mera secuencia de llamadas.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

type Write = { tabla: any; kind: "insert" | "update"; set?: any; values?: any };

const estado: {
  resultados: any[];
  /** Writes que sobrevivieron al commit (los de una tx que revirtió no están). */
  confirmados: Write[];
  /** Error con el que revienta el insert en `moras_credito`. */
  insertMoraThrows: any;
  /** Error con el que revienta el insert en `moras_historial`. */
  insertHistorialThrows: any;
  /** Filas que devuelve el `.returning()` de un update de `creditos`, en orden. */
  updateCreditosReturns: any[][];
  /** Filas que devuelve el `.returning()` de un update de `moras_credito`. */
  updateMorasReturns: any[][];
  emitidos: any[];
} = {
  resultados: [],
  confirmados: [],
  insertMoraThrows: undefined,
  insertHistorialThrows: undefined,
  updateCreditosReturns: [],
  updateMorasReturns: [],
  emitidos: [],
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

/** Estado de una transacción abierta: sus writes y si quedó abortada. */
type Scope = { writes: Write[]; abortado: boolean };

/**
 * Cliente falso que escribe en `scope`. Modela tres reglas de Postgres:
 *
 *  1. `transaction()` le da a su callback un cliente con scope propio; si el
 *     callback termina bien, sus writes se vuelcan al scope padre (COMMIT /
 *     RELEASE SAVEPOINT).
 *  2. Si el callback tira, los writes del scope se descartan (ROLLBACK / ROLLBACK
 *     TO SAVEPOINT) y el error se propaga, igual que en drizzle. El savepoint
 *     LIMPIA el estado de aborto: el padre sigue sano.
 *  3. Un statement que falla ABORTA su transacción: aunque el callback se trague
 *     el error y termine bien, el COMMIT es un rollback silencioso. Sin esto, la
 *     prueba del 23505 pasaría igual sin el savepoint — que es justo la pieza
 *     que se está probando.
 */
const clienteFalso = (scope: Scope): any => {
  const buffer = scope.writes;
  const errorDeInsert = (tabla: any) => {
    if (tabla === moras_credito) return estado.insertMoraThrows;
    if (tabla === moras_historial) return estado.insertHistorialThrows;
    return undefined;
  };

  return {
    select: () => selectChain(),
    insert: (tabla: any) => ({
      values: (values: any) => {
        const ejecutar = () => {
          const err = errorDeInsert(tabla);
          if (err) {
            scope.abortado = true;
            return Promise.reject(err);
          }
          buffer.push({ tabla, kind: "insert", values });
          return Promise.resolve([{ mora_id: 999, porcentaje_mora: "1.12" }]);
        };
        const b: any = {
          returning: () => ejecutar(),
          then: (res: any, rej: any) => ejecutar().then(() => []).then(res, rej),
        };
        return b;
      },
    }),
    update: (tabla: any) => ({
      set: (set: any) => {
        const b: any = {
          where: () => b,
          returning: () => {
            const filas =
              tabla === creditos
                ? estado.updateCreditosReturns.shift() ?? [{ credito_id: CREDITO_ID }]
                : estado.updateMorasReturns.shift() ?? [{ mora_id: MORA_ID }];
            // El update se registra igual cuando afecta 0 filas: el write se
            // ejecutó, simplemente no matcheó nada.
            buffer.push({ tabla, kind: "update", set });
            return Promise.resolve(filas);
          },
          then: (res: any, rej: any) => {
            buffer.push({ tabla, kind: "update", set });
            return Promise.resolve({ rowCount: 1 }).then(res, rej);
          },
        };
        return b;
      },
    }),
    transaction: async (cb: any) => {
      const hijo: Scope = { writes: [], abortado: false };
      // Si el callback tira, el error sale de acá y los writes del hijo se
      // pierden con él (ROLLBACK / ROLLBACK TO SAVEPOINT); el padre queda sano.
      const resultado = await cb(clienteFalso(hijo));
      // El callback terminó bien, pero si adentro reventó un statement que nadie
      // revirtió con un savepoint, el COMMIT no confirma nada.
      if (hijo.abortado) {
        scope.abortado = true;
        return resultado;
      }
      buffer.push(...hijo.writes);
      return resultado;
    },
  };
};

const scopeRaiz: Scope = { writes: estado.confirmados, abortado: false };
const dbFalsa = clienteFalso(scopeRaiz);

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

/** Una cuota vencida AYER, con capital suficiente para que la mora sea > Q0.00. */
const cuotaDeAyer = () => {
  const hoy = hoyGuatemala();
  const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
  return {
    cuota_id: 1,
    credito_id: CREDITO_ID,
    fecha_vencimiento: ayer,
    pagado: false,
    statusCredit: "ACTIVO",
    capital: "10000",
    hasPaidPayment: false,
  };
};

/**
 * Mora activa cuyo monto NO coincide con el recalculado → el cron entra a
 * RECALCULO (si coincidiera, saldría por `sinCambios`).
 */
const MORA_ID = 77;
const MORA_ACTIVA = {
  mora_id: MORA_ID,
  credito_id: CREDITO_ID,
  monto_mora: "1.00",
  cuotas_atrasadas: 9,
  porcentaje_mora: "1.12",
};

const reset = () => {
  estado.resultados = [];
  // Se vacía EN EL LUGAR: el cliente falso raíz cerró sobre este array.
  estado.confirmados.length = 0;
  scopeRaiz.abortado = false;
  estado.insertMoraThrows = undefined;
  estado.insertHistorialThrows = undefined;
  estado.updateCreditosReturns = [];
  estado.updateMorasReturns = [];
  estado.emitidos = [];
};

/** `moraPrevia: false` → rama CREACION; `true` → rama RECALCULO. */
const correr = async (moraPrevia = false) => {
  estado.resultados = [[cuotaDeAyer()], moraPrevia ? [MORA_ACTIVA] : []];
  return (await procesarMoras()) as any;
};

const confirmados = (tabla: any, kind?: "insert" | "update") =>
  estado.confirmados.filter((w) => w.tabla === tabla && (!kind || w.kind === kind));
const skippedCount = () =>
  estado.emitidos.find((e) => e.operation === "process" && e.outcome === "completed")?.skippedCount;
const succeededCount = () =>
  estado.emitidos.find((e) => e.operation === "process" && e.outcome === "completed")?.succeededCount;

beforeEach(reset);

describe("procesarMoras — CREACION atómica (status + mora + historial)", () => {
  it("camino feliz: confirma el MOROSO, la mora y el historial, y cuenta la creación", async () => {
    const r = await correr();

    expect(confirmados(creditos, "update").map((w) => w.set)).toEqual([
      { statusCredit: "MOROSO" },
    ]);
    expect(confirmados(moras_credito, "insert").length).toBe(1);
    expect(confirmados(moras_credito, "insert")[0].values).toMatchObject({
      credito_id: CREDITO_ID,
      activa: true,
    });
    expect(confirmados(moras_historial, "insert").length).toBe(1);
    expect(confirmados(moras_historial, "insert")[0].values).toMatchObject({
      tipo_evento: "CREACION",
      credito_id: CREDITO_ID,
    });
    expect(r.creadas).toBe(1);
    expect(succeededCount()).toBe(1);
    expect(skippedCount()).toBe(0);
  });

  it("si el insert de la mora falla con un error genérico, el crédito NO queda MOROSO y el error se propaga", async () => {
    estado.insertMoraThrows = Object.assign(new Error("deadlock detected"), { code: "40P01" });

    await expect(correr()).rejects.toThrow("deadlock detected");

    // 🔴 Lo que el defecto dejaba escrito: el MOROSO huérfano.
    expect(confirmados(creditos)).toEqual([]);
    expect(confirmados(moras_credito)).toEqual([]);
    expect(confirmados(moras_historial)).toEqual([]);
    expect(estado.emitidos.some((e) => e.outcome === "failed" && e.operation === "process")).toBe(true);
  });

  it("si el historial falla, tampoco queda la mora ni el MOROSO: los tres writes van juntos", async () => {
    estado.insertHistorialThrows = new Error("historial caído");

    await expect(correr()).rejects.toThrow("historial caído");

    expect(confirmados(creditos)).toEqual([]);
    expect(confirmados(moras_credito)).toEqual([]);
  });

  it("con 23505 el crédito SÍ queda MOROSO (hay una mora activa que lo respalda) y se cuenta como omitido", async () => {
    estado.insertMoraThrows = Object.assign(new Error("dup"), { code: "23505" });

    const r = await correr();

    // El savepoint revierte solo el insert: el status se confirma.
    expect(confirmados(creditos, "update").map((w) => w.set)).toEqual([
      { statusCredit: "MOROSO" },
    ]);
    expect(confirmados(moras_credito)).toEqual([]);
    expect(confirmados(moras_historial)).toEqual([]);
    expect(r.creadas).toBe(0);
    expect(succeededCount()).toBe(0);
    expect(skippedCount()).toBe(1);
  });

  it("el candado sigue vivo: cero filas del RETURNING → no se inserta mora ni historial y cuenta como omitido", async () => {
    estado.updateCreditosReturns = [[]];

    const r = await correr();

    expect(confirmados(moras_credito)).toEqual([]);
    expect(confirmados(moras_historial)).toEqual([]);
    expect(r.creadas).toBe(0);
    expect(succeededCount()).toBe(0);
    expect(skippedCount()).toBe(1);
  });
});

describe("procesarMoras — RECALCULO atómico (mora + status + historial)", () => {
  it("camino feliz: confirma el monto nuevo, el MOROSO y el historial, y cuenta el recálculo", async () => {
    const r = await correr(true);

    expect(confirmados(moras_credito, "update").length).toBe(1);
    expect(confirmados(moras_credito, "update")[0].set).toMatchObject({
      cuotas_atrasadas: 1,
    });
    expect(confirmados(creditos, "update").map((w) => w.set)).toEqual([
      { statusCredit: "MOROSO" },
    ]);
    expect(confirmados(moras_historial, "insert").length).toBe(1);
    expect(confirmados(moras_historial, "insert")[0].values).toMatchObject({
      tipo_evento: "RECALCULO",
      monto_anterior: "1.00",
    });
    expect(r.recalculadas).toBe(1);
    expect(succeededCount()).toBe(1);
    expect(skippedCount()).toBe(0);
  });

  it("si el historial falla, no queda ni la mora recalculada ni el cambio de estado", async () => {
    estado.insertHistorialThrows = new Error("historial caído");

    await expect(correr(true)).rejects.toThrow("historial caído");

    // 🔴 Lo que el defecto dejaba escrito: el monto nuevo cobrándose sin rastro.
    expect(confirmados(moras_credito)).toEqual([]);
    expect(confirmados(creditos)).toEqual([]);
    expect(confirmados(moras_historial)).toEqual([]);
    expect(estado.emitidos.some((e) => e.outcome === "failed" && e.operation === "process")).toBe(true);
  });

  it("el candado sigue vivo: cero filas del RETURNING → no se toca el status ni el historial y cuenta como omitido", async () => {
    estado.updateMorasReturns = [[]];

    const r = await correr(true);

    expect(confirmados(creditos)).toEqual([]);
    expect(confirmados(moras_historial)).toEqual([]);
    expect(r.recalculadas).toBe(0);
    expect(succeededCount()).toBe(0);
    expect(skippedCount()).toBe(1);
  });

  // ── El crédito dejó de ser elegible a media corrida ──────────────────────
  // El candado de la mora solo ve a quien toca `moras_credito`. Una transición
  // de estado que NO la toca —`marcarCreditoComoCaido`, por ejemplo— se le pasa
  // por debajo: la mora seguía activa, el update de la mora devolvía su fila y
  // la transacción confirmaba un monto recalculado y un evento RECALCULO sobre
  // un crédito CAIDO. El paso 6 tampoco lo recoge: su mapa `moraPorCredito`
  // viene de la foto vieja y todavía contiene el crédito.
  it("si el crédito dejó de ser elegible (cero filas en el update de status), NO queda la mora recalculada ni el historial", async () => {
    estado.updateCreditosReturns = [[]];

    const r = await correr(true);

    // 🔴 Lo que el defecto dejaba escrito: el monto nuevo cobrándose sobre un
    // crédito excluido de la mora, con su RECALCULO en el historial.
    expect(confirmados(moras_credito)).toEqual([]);
    expect(confirmados(moras_historial)).toEqual([]);
    expect(confirmados(creditos)).toEqual([]);
    expect(r.recalculadas).toBe(0);
  });

  it("ese crédito cuenta como omitido y el cron NO falla: la corrida sigue", async () => {
    estado.updateCreditosReturns = [[]];

    await correr(true);

    expect(succeededCount()).toBe(0);
    expect(skippedCount()).toBe(1);
    // El aborto es una omisión esperada, no un fallo del cron.
    expect(estado.emitidos.some((e) => e.outcome === "failed")).toBe(false);
  });
});
