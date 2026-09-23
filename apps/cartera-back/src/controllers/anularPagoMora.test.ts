/**
 * Anular una boleta y devolverle su mora al crédito: UN SOLO HECHO.
 *
 * ── Los dos defectos que estas pruebas fijan ────────────────────────────────
 *
 * 1) NO ERA ATÓMICO. `falsePayment` marcaba el pago (`paymentFalse = true`) en
 *    un commit y restituía la mora en otro. Si la restitución fallaba, la
 *    anulación ya estaba firme —lanzar no la deshace— y el reintento leía
 *    `paymentFalse = true`, con lo que la regla devolvía `null` y la
 *    restitución quedaba saltada PARA SIEMPRE.
 *
 * 2) SOBRECOBRABA. Registrar un pago baja la mora en el acto, pero el criterio
 *    de cobertura del cron solo cuenta pagos `validated`/`no_required`: un pago
 *    que amanece `pending` deja su cuota contada como vencida y `procesarMoras`
 *    vuelve a FIJAR la mora completa. Sumarle después `pagos_credito.mora` al
 *    anular dejaba el doble (Q100 → Q0 → Q100 del cron → Q200).
 *
 * Se ejerce la función de verdad contra una base falsa: `updateMora` entra por
 * `deps` porque tres archivos de la suite lo mockean globalmente con
 * `mock.module("./latefee")` y la prueba no puede quedar a merced de cuál gane
 * la corrida.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { creditos, moras_historial, pagos_credito } from "../database/db/schema";
import { MOTIVO_ANULACION_MORA_PREFIJO } from "../utils/motivoReversaMora";

// El módulo arrastra `../database` (por `./latefee`), que exige la URL al
// cargarse. Se le da una inválida a propósito: nada de esta prueba toca la
// base —el `tx` y `updateMora` entran inyectados— y así no hace falta un
// `mock.module("../database")` más, que sería global a toda la corrida.
process.env.SUPABASE_DB_URL ??= "postgresql://nadie:nadie@127.0.0.1:1/ninguna";
const { anularPagoYRestituirMora } = await import("./anularPagoMora");

const PAGO_ID = 301;
const CREDITO_ID = 4242;
const AYER = new Date("2026-09-22T10:00:00.000Z");

type Llamada = { tabla: any; via: "select for update" | "select" | "update" };

const estado: {
  selects: any[][];
  llamadas: Llamada[];
  rowCount: number;
  updateMoraArgs: any[];
  updateMoraResultado: { success: boolean; message?: string };
  resets: number[];
  /** Las condiciones que recibió cada `.where()`, para poder mirarlas. */
  wheres: any[];
} = {
  selects: [],
  llamadas: [],
  rowCount: 1,
  updateMoraArgs: [],
  updateMoraResultado: { success: true },
  resets: [],
  wheres: [],
};

/**
 * Un `where` de drizzle es un árbol con los valores adentro; serializarlo deja
 * ver QUÉ filtra, que es lo único que una base falsa no evalúa por su cuenta.
 */
const textoDeCondicion = (cond: any) =>
  JSON.stringify(cond, (_k, v) =>
    typeof v === "object" && v !== null && "table" in v ? "<col>" : v,
  );

/** Un `tx` de drizzle lo bastante real para este camino. */
const txFalso: any = {
  select: () => {
    let tabla: any = null;
    let candado = false;
    const b: any = {
      from: (t: any) => ((tabla = t), b),
      where: (cond: any) => (estado.wheres.push(cond), b),
      limit: () => b,
      for: () => ((candado = true), b),
      then: (res: any, rej: any) => {
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
};

const deps = {
  updateMora: (async (args: any) => {
    estado.updateMoraArgs.push(args);
    return estado.updateMoraResultado;
  }) as any,
  resetAjusteFechaIdeal: (async (pago_id: number) => {
    estado.resets.push(pago_id);
  }) as any,
};

const anular = () =>
  anularPagoYRestituirMora(
    txFalso,
    { pago_id: PAGO_ID, credito_id: CREDITO_ID },
    deps,
  );

/**
 * Los SELECT que consume el camino, en orden: el crédito (candado), el pago y
 * los eventos automáticos del cron posteriores al pago.
 */
const prepararBase = ({
  pago,
  eventosDelCron = [],
  credito = [{ credito_id: CREDITO_ID }],
}: {
  pago: any[];
  eventosDelCron?: any[];
  credito?: any[];
}) => {
  estado.selects = [credito, pago, eventosDelCron];
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
  estado.wheres = [];
});

describe("anular la boleta y restituir su mora", () => {
  it("marca el pago y devuelve la mora que esa boleta había cobrado", async () => {
    prepararBase({ pago: PAGO_CON_MORA });

    const filas = await anular();

    expect(filas).toBe(1);
    expect(estado.llamadas.some((l) => l.tabla === pagos_credito && l.via === "update")).toBe(true);
    expect(estado.updateMoraArgs.length).toBe(1);
    expect(estado.updateMoraArgs[0].monto_cambio).toBe(100);
    expect(estado.updateMoraArgs[0].tipo).toBe("INCREMENTO");
    expect(estado.updateMoraArgs[0].motivo.startsWith(MOTIVO_ANULACION_MORA_PREFIJO)).toBe(true);
    // Y la restitución viaja por la MISMA transacción: sin esto commitearía
    // sola y el rollback del caller no la alcanzaría.
    expect(estado.updateMoraArgs[0].dbClient).toBe(txFalso);
  });

  it("si la restitución falla, TIRA: el pago no puede quedar marcado", async () => {
    prepararBase({ pago: PAGO_CON_MORA });
    estado.updateMoraResultado = { success: false, message: "mora no encontrada" };

    // Tirar es lo que aborta la transacción del caller y deja el pago SIN
    // marcar. Sin esto, la boleta quedaba anulada y la mora no volvía nunca:
    // el reintento leía `paymentFalse = true` y se saltaba la restitución.
    await expect(anular()).rejects.toThrow(
      "Error al restituir la mora del pago anulado",
    );
  });

  it("un reintento después de ese fallo vuelve a intentar LAS DOS cosas", async () => {
    // El rollback dejó el pago como estaba (`paymentFalse = false`), así que la
    // segunda pasada ve exactamente lo mismo que la primera y restituye.
    prepararBase({ pago: PAGO_CON_MORA });
    estado.updateMoraResultado = { success: false, message: "error transitorio" };
    await expect(anular()).rejects.toThrow();

    estado.llamadas = [];
    estado.updateMoraArgs = [];
    estado.updateMoraResultado = { success: true };
    prepararBase({ pago: PAGO_CON_MORA });

    await anular();

    expect(estado.updateMoraArgs.length).toBe(1);
    expect(estado.updateMoraArgs[0].monto_cambio).toBe(100);
    expect(estado.llamadas.some((l) => l.tabla === pagos_credito && l.via === "update")).toBe(true);
  });

  it("anular dos veces no restituye dos veces", async () => {
    // La boleta ya estaba falsa: el UPDATE pasa igual sobre ella y su rowCount
    // no distingue los dos casos, así que lo único que corta la repetición es
    // haber leído `paymentFalse` antes.
    prepararBase({
      pago: [{ mora: "100.00", paymentFalse: true, created_at: AYER }],
    });

    await anular();

    expect(estado.updateMoraArgs.length).toBe(0);
  });

  it("lee la fila del pago CON CANDADO (dos anulaciones simultáneas leían las dos `false`)", async () => {
    prepararBase({ pago: PAGO_CON_MORA });

    await anular();

    expect(
      estado.llamadas.some(
        (l) => l.tabla === pagos_credito && l.via === "select for update",
      ),
    ).toBe(true);
  });

  it("🔒 toma el candado de `creditos` antes de pedirle la mora a updateMora", async () => {
    prepararBase({ pago: PAGO_CON_MORA });

    await anular();

    // La regla del módulo (bloque al inicio de latefee.ts): creditos primero,
    // moras_credito después. `updateMora` toma la de la mora, así que su
    // llamada tiene que venir DESPUÉS del candado del crédito.
    const candadoCredito = estado.llamadas.findIndex(
      (l) => l.tabla === creditos && l.via === "select for update",
    );
    expect(candadoCredito).toBe(0);
    expect(estado.updateMoraArgs.length).toBe(1);
  });

  it("un pago sin mora no toca la mora del crédito", async () => {
    prepararBase({
      pago: [{ mora: "0.00", paymentFalse: false, created_at: AYER }],
    });

    await anular();

    expect(estado.updateMoraArgs.length).toBe(0);
    expect(estado.resets).toEqual([PAGO_ID]);
  });

  it("un pago que no existe no marca nada", async () => {
    prepararBase({ pago: [] });
    estado.rowCount = 0;

    await expect(anular()).rejects.toThrow("No payment found");
    expect(estado.updateMoraArgs.length).toBe(0);
  });

  it("un crédito que no existe tira ANTES de tocar el pago", async () => {
    prepararBase({ pago: PAGO_CON_MORA, credito: [] });

    await expect(anular()).rejects.toThrow("No payment found");
    expect(estado.llamadas.some((l) => l.tabla === pagos_credito)).toBe(false);
  });
});

describe("el pago pendiente que sobrevivió una corrida del cron", () => {
  it("si el cron ya repuso la mora, anular NO la suma otra vez", async () => {
    // Q100 de mora → el pago pendiente la baja a Q0 → el cron, que no cuenta
    // los pagos `pending` como cobertura, la vuelve a fijar en Q100 (CREACION)
    // → anular sumaba otros Q100 y el crédito quedaba en Q200.
    prepararBase({
      pago: PAGO_CON_MORA,
      eventosDelCron: [{ historial_id: 9001 }],
    });

    await anular();

    expect(estado.updateMoraArgs.length).toBe(0);
    // Pero la boleta SÍ queda anulada: lo que sobra es la restitución, no la
    // anulación.
    expect(
      estado.llamadas.some((l) => l.tabla === pagos_credito && l.via === "update"),
    ).toBe(true);
  });

  it("si el cron no pasó, restituye completa", async () => {
    prepararBase({ pago: PAGO_CON_MORA, eventosDelCron: [] });

    await anular();

    expect(estado.updateMoraArgs.length).toBe(1);
    expect(estado.updateMoraArgs[0].monto_cambio).toBe(100);
  });

  it("sin fecha en la fila del pago no se reconcilia: se restituye", async () => {
    // No se puede saber qué pasó después: el sobrecobro lo corrige el cron en
    // su próxima corrida, perderle la mora al crédito no lo corrige nadie.
    prepararBase({
      pago: [{ mora: "100.00", paymentFalse: false, created_at: null }],
      eventosDelCron: [{ historial_id: 9001 }],
    });

    await anular();

    expect(estado.updateMoraArgs.length).toBe(1);
    // Y ni siquiera se consulta el historial: sin ancla, la consulta no
    // significaría nada.
    expect(estado.llamadas.some((l) => l.tabla === moras_historial)).toBe(false);
  });

  it("consulta el historial del cron con candado del crédito ya tomado", async () => {
    prepararBase({ pago: PAGO_CON_MORA, eventosDelCron: [] });

    await anular();

    expect(estado.llamadas.some((l) => l.tabla === moras_historial)).toBe(true);
  });

  it("solo cuentan los eventos con los que el cron FIJA el monto", async () => {
    prepararBase({ pago: PAGO_CON_MORA, eventosDelCron: [] });

    await anular();

    const condicion = estado.wheres
      .map(textoDeCondicion)
      .find((t) => t.includes("PROCESO_AUTO"));
    expect(condicion).toBeDefined();
    // CREACION y RECALCULO son los dos con los que el cron REEMPLAZA el monto
    // desde la fórmula: son los que deshacen la bajada del pago.
    expect(condicion).toContain("CREACION");
    expect(condicion).toContain("RECALCULO");
    // Una DESACTIVACION es lo contrario —apagó la mora— y no repone nada:
    // contarla dejaría al crédito sin la mora que su cliente volvió a deber.
    expect(condicion).not.toContain("DESACTIVACION");
    // Y un ajuste manual tampoco es el cron.
    expect(condicion).not.toContain("API_MANUAL");
  });
});
