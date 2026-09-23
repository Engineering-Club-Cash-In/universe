/**
 * `updateMora` dentro de la transacción del CALLER.
 *
 * ── Por qué existe este archivo ─────────────────────────────────────────────
 * `falsePayment` marcaba la boleta como falsa (un commit) y DESPUÉS restituía
 * la mora con `updateMora` (otro commit). Los dos pasos sueltos dejaban un
 * agujero permanente: si la restitución fallaba, la anulación ya estaba firme
 * —lanzar no la deshace— y el reintento leía `paymentFalse = true`, con lo que
 * la regla devolvía `null` y la mora NO SE RESTITUÍA NUNCA. Boleta anulada,
 * crédito sin la mora que su cliente volvió a deber, para siempre.
 *
 * Lo que impedía unirlos era `updateMora`: abría su propia transacción. Ahora
 * acepta la del caller (`dbClient`) y corre adentro de ella. Estas pruebas
 * ejercen la función DE VERDAD contra una base falsa y verifican las tres
 * cosas de las que depende la atomicidad:
 *
 *   1. con `dbClient` NO abre transacción propia (si la abriera, commitearía
 *      sola y el rollback del caller no la alcanzaría);
 *   2. TODO —mora, crédito e historial— viaja por el cliente del caller;
 *   3. un fallo adentro se reporta (`success: false`) en vez de tragarse, que
 *      es lo que le permite al caller abortar.
 *
 * `falsePayment` mismo no se puede importar: varios tests de la suite
 * registran `mock.module("./payments")` global y el módulo real desaparece en
 * la corrida completa. El cableado se verifica sobre el texto de la función en
 * `utils/restitucionMoraDePago.test.ts`; lo que se ejerce acá es el
 * mecanismo del que ese cableado depende.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

type Candado = { tabla: any; via: "update" | "insert" | "for update" };

const estado: {
  selects: any[][];
  candados: Candado[];
  inserts: Array<{ tabla: any; values: any }>;
  transaccionesAbiertas: number;
  /** Tabla cuyo INSERT debe reventar (para probar el camino del fallo). */
  insertQueFalla: any | null;
} = {
  selects: [],
  candados: [],
  inserts: [],
  transaccionesAbiertas: 0,
  insertQueFalla: null,
};

const clienteFalso = (marca: string): any => {
  const selectChain = () => {
    let tabla: any = null;
    const b: any = {
      from: (t: any) => ((tabla = t), b),
      innerJoin: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => b,
      for: () => {
        estado.candados.push({ tabla, via: "for update" });
        return b;
      },
      then: (res: any, rej: any) =>
        Promise.resolve(estado.selects.shift() ?? []).then(res, rej),
    };
    return b;
  };

  return {
    marca,
    select: () => selectChain(),
    insert: (tabla: any) => ({
      values: (values: any) => {
        const ejecutar = async () => {
          estado.candados.push({ tabla, via: "insert" });
          estado.inserts.push({ tabla, values });
          if (estado.insertQueFalla === tabla) {
            throw new Error("insert reventado a propósito");
          }
          return [{ mora_id: 999, porcentaje_mora: "1.12" }];
        };
        const b: any = {
          returning: () => ejecutar(),
          then: (res: any, rej: any) => ejecutar().then(() => []).then(res, rej),
        };
        return b;
      },
    }),
    update: (tabla: any) => ({
      set: () => {
        const ejecutar = () => {
          estado.candados.push({ tabla, via: "update" });
          return [
            {
              mora_id: 77,
              credito_id: CREDITO_ID,
              porcentaje_mora: "1.12",
              cuotas_atrasadas: 2,
            },
          ];
        };
        const b: any = {
          where: () => b,
          returning: () => Promise.resolve(ejecutar()),
          then: (res: any, rej: any) => {
            ejecutar();
            return Promise.resolve({ rowCount: 1 }).then(res, rej);
          },
        };
        return b;
      },
    }),
    transaction: async (cb: any) => {
      estado.transaccionesAbiertas++;
      return await cb(clienteFalso(`${marca}:tx`));
    },
  };
};

const dbFalsa = clienteFalso("db");

mock.module("../database", () => ({
  db: dbFalsa,
  client: { connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) },
  lockPool: {},
}));
mock.module("../utils/structuredLogger", () => ({ emitCreditLateFee: () => {} }));

const { updateMora } = await import("./latefee");
const { creditos, moras_credito, moras_historial } = await import(
  "../database/db/schema"
);

const CREDITO_ID = 4242;

/** Lo que consume `updateMora`: creditos FOR UPDATE y después la mora. */
const prepararSelects = () => {
  estado.selects = [
    [{ statusCredit: "MOROSO" }],
    [
      {
        id: 77,
        monto: "0.00",
        activa: false,
        porcentaje_mora: "1.12",
        cuotas_atrasadas: 2,
      },
    ],
  ];
};

const restituir = (dbClient?: any) =>
  updateMora({
    credito_id: CREDITO_ID,
    tipo: "INCREMENTO",
    monto_cambio: 100,
    activa: true,
    motivo: "Anulación de pago #301: la boleta resultó falsa",
    ...(dbClient ? { dbClient } : {}),
  });

beforeEach(() => {
  estado.selects = [];
  estado.candados = [];
  estado.inserts = [];
  estado.transaccionesAbiertas = 0;
  estado.insertQueFalla = null;
});

describe("updateMora con la transacción del caller", () => {
  it("NO abre una transacción propia: si la abriera, commitearía sola", async () => {
    prepararSelects();
    const tx = clienteFalso("tx-del-caller");

    const res = await restituir(tx);

    expect(res.success).toBe(true);
    // Cero transacciones nuevas: la única que hay es la del caller, que este
    // test representa con `tx`. Con un `db.transaction` adentro, el rollback
    // del caller ya no podría deshacer la restitución.
    expect(estado.transaccionesAbiertas).toBe(0);
  });

  it("sin `dbClient` sigue abriendo la suya (no se rompió a los demás callers)", async () => {
    prepararSelects();

    const res = await restituir();

    expect(res.success).toBe(true);
    expect(estado.transaccionesAbiertas).toBe(1);
  });

  it("el evento de moras_historial también va adentro de esa transacción", async () => {
    prepararSelects();
    const tx = clienteFalso("tx-del-caller");

    await restituir(tx);

    // Si el historial se escribiera por el `db` global quedaría firme aunque el
    // caller abortara: un INCREMENTO en el historial sin la mora que lo
    // respalda, justo lo que el reporte de recuperación lee.
    const eventos = estado.inserts.filter((i) => i.tabla === moras_historial);
    expect(eventos.length).toBe(1);
    expect(eventos[0]?.values.tipo_evento).toBe("INCREMENTO");
  });

  it("un fallo adentro NO se traga: devuelve success:false para que el caller aborte", async () => {
    prepararSelects();
    const tx = clienteFalso("tx-del-caller");
    estado.insertQueFalla = moras_historial;

    const res = await restituir(tx);

    // Sin esto, `falsePayment` commitearía la boleta falsa creyendo que la mora
    // se restituyó, cuando la tx está abortada y el COMMIT es un rollback.
    expect(res.success).toBe(false);
  });

  it("y sin mora que tocar tampoco miente: success:false", async () => {
    // La mora no existe (segundo SELECT vacío): es UNO de los dos casos que
    // dejaban la boleta anulada sin restitución para siempre.
    estado.selects = [[{ statusCredit: "MOROSO" }], []];
    const tx = clienteFalso("tx-del-caller");

    const res = await restituir(tx);

    expect(res.success).toBe(false);
    expect(estado.inserts.filter((i) => i.tabla === moras_historial).length).toBe(0);
  });

  it("🔒 el orden de candados no cambia por venir de afuera: creditos y después moras_credito", async () => {
    prepararSelects();
    const tx = clienteFalso("tx-del-caller");

    await restituir(tx);

    const primerCredito = estado.candados.findIndex((c) => c.tabla === creditos);
    const primeraMora = estado.candados.findIndex((c) => c.tabla === moras_credito);
    expect(primerCredito).toBeGreaterThan(-1);
    expect(primeraMora).toBeGreaterThan(-1);
    expect(primerCredito).toBeLessThan(primeraMora);
  });
});
