import { describe, expect, it, mock, beforeEach } from "bun:test";

// ============================================================================
// Fake db para desactivarMoraSiCreditoAlDia
//
// El helper hace (en orden):
//   1. db.select(...).from(moras_credito).where(...)            → moras activas
//   2. db.select(...).from(creditos).where(...)                 → status del crédito
//   3. db.select(...).from(cuotas_credito).innerJoin(...).where → cuotas + hasPaidPayment
//   4. db.update(creditos).set(...).where(...)                  → MOROSO → ACTIVO
//   5. db.update(moras_credito).set(...).where(...).returning() → apagar mora
//   6. db.insert(moras_historial).values(...)                   → evento DESACTIVACION
//
// 🔒 El 4 va antes que el 5 por la regla de orden de candados del módulo
// (`creditos` antes que `moras_credito`); ver latefee.ts. Por eso la cola
// `updateReturningQueue` la consume SOLO el update de `moras_credito`: es el
// único con `.returning()`, y atarla al orden de llamada la haría frágil.
//
// La fake alimenta los SELECT por orden de llamada y graba todos los writes.
// ============================================================================

type SelectResult = any[];

const state: {
  selectQueue: SelectResult[];
  selectCalls: number;
  /**
   * Contra qué tabla se consumió cada entrada de `selectQueue`, EN ORDEN.
   *
   * ── Por qué hace falta ACÁ en particular ──────────────────────────────────
   * Este harness indexa con `state.selectQueue[state.selectCalls] ?? []`: si la
   * cola se corre un lugar, cada consulta recibe la respuesta de otra y la que
   * sobra recibe `[]`, sin una sola excepción. Se midió: quitándole a la cola
   * la entrada del crédito, las 8 pruebas de este archivo seguían en VERDE.
   *
   * Aseverar sobre `state.updates` / `state.inserts` no lo detecta: el orden y
   * el contenido de las ESCRITURAS los decide el flujo de control, no lo que
   * devuelven las LECTURAS. Esto es lo único que lo delata.
   */
  lecturas: Array<{ tabla: string; filas: any[] }>;
  updates: Array<{ table: any; set: any; returning: boolean }>;
  inserts: Array<{ table: any; values: any }>;
  updateReturningQueue: SelectResult[];
  failNextUpdate: boolean;
  failNextInsert: boolean;
} = {
  selectQueue: [],
  selectCalls: 0,
  lecturas: [],
  updates: [],
  inserts: [],
  updateReturningQueue: [],
  failNextUpdate: false,
  failNextInsert: false,
};

/** El nombre de la tabla que drizzle lleva adentro del objeto. */
const tablaDe = (t: any) =>
  t?.[Symbol.for("drizzle:Name")] ?? t?._?.name ?? "?";

const makeSelectChain = () => {
  const result = state.selectQueue[state.selectCalls] ?? [];
  state.selectCalls++;
  const chain: any = {
    // Contra qué tabla se consumió esta entrada de `selectQueue`. Ver el
    // comentario de `state.lecturas`.
    from: (tabla?: unknown) => {
      // Se anota la tabla JUNTO CON las filas que recibió. La tabla sola no
      // alcanza: el código lee siempre las mismas tablas en el mismo orden, así
      // que una cola corrida no la cambia. Lo que sí cambia es QUÉ le tocó a
      // cada una, y eso es la alineación.
      state.lecturas.push({ tabla: tablaDe(tabla), filas: result });
      return chain;
    },
    innerJoin: () => chain,
    where: () => Promise.resolve(result),
  };
  return chain;
};

const fakeDb = {
  // El helper agrupa sus writes en una transacción; la fake la ejecuta
  // inline sobre sí misma (suficiente para verificar orden y contenido).
  transaction: async (cb: (txm: any) => Promise<void>) => cb(fakeDb),
  select: () => makeSelectChain(),
  update: (table: any) => ({
    set: (setValues: any) => ({
      where: () => {
        if (state.failNextUpdate) {
          state.failNextUpdate = false;
          // Revienta lo mismo si se espera el update directo (el de `creditos`)
          // o su `.returning()` (el de `moras_credito`).
          const failing: any = Promise.reject(new Error("db caída simulada"));
          // Sin esto bun reporta un rechazo no manejado cuando el camino usa
          // `.returning()` en vez de esperar la promesa de arriba.
          failing.catch(() => {});
          failing.returning = () =>
            Promise.reject(new Error("db caída simulada"));
          return failing;
        }
        const entry = { table, set: setValues, returning: false };
        state.updates.push(entry);
        // Solo el update de la mora usa `.returning()`; el del crédito no debe
        // comerse la fila que la prueba preparó para aquél.
        const rows =
          table === moras_credito ? state.updateReturningQueue.shift() ?? [] : [];
        const promise: any = Promise.resolve(rows);
        promise.returning = () => {
          entry.returning = true;
          return Promise.resolve(rows);
        };
        return promise;
      },
    }),
  }),
  insert: (table: any) => ({
    values: (values: any) => {
      if (state.failNextInsert) {
        state.failNextInsert = false;
        const caido: any = Promise.reject(new Error("historial caído simulado"));
        caido.catch(() => {});
        caido.returning = () =>
          Promise.reject(new Error("historial caído simulado"));
        return caido;
      }
      state.inserts.push({ table, values });
      // `registrarHistorialMora` pide `.returning({ historial_id })`: el id del
      // evento es lo que `registerPayment` necesita para ligar el DECREMENTO de
      // mora con su pago.
      return Object.assign(Promise.resolve([]), {
        returning: () => Promise.resolve([{ historial_id: 6101 }]),
      });
    },
  }),
};

mock.module("../database", () => ({ db: {}, client: {} }));

const { desactivarMoraSiCreditoAlDia } = await import("./latefee");
const { moras_credito, creditos, moras_historial } = await import(
  "../database/db/schema"
);

const correr = (credito_id: number) =>
  desactivarMoraSiCreditoAlDia(credito_id, { dbClient: fakeDb as any });

const MORA_ACTIVA = {
  mora_id: 95201,
  credito_id: 8685,
  monto_mora: "1286.34",
  cuotas_atrasadas: 1,
  porcentaje_mora: "1.12",
};

const CREDITO_MOROSO = { statusCredit: "MOROSO", capital: "114160.35" };

// Cuota ya validada hoy (pagada) + resto de cuotas al día → 0 vencidas
const CUOTAS_AL_DIA = [
  {
    fecha_vencimiento: new Date("2026-07-15T06:00:00.000Z"),
    pagado: true,
    hasPaidPayment: true,
    statusCredit: "MOROSO",
  },
  {
    fecha_vencimiento: new Date("2099-01-15T06:00:00.000Z"),
    pagado: false,
    hasPaidPayment: false,
    statusCredit: "MOROSO",
  },
];

// Una cuota vieja sigue impaga y sin pago validado → 1 vencida
const CUOTAS_CON_ATRASO = [
  {
    fecha_vencimiento: new Date("2026-06-15T06:00:00.000Z"),
    pagado: false,
    hasPaidPayment: false,
    statusCredit: "MOROSO",
  },
  ...CUOTAS_AL_DIA,
];

beforeEach(() => {
  state.selectQueue = [];
  state.lecturas = [];
  state.selectCalls = 0;
  state.updates = [];
  state.inserts = [];
  state.updateReturningQueue = [];
  state.failNextUpdate = false;
  state.failNextInsert = false;
});

describe("desactivarMoraSiCreditoAlDia", () => {
  it("apaga la mora, baja MOROSO→ACTIVO y registra DESACTIVACION cuando el crédito queda al día", async () => {
    state.selectQueue = [[MORA_ACTIVA], [CREDITO_MOROSO], CUOTAS_AL_DIA];
    state.updateReturningQueue = [[{ mora_id: 95201 }]];

    const result = await correr(8685);

    expect(result.desactivada).toBe(true);

    // ── LA ALINEACIÓN DE LA COLA ────────────────────────────────────────────
    // Cada entrada de `selectQueue` contra la tabla que de verdad la consumió.
    // Es la única aserción de este archivo que se pone roja si la cola se
    // corre: se midió quitándole la entrada del crédito y las 8 pruebas
    // seguían en verde, porque el harness rellena con `[]` en silencio y el
    // resto asevera sobre las ESCRITURAS, cuyo orden decide el flujo de
    // control y no las lecturas.
    //
    // 🔒 Y de paso fija el ORDEN DE CANDADOS del módulo (ver el bloque al
    // inicio de `latefee.ts`): `creditos` antes que `moras_credito` para quien
    // escribe. Acá se LEE la mora primero —sin candado— y se toma el crédito
    // después; si alguien invirtiera las escrituras, esta traza lo muestra.
    expect(state.lecturas).toEqual([
      { tabla: "moras_credito", filas: [MORA_ACTIVA] }, // la mora activa
      { tabla: "creditos", filas: [CREDITO_MOROSO] }, // ¿está MOROSO?
      { tabla: "cuotas_credito", filas: CUOTAS_AL_DIA }, // ¿queda alguna vencida?
    ]);

    // Update 1: la mora queda en 0 e inactiva
    const moraUpdate = state.updates.find((u) => u.table === moras_credito);
    expect(moraUpdate).toBeDefined();
    expect(moraUpdate!.set).toMatchObject({
      monto_mora: "0",
      cuotas_atrasadas: 0,
      activa: false,
    });
    expect(moraUpdate!.returning).toBe(true);

    // Update 2: el crédito baja a ACTIVO
    const statusUpdate = state.updates.find((u) => u.table === creditos);
    expect(statusUpdate).toBeDefined();
    expect(statusUpdate!.set).toEqual({ statusCredit: "ACTIVO" });

    // Historial: evento DESACTIVACION con el monto anterior real
    const historial = state.inserts.find((i) => i.table === moras_historial);
    expect(historial).toBeDefined();
    expect(historial!.values).toMatchObject({
      credito_id: 8685,
      mora_id: 95201,
      tipo_evento: "DESACTIVACION",
      monto_anterior: "1286.34",
      monto_nuevo: "0",
    });
  });

  it("no toca nada cuando el crédito aún tiene cuotas vencidas sin validar", async () => {
    state.selectQueue = [[MORA_ACTIVA], [CREDITO_MOROSO], CUOTAS_CON_ATRASO];

    const result = await correr(8685);

    expect(result.desactivada).toBe(false);
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("sale temprano sin consultar cuotas cuando no hay mora activa", async () => {
    state.selectQueue = [[]];

    const result = await correr(8685);

    expect(result.desactivada).toBe(false);
    expect(state.selectCalls).toBe(1);
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("no baja el status cuando el crédito no está MOROSO (p.ej. EN_CONVENIO)", async () => {
    state.selectQueue = [
      [MORA_ACTIVA],
      [{ statusCredit: "EN_CONVENIO", capital: "114160.35" }],
      // EN_CONVENIO está excluido de mora → sus cuotas no cuentan como vencidas
      CUOTAS_AL_DIA.map((c) => ({ ...c, statusCredit: "EN_CONVENIO" })),
    ];
    state.updateReturningQueue = [[{ mora_id: 95201 }]];

    const result = await correr(8685);

    expect(result.desactivada).toBe(true);
    const statusUpdate = state.updates.find((u) => u.table === creditos);
    expect(statusUpdate).toBeUndefined();
  });

  it("no duplica el historial si el cron ya había apagado la mora (update condicional no afecta filas)", async () => {
    state.selectQueue = [[MORA_ACTIVA], [CREDITO_MOROSO], CUOTAS_AL_DIA];
    state.updateReturningQueue = [[]]; // returning vacío: otra corrida ganó la carrera

    const result = await correr(8685);

    expect(result.desactivada).toBe(false);
    expect(state.inserts).toHaveLength(0);
  });

  it("nunca lanza: un error de db se reporta en el resultado sin romper la validación del pago", async () => {
    state.selectQueue = [[MORA_ACTIVA], [CREDITO_MOROSO], CUOTAS_AL_DIA];
    state.failNextUpdate = true;

    const result = await correr(8685);

    expect(result.desactivada).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("si el historial falla, la limpieza se revierte y NO se reporta éxito fantasma", async () => {
    // Dentro de la tx real, un insert fallido aborta la transacción: el COMMIT
    // se vuelve rollback. El helper debe reportar desactivada:false + error,
    // nunca un éxito que no persistió.
    state.selectQueue = [[MORA_ACTIVA], [CREDITO_MOROSO], CUOTAS_AL_DIA];
    state.updateReturningQueue = [[{ mora_id: 95201 }]];
    state.failNextInsert = true;

    const result = await correr(8685);

    expect(result.desactivada).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("apaga la mora aunque queden vencidas si el capital llegó a 0 (espejo sinCapital del cron)", async () => {
    state.selectQueue = [
      [MORA_ACTIVA],
      [{ statusCredit: "MOROSO", capital: "0.00" }],
      CUOTAS_CON_ATRASO,
    ];
    state.updateReturningQueue = [[{ mora_id: 95201 }]];

    const result = await correr(8685);

    expect(result.desactivada).toBe(true);
    const historial = state.inserts.find((i) => i.table === moras_historial);
    expect(historial).toBeDefined();
    expect(historial!.values).toMatchObject({
      motivo: "Crédito sin capital — no aplica mora",
    });
    const statusUpdate = state.updates.find((u) => u.table === creditos);
    expect(statusUpdate).toBeDefined();
  });
});
