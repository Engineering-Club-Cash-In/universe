/**
 * El evento de `moras_historial` viaja DENTRO de la transacción que mueve la
 * mora, también cuando `updateMora` abre la suya.
 *
 * ── Por qué existe este archivo ─────────────────────────────────────────────
 * `updateMoraEnTxDelCaller.test.ts` cubre el camino CON `dbClient` (la tx del
 * caller). El camino SUELTO —el de los pagos: `registerPayment` y
 * `payments`, que llaman sin `dbClient` y son la superficie más ancha— no
 * tenía red, y era justamente el roto: la mutación commiteaba y el INSERT del
 * historial salía DESPUÉS, por otra conexión del pool. Entre el COMMIT y ese
 * INSERT no hay candado; si ahí entra un convenio y desactiva la mora, el
 * convenio anota su DESACTIVACION primero y nuestro evento —más viejo— cae
 * después. `snapCte` reconstruye el saldo con el ÚLTIMO evento por crédito
 * (`ORDER BY h.fecha DESC, h.historial_id DESC`), así que Mora Histórica
 * mostraba mora viva sobre un crédito cuyo convenio ya la había apagado.
 *
 * Lo que se verifica acá es el hecho del que depende que el orden de los
 * eventos siga al orden de las mutaciones: QUIÉN escribe el evento y CUÁNDO.
 * El ejecutor es observable porque cada cliente falso lleva su `marca` y la
 * estampa en toda operación que ejecuta; el "cuándo" lo dan el BEGIN y el
 * COMMIT anotados en la misma lista ordenada.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

type Operacion = {
  /** Qué cliente ejecutó: el `db` global o el `tx` que abrió la transacción. */
  marca: string;
  tipo: "BEGIN" | "COMMIT" | "ROLLBACK" | "select" | "update" | "insert";
  tabla?: any;
};

const estado: {
  operaciones: Operacion[];
  selects: any[][];
  /** Tabla cuyo INSERT debe reventar (para probar el camino del fallo). */
  insertQueFalla: any | null;
} = { operaciones: [], selects: [], insertQueFalla: null };

const clienteFalso = (marca: string): any => ({
  marca,
  select: () => {
    let tabla: any = null;
    const b: any = {
      from: (t: any) => ((tabla = t), b),
      where: () => b,
      orderBy: () => b,
      limit: () => b,
      for: () => b,
      then: (res: any, rej: any) => {
        estado.operaciones.push({ marca, tipo: "select", tabla });
        return Promise.resolve(estado.selects.shift() ?? []).then(res, rej);
      },
    };
    return b;
  },
  insert: (tabla: any) => ({
    values: () => {
      const ejecutar = async () => {
        estado.operaciones.push({ marca, tipo: "insert", tabla });
        if (estado.insertQueFalla === tabla) {
          throw new Error("insert de historial reventado a propósito");
        }
        return [{ historial_id: 6001 }];
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
        estado.operaciones.push({ marca, tipo: "update", tabla });
        return [
          { mora_id: 77, credito_id: CREDITO_ID, porcentaje_mora: "1.12", cuotas_atrasadas: 2 },
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
  // Modela el BEGIN/COMMIT/ROLLBACK de verdad: el cuerpo corre con OTRO
  // cliente (otra `marca`), y si tira, lo escrito adentro se deshace.
  transaction: async (cb: any) => {
    estado.operaciones.push({ marca, tipo: "BEGIN" });
    try {
      const r = await cb(clienteFalso(`${marca}:tx`));
      estado.operaciones.push({ marca, tipo: "COMMIT" });
      return r;
    } catch (e) {
      estado.operaciones.push({ marca, tipo: "ROLLBACK" });
      throw e;
    }
  },
});

const dbFalsa = clienteFalso("db");

mock.module("../database", () => ({
  db: dbFalsa,
  client: { connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) },
  lockPool: {},
}));
mock.module("../utils/structuredLogger", () => ({ emitCreditLateFee: () => {} }));

const { updateMora } = await import("./latefee");
const { creditos, moras_credito, moras_historial } = await import("../database/db/schema");

const CREDITO_ID = 4242;

/** Lo que consume `updateMora`: creditos FOR UPDATE y después la mora activa. */
const prepararSelects = () => {
  estado.selects = [
    [{ statusCredit: "MOROSO" }],
    [{ id: 77, monto: "500.00", activa: true, porcentaje_mora: "1.12", cuotas_atrasadas: 2 }],
  ];
};

/** El camino de los pagos: SIN `dbClient`, `updateMora` abre la suya. */
const cobrarMora = () =>
  updateMora({
    credito_id: CREDITO_ID,
    tipo: "DECREMENTO",
    monto_cambio: 500,
    motivo: "Pago aplicado a mora: cubre la mora completa",
  });

const indiceDe = (p: (o: Operacion) => boolean) => estado.operaciones.findIndex(p);

beforeEach(() => {
  estado.operaciones = [];
  estado.selects = [];
  estado.insertQueFalla = null;
});

describe("updateMora sin dbClient: la bitácora va dentro de su transacción", () => {
  it("el evento lo escribe el MISMO ejecutor que movió la mora, no el `db` global", async () => {
    prepararSelects();

    const res = await cobrarMora();

    expect(res.success).toBe(true);
    const mutacion = estado.operaciones.find(
      (o) => o.tipo === "update" && o.tabla === moras_credito,
    );
    const evento = estado.operaciones.find(
      (o) => o.tipo === "insert" && o.tabla === moras_historial,
    );
    expect(mutacion).toBeDefined();
    expect(evento).toBeDefined();
    // Otra `marca` = otra conexión del pool. Por ahí salía el INSERT tardío
    // que un convenio concurrente podía adelantar.
    expect(evento!.marca).toBe(mutacion!.marca);
    expect(evento!.marca).not.toBe("db");
  });

  it("el evento se escribe ANTES del COMMIT, no después", async () => {
    prepararSelects();

    await cobrarMora();

    const evento = indiceDe((o) => o.tipo === "insert" && o.tabla === moras_historial);
    const commit = indiceDe((o) => o.tipo === "COMMIT");
    expect(evento).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(-1);
    // Es literalmente el hueco sin candado del defecto: todo lo que pase entre
    // el COMMIT y el INSERT puede anotar su propio evento antes que el nuestro.
    expect(evento).toBeLessThan(commit);
  });

  it("escribe un solo evento, con el tipo del ajuste", async () => {
    prepararSelects();

    const res: any = await cobrarMora();

    expect(estado.operaciones.filter((o) => o.tipo === "insert" && o.tabla === moras_historial))
      .toHaveLength(1);
    expect(res.historial_id).toBe(6001);
  });

  it("si el evento falla, la mutación de mora NO queda firme: ROLLBACK y success:false", async () => {
    // La decisión de diseño, hecha prueba: adentro de una transacción tragarse
    // el fallo sería MENTIROSO —Postgres aborta la tx igual, así que el UPDATE
    // se pierde— y `registerPayment` daría por cobrada una mora que sigue
    // viva. Se prefiere fallar ruidoso y reintentable.
    prepararSelects();
    estado.insertQueFalla = moras_historial;

    const res = await cobrarMora();

    expect(res.success).toBe(false);
    expect(indiceDe((o) => o.tipo === "ROLLBACK")).toBeGreaterThan(-1);
    expect(indiceDe((o) => o.tipo === "COMMIT")).toBe(-1);
  });

  it("🔒 el orden de candados sigue siendo creditos y después moras_credito", async () => {
    prepararSelects();

    await cobrarMora();

    const primerCredito = indiceDe((o) => o.tabla === creditos);
    const primeraMora = indiceDe((o) => o.tabla === moras_credito);
    expect(primerCredito).toBeGreaterThan(-1);
    expect(primeraMora).toBeGreaterThan(-1);
    expect(primerCredito).toBeLessThan(primeraMora);
  });

  it("sin mora que tocar no inventa evento", async () => {
    estado.selects = [[{ statusCredit: "MOROSO" }], []];

    const res = await cobrarMora();

    expect(res.success).toBe(false);
    expect(estado.operaciones.filter((o) => o.tabla === moras_historial)).toHaveLength(0);
  });
});
