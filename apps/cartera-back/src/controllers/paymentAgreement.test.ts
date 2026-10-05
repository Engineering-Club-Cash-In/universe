import { beforeEach, describe, expect, it, mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";

// ── Mocks de infraestructura ────────────────────────────────────────────────
// El módulo bajo prueba arrastra la base de datos, el router y otros
// controllers; acá solo interesa el contrato prepare/commit del convenio.

/** Updates registrados: { tabla implícita por orden, values } */
const updates: Array<Record<string, unknown>> = [];
/**
 * Línea de tiempo de los statements que importan para el ORDEN: los UPDATE y
 * las lecturas con `FOR UPDATE` (la única del flujo es la de la mora, dentro de
 * `desactivarMoraPorConvenio`). Sirve para probar QUÉ fila se toma primero.
 */
const eventos: Array<
  | { tipo: "update" | "insert"; values: Record<string, unknown> }
  | { tipo: "select-for-update" }
> = [];
/** Cola de resultados para cada db.select() en orden de ejecución. */
let selectQueue: unknown[][] = [];
/**
 * El CAMINO DE LECTURAS: contra qué tabla se consumió cada entrada de
 * `selectQueue`, en orden.
 *
 * ── Qué vigila y qué NO ────────────────────────────────────────────────────
 * Vigila que el camino de lecturas del convenio no cambie sin que nadie se
 * entere, y de paso lo documenta en un solo lugar legible.
 *
 * NO es un detector de cola desalineada, y conviene decirlo porque es fácil
 * creer que sí: el código lee siempre las mismas tablas en el mismo orden, así
 * que correr la cola un lugar no cambia esta secuencia —solo cambia QUÉ filas
 * le tocan a cada una—. Para detectar eso haría falta parear tabla con filas,
 * como se hizo en `latefeeDesactivarMora.test.ts`.
 *
 * Acá no hizo falta: se midió que las aserciones que ya tenía este archivo SÍ
 * se ponen rojas con la cola corrida (11 de 23 en rojo), porque están pegadas
 * a los valores que salen de las lecturas —el email, el `credito_id`, los
 * montos de la mora—. Este rastro le agrega diagnóstico, no cobertura.
 */
let lecturas: string[] = [];

/** El nombre de la tabla que drizzle lleva adentro del objeto. */
const tablaDe = (t: any) =>
  t?.[Symbol.for("drizzle:Name")] ?? t?._?.name ?? "?";
/** Simula el update guardado del commit: false = 0 filas afectadas. */
let updateAffectsRows = true;
let updateResultQueue: boolean[] = [];

/** Inserts registrados: { values } en orden de ejecución. */
const inserts: Array<{ values: unknown }> = [];
/** Cola de resultados para cada db.insert().returning(). */
let insertReturnQueue: unknown[][] = [];
/** Cuántas veces se llamó db.delete() — el convenio ya no debe borrar mora. */
let deleteCalls = 0;
/**
 * Inserts que de verdad QUEDARON: los que corrieron fuera de transacción y los
 * de una transacción que commiteó. Los de una tx que revienta no entran — es
 * la diferencia entre "se intentó escribir" (`inserts`) y "quedó escrito".
 */
const insertsPersistidos: Array<{ values: unknown }> = [];
/** Pila de transacciones abiertas; cada una junta sus inserts hasta commitear. */
let pilaTx: Array<Array<{ values: unknown }>> = [];
/** Si devuelve true para esos values, ese insert revienta (historial caído). */
let insertFalla: ((values: Record<string, unknown>) => boolean) | null = null;
/** Transacciones que commitearon / que revirtieron. */
let commits = 0;
let rollbacks = 0;

const makeSelect = () => {
  const rows = selectQueue.shift() ?? [];
  const conChain: any = Object.assign(Promise.resolve(rows), {
    limit: () => Promise.resolve(rows),
    orderBy: () => ({ limit: () => Promise.resolve(rows) }),
    // `SELECT … FOR UPDATE`: así lee la mora desactivarMoraPorConvenio.
    for: () => {
      eventos.push({ tipo: "select-for-update" });
      return conChain;
    },
  });
  const fromChain: Record<string, unknown> = {
    where: () => conChain,
    innerJoin: () => fromChain,
    leftJoin: () => fromChain,
  };
  // La entrada de la cola ya se consumió arriba (en `makeSelect`), pero la
  // tabla recién se conoce acá. Drizzle siempre encadena `.from()` justo
  // después de `.select()`, así que el par queda 1:1 y en orden.
  return {
    from: (tabla?: unknown) => {
      lecturas.push(tablaDe(tabla));
      return fromChain;
    },
  };
};

const dbMock = {
  select: mock(() => makeSelect()),
  update: mock(() => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        updates.push(values);
        eventos.push({ tipo: "update", values });
        return Object.assign(Promise.resolve(), {
          returning: () =>
            Promise.resolve(
              (updateResultQueue.shift() ?? updateAffectsRows) ? [values] : []
            ),
        });
      },
    }),
  })),
  insert: mock(() => ({
    values: (values: unknown) => {
      const registro = { values };
      inserts.push(registro);
      eventos.push({ tipo: "insert", values: values as Record<string, unknown> });
      const abierta = pilaTx[pilaTx.length - 1];
      if (abierta) abierta.push(registro);
      else insertsPersistidos.push(registro);
      if (insertFalla?.(values as Record<string, unknown>)) {
        const caido = Promise.reject(new Error("historial caído simulado"));
        return Object.assign(caido, { returning: () => caido });
      }
      const rows = insertReturnQueue.shift() ?? [];
      return Object.assign(Promise.resolve(rows), {
        returning: () => Promise.resolve(rows),
      });
    },
  })),
  // Sigue existiendo para poder DETECTAR que alguien vuelva a usarlo: el
  // convenio ya no puede borrar filas de moras_credito.
  delete: mock(() => {
    deleteCalls++;
    return {
      where: () =>
        Object.assign(Promise.resolve([]), {
          returning: () => Promise.resolve([]),
        }),
    };
  }),
  // La tx reusa el mismo mock para las escrituras, pero SÍ modela el rollback:
  // lo escrito adentro de una transacción que revienta se descarta, igual que
  // en la base real. Es lo que permite probar que un convenio fallido NO queda
  // escrito — antes se escribía con `db` suelto y el rollback no lo alcanzaba.
  /**
   * SQL crudo (`tx.execute`). En el flujo del convenio corren tres:
   *  - el `pg_advisory_xact_lock` por crédito de COBROS-02 (no escribe nada);
   *  - la lectura del bucket al firmar (`bucketAntesDelConvenio`), que acá
   *    vuelve vacía → sin bucket → no se congela;
   *  - el UPDATE de EN_CONVENIO que además captura el estado previo
   *    (COBROS-02 Fase 4). Se registra como el `update` de status que antes
   *    era drizzle, y consume la cola de "afectó filas" igual que aquel
   *    `.returning()`, para que el ORDEN que vigilan estas pruebas se mida
   *    sobre el mismo statement.
   */
  execute: mock(async (query: unknown) => {
    const texto = new PgDialect().sqlToQuery(query as never).sql;
    if (/SET "statusCredit" = 'EN_CONVENIO'/.test(texto)) {
      const values = { statusCredit: "EN_CONVENIO" };
      updates.push(values);
      eventos.push({ tipo: "update", values });
      const afecta = updateResultQueue.shift() ?? updateAffectsRows;
      return {
        rows: afecta ? [{ previo: "MOROSO", statusCredit: "EN_CONVENIO" }] : [],
      };
    }
    return { rows: [] };
  }),
  transaction: mock(async (callback: (tx: unknown) => Promise<unknown>) => {
    const propios: Array<{ values: unknown }> = [];
    pilaTx.push(propios);
    try {
      const r = await callback(txMock);
      commits++;
      // Commit: lo de adentro pasa a la tx de afuera, o queda escrito.
      const padre = pilaTx[pilaTx.length - 2];
      if (padre) padre.push(...propios);
      else insertsPersistidos.push(...propios);
      return r;
    } catch (e) {
      // Rollback: nada de lo escrito adentro sobrevive.
      rollbacks++;
      throw e;
    } finally {
      pilaTx.pop();
    }
  }),
};

/**
 * La `tx` que recibe el callback: el mismo mock (las escrituras se registran
 * igual), pero su `.transaction` es un SAVEPOINT, como en drizzle — no abre
 * otra transacción ni cuenta en `dbMock.transaction`. COBROS-02 corre en
 * savepoint la lectura y el congelamiento del bucket al firmar.
 */
const txMock: any = {
  ...dbMock,
  transaction: mock(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback(txMock)
  ),
};

mock.module("../database", () => ({
  client: {},
  lockPool: { connect: mock(() => Promise.resolve({ query: mock(), release: mock() })) },
  db: dbMock,
}));

// Se parte del módulo REAL y solo se sustituye `createMora`, que es el único
// que toca la base. Listar los exports a mano hacía que el test reventara
// entero —sin un solo fallo con nombre, solo "0 pass / 1 fail"— cada vez que
// paymentAgreement.ts empezaba a importar algo nuevo de latefee: pasó al
// traerse TASA_MORA_MENSUAL y decidirMoraTrasRomperConvenio. Los helpers de
// latefee son puros, así que usar los de verdad además prueba más.
const latefeeReal = await import("./latefee");
mock.module("./latefee", () => ({
  ...latefeeReal,
  createMora: mock(() => Promise.resolve()),
}));
mock.module("./payments", () => ({
  getPagosDelMesActual: mock(() => Promise.resolve("0.00")),
}));
mock.module("../routers", () => ({ creditRouter: {} }));

const {
  prepararConvenioPayment,
  processConvenioPayment,
  processConvenioPaymentEnTx,
  createPaymentAgreement,
} = await import("./paymentAgreement");
const {
  convenio_cuotas,
  convenios_pago,
  creditos,
  cuotas_credito,
} = await import("../database/db");

// ── Fixtures ────────────────────────────────────────────────────────────────
// Números del caso real que motivó el cambio (convenio 102 / crédito 72,
// 26-ago-2026): 6 cuotas de 553.07, un pago real acreditado.
const convenioBase = {
  convenio_id: 102,
  credito_id: 72,
  monto_total_convenio: "3318.45",
  cuota_mensual: "553.07",
  monto_pagado: "553.07",
  monto_pendiente: "2765.38",
  pagos_realizados: 1,
  pagos_pendientes: 5,
  numero_meses: 6,
  completado: false,
  activo: true,
};

const paramsBase = {
  credito_id: 72,
  monto_pago: 1240.68,
  creditoInfo: {} as never,
  pagoMetadata: { montoBoleta: "1240.68", registerBy: 1 },
} as never;

beforeEach(() => {
  updates.length = 0;
  eventos.length = 0;
  inserts.length = 0;
  selectQueue = [];
  lecturas = [];
  insertReturnQueue = [];
  deleteCalls = 0;
  updateAffectsRows = true;
  updateResultQueue = [];
  insertsPersistidos.length = 0;
  pilaTx = [];
  insertFalla = null;
  commits = 0;
  rollbacks = 0;
  dbMock.transaction.mockClear();
});

describe("prepararConvenioPayment: calcular sin escribir", () => {
  it("no escribe NADA en la base — ni convenios_pago ni convenio_cuotas", async () => {
    selectQueue = [[{ ...convenioBase }]];

    const preparado = await prepararConvenioPayment(paramsBase);

    expect(preparado.commit).not.toBeNull();
    expect(updates).toHaveLength(0);
  });

  it("regresión convenio 102: N intentos rechazados (prepare sin commit) no inflan el convenio", async () => {
    // Antes del cambio, cada reintento rechazado por el guard
    // anti-sobreaplicación acreditaba 553.07 y una cuota fantasma: 4 retries
    // dejaron el convenio 5/6 con un solo pago real.
    for (let intento = 0; intento < 4; intento++) {
      selectQueue.push([{ ...convenioBase }]);
      await prepararConvenioPayment(paramsBase);
    }

    expect(updates).toHaveLength(0);
  });

  it("el preview topa el monto a la cuota mensual y proyecta los acumulados post-commit", async () => {
    selectQueue = [[{ ...convenioBase }]];

    const { resultado } = await prepararConvenioPayment(paramsBase);

    expect(resultado.success).toBe(true);
    expect(resultado.monto_aplicado).toBe("553.07");
    expect(resultado.pago_completo).toBe(true);
    expect(resultado.convenio?.monto_pagado).toBe("1106.14");
    expect(resultado.convenio?.monto_pendiente).toBe("2212.31");
    expect(resultado.convenio?.pagos_realizados).toBe(2);
    expect(resultado.convenio?.pagos_pendientes).toBe(4);
    expect(resultado.convenio?.completado).toBe(false);
    expect(resultado.convenio?.activo).toBe(true);
  });

  it("sin convenio activo: resultado success=false y commit null", async () => {
    selectQueue = [[]];

    const preparado = await prepararConvenioPayment(paramsBase);

    expect(preparado.commit).toBeNull();
    expect(preparado.resultado.success).toBe(false);
    expect(preparado.resultado.monto_aplicado).toBe("0");
    expect(updates).toHaveLength(0);
  });
});

describe("commit: persiste exactamente lo previsualizado", () => {
  it("acredita convenios_pago y marca la cuota completada del convenio", async () => {
    selectQueue = [
      [{ ...convenioBase }],
      // cuotas pendientes del convenio que el marcado va a consumir
      [{ cuota_convenio_id: 525, numero_cuota: 2 }],
    ];

    const { commit } = await prepararConvenioPayment(paramsBase);
    expect(await commit!(401)).toBe(true);

    expect(updates).toHaveLength(3);
    const [updConvenio, updPago, updCuotas] = updates;
    expect(updConvenio.monto_pagado).toBe("1106.14");
    expect(updConvenio.monto_pendiente).toBe("2212.31");
    expect(updConvenio.pagos_realizados).toBe(2);
    expect(updConvenio.pagos_pendientes).toBe(4);
    expect(updConvenio.completado).toBe(false);
    expect(updConvenio.activo).toBe(true);
    expect(updPago.pagoConvenio).toBe("553.07");
    expect(updCuotas.fecha_pago).toBeInstanceOf(Date);
  });

  it("pago parcial (no completa cuota): acredita el acumulado sin marcar cuotas", async () => {
    selectQueue = [[{ ...convenioBase }]];

    const { commit } = await prepararConvenioPayment({
      ...(paramsBase as Record<string, unknown>),
      monto_pago: 200,
    } as never);
    await commit!();

    expect(updates).toHaveLength(1);
    expect(updates[0].monto_pagado).toBe("753.07");
    expect(updates[0].pagos_realizados).toBe(1);
  });

  it("convenio cambiado entre prepare y commit (P2 Codex #1482): el update guardado no matchea y NO se marcan cuotas", async () => {
    selectQueue = [[{ ...convenioBase }]];

    const { commit } = await prepararConvenioPayment(paramsBase);
    // Otro escritor (updateConvenioStatus, reversa) tocó el convenio: el
    // update condicionado afecta 0 filas.
    updateAffectsRows = false;
    expect(await commit!(401)).toBe(false);

    // Solo el intento de acreditación: no estampa pagos_credito ni marca
    // convenio_cuotas, por lo que reversePayment no podrá restar un convenio
    // que este pago nunca acreditó.
    expect(updates).toHaveLength(1);
    expect(updates.some((values) => "pagoConvenio" in values)).toBe(false);
  });

  it("revierte la acreditación si la fila de pago a estampar ya no existe", async () => {
    selectQueue = [[{ ...convenioBase }]];
    const { commit } = await prepararConvenioPayment(paramsBase);
    updateResultQueue = [true, false];

    expect(commit!(401)).rejects.toThrow(
      "No se pudo estampar el convenio en el pago 401"
    );
    expect(updates).toHaveLength(2);
    expect(updates.some((values) => "fecha_pago" in values)).toBe(false);
  });

  it("última cuota: el commit cierra el convenio (completado=true, activo=false)", async () => {
    selectQueue = [
      [
        {
          ...convenioBase,
          monto_pagado: "2765.35",
          monto_pendiente: "553.10",
          pagos_realizados: 5,
          pagos_pendientes: 1,
        },
      ],
      [{ cuota_convenio_id: 529, numero_cuota: 6 }],
    ];

    const { resultado, commit } = await prepararConvenioPayment({
      ...(paramsBase as Record<string, unknown>),
      monto_pago: 553.1,
    } as never);
    await commit!();

    expect(resultado.convenio?.completado).toBe(true);
    expect(updates[0].completado).toBe(true);
    expect(updates[0].activo).toBe(false);
  });
});

describe("processConvenioPayment: wrapper calcular+commitear (comportamiento histórico)", () => {
  it("escribe en un solo paso lo mismo que prepare+commit", async () => {
    selectQueue = [
      [{ ...convenioBase }],
      [{ cuota_convenio_id: 525, numero_cuota: 2 }],
    ];

    const resultado = await processConvenioPayment(paramsBase);

    expect(resultado.success).toBe(true);
    expect(resultado.monto_aplicado).toBe("553.07");
    expect(updates).toHaveLength(2);
    expect(updates[0].pagos_realizados).toBe(2);
  });

  it("sin convenio activo no escribe nada", async () => {
    selectQueue = [[]];

    const resultado = await processConvenioPayment(paramsBase);

    expect(resultado.success).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

describe("createPaymentAgreement: la mora se desactiva, NO se borra", () => {
  // SELECTs en orden: usuario creador, pagos+cuotas, crédito, convenio activo,
  // cuotas pendientes del crédito y —ya dentro de desactivarMoraPorConvenio,
  // que acá corre DE VERDAD contra la base falsa— la mora activa.
  const armarBase = (moraActiva: unknown[] = [MORA_ACTIVA]) => {
    selectQueue = [
      [{ email: "asesor@clubcashin.com" }],
      [
        {
          pago: { pago_id: 401, credito_id: 72, pagado: false, monto_aplicado: "0" },
          cuota: { cuota_id: 900, credito_id: 72, numero_cuota: 3, pagado: false },
        },
      ],
      [{ credito_id: 72, statusCredit: "MOROSO" }],
      [],
      [{ fecha_vencimiento: new Date("2026-10-15T06:00:00.000Z") }],
      moraActiva,
    ];
    insertReturnQueue = [[{ convenio_id: 102, credito_id: 72 }]];
  };

  const MORA_ACTIVA = {
    mora_id: 95201,
    monto_mora: "1286.34",
    cuotas_atrasadas: 3,
    porcentaje_mora: "1.12",
  };

  const input = {
    credit_id: 72,
    payment_ids: [401],
    total_agreement_amount: 3318.45,
    number_of_months: 1,
    created_by: 41,
  };

  it("no ejecuta ningún DELETE contra la base", async () => {
    armarBase();

    const res = await createPaymentAgreement(input);

    expect(res.success).toBe(true);
    // Si vuelve el `db.delete(moras_credito)`, este contador sube.
    expect(deleteCalls).toBe(0);
  });

  it("apaga la mora y la deja anotada en el historial con el monto soltado", async () => {
    armarBase();

    await createPaymentAgreement(input);

    // ── EL CAMINO DE LECTURAS DEL CONVENIO, EN ORDEN ───────────────────────
    // Documenta el camino y lo congela: si alguien agrega o quita una lectura,
    // esto lo dice y señala dónde. (Que la cola esté BIEN ALINEADA lo cubren
    // las aserciones de más abajo, que están pegadas a los valores leídos.)
    expect(lecturas).toEqual([
      "platform_users", // quién crea el convenio (created_by)
      "pagos_credito", // los pagos que el convenio va a absorber
      "creditos", // el crédito, ya marcado EN_CONVENIO
      "convenios_pago", // ¿ya hay un convenio activo? (guard de duplicado)
      "cuotas_credito", // las cuotas sobre las que se arma el plan
      "moras_credito", // la mora a desactivar — FOR UPDATE, y ÚLTIMA
    ]);

    const updMora = updates.find((values) => values.activa === false);
    expect(updMora).toBeDefined();
    expect(updMora!.monto_mora).toBe("0");
    expect(updMora!.cuotas_atrasadas).toBe(0);

    const hist = inserts
      .map((i) => i.values as Record<string, unknown>)
      .find((values) => values.tipo_evento === "DESACTIVACION");
    expect(hist).toBeDefined();
    expect(hist!.credito_id).toBe(72);
    expect(hist!.monto_anterior).toBe("1286.34");
    expect(hist!.monto_nuevo).toBe("0");
    expect(hist!.usuario_id).toBe(41);
    expect(String(hist!.motivo)).toContain("convenio de pago");
    expect(String(hist!.motivo)).toContain("102");
  });

  it("sin mora activa el convenio se crea igual y no anota desactivaciones", async () => {
    armarBase([]);

    const res = await createPaymentAgreement(input);

    expect(res.success).toBe(true);
    expect(deleteCalls).toBe(0);
    expect(updates.some((values) => values.activa === false)).toBe(false);
    expect(
      inserts.some(
        (i) => (i.values as Record<string, unknown>).tipo_evento === "DESACTIVACION"
      )
    ).toBe(false);
  });

  /** ¿Ese insert es el del convenio? (es el único con monto_total_convenio) */
  const esConvenio = (i: { values: unknown }) =>
    "monto_total_convenio" in (i.values as Record<string, unknown>);

  // ── Convenio y desactivación, una sola transacción ───────────────────────
  it("la desactivación de la mora corre DENTRO de la transacción del convenio", async () => {
    armarBase();

    const res = await createPaymentAgreement(input);

    expect(res.success).toBe(true);
    // Una sola: si el helper abriera la suya (porque dejaron de pasarle el
    // dbClient de la tx del convenio), serían dos — y la desactivación podría
    // commitear por su cuenta mientras el convenio se revierte.
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
    expect(commits).toBe(1);
    expect(rollbacks).toBe(0);
  });

  // ── El crédito se toma ANTES de mirar la mora ────────────────────────────
  // Si el UPDATE de EN_CONVENIO vuelve a quedar DESPUÉS de la desactivación,
  // entre las dos la fila del crédito está libre: con el crédito sin mora
  // activa el `SELECT … FOR UPDATE` no bloquea ninguna fila y el cron puede
  // meterse por su rama CREACION, insertar una mora activa y commitear antes
  // de que el convenio marque EN_CONVENIO. Queda un crédito excluido de la
  // mora con un cargo activo encima.
  const indiceUpdateEstado = () =>
    eventos.findIndex(
      (e) => e.tipo === "update" && e.values.statusCredit === "EN_CONVENIO"
    );
  const indiceLecturaMora = () => eventos.findIndex((e) => e.tipo === "select-for-update");

  it("marca EN_CONVENIO (y con eso toma la fila del crédito) ANTES de leer la mora", async () => {
    armarBase();

    const res = await createPaymentAgreement(input);

    expect(res.success).toBe(true);
    expect(indiceUpdateEstado()).toBeGreaterThanOrEqual(0);
    expect(indiceLecturaMora()).toBeGreaterThanOrEqual(0);
    expect(indiceUpdateEstado()).toBeLessThan(indiceLecturaMora());
  });

  it("también lo toma primero cuando el crédito NO tiene mora activa (el caso que abría la ventana)", async () => {
    // Sin mora activa el FOR UPDATE no bloquea NADA: acá el orden es lo único
    // que impide que el cron se cuele.
    armarBase([]);

    const res = await createPaymentAgreement(input);

    expect(res.success).toBe(true);
    expect(indiceUpdateEstado()).toBeGreaterThanOrEqual(0);
    expect(indiceUpdateEstado()).toBeLessThan(indiceLecturaMora());
  });

  it("el candado se toma DENTRO de la transacción del convenio, no antes ni suelto", async () => {
    armarBase();

    const res = await createPaymentAgreement(input);

    expect(res.success).toBe(true);
    // Una sola transacción: si el UPDATE se hubiera adelantado FUERA de ella,
    // el estado quedaría commiteado aunque el convenio revierta.
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
    expect(commits).toBe(1);
    // Y adentro va DESPUÉS del insert del convenio: adelantarlo a antes de
    // abrir la transacción lo sacaría del alcance del rollback.
    const iConvenio = eventos.findIndex(
      (e) => e.tipo === "insert" && "monto_total_convenio" in e.values
    );
    expect(iConvenio).toBeGreaterThanOrEqual(0);
    expect(indiceUpdateEstado()).toBeGreaterThan(iConvenio);
  });

  it("si la transacción revienta, el EN_CONVENIO adelantado tampoco queda escrito", async () => {
    armarBase();
    insertFalla = (values) => values.tipo_evento === "DESACTIVACION";

    const res = await createPaymentAgreement(input);

    expect(res.success).toBe(false);
    // Se intentó...
    expect(updates.some((values) => values.statusCredit === "EN_CONVENIO")).toBe(true);
    // ...y el rollback se lo llevó junto con el convenio.
    expect(rollbacks).toBe(1);
    expect(commits).toBe(0);
    expect(insertsPersistidos.some(esConvenio)).toBe(false);
  });

  it("si falla el historial de la mora, el endpoint falla y NO queda convenio escrito", async () => {
    armarBase();
    insertFalla = (values) => values.tipo_evento === "DESACTIVACION";

    const res = await createPaymentAgreement(input);

    expect(res.success).toBe(false);
    expect(rollbacks).toBe(1);
    expect(commits).toBe(0);
    // Se INTENTÓ escribir el convenio...
    expect(inserts.some(esConvenio)).toBe(true);
    // ...pero la transacción lo revirtió: antes quedaba commiteado y el
    // endpoint respondía fallo con el convenio ya en la base.
    expect(insertsPersistidos.some(esConvenio)).toBe(false);
  });

  it("el reintento después de ese fallo no deja un convenio duplicado", async () => {
    armarBase();
    insertFalla = (values) => values.tipo_evento === "DESACTIVACION";
    expect((await createPaymentAgreement(input)).success).toBe(false);

    // Segundo intento, ya sin el historial caído. El chequeo de convenio
    // activo lo deja pasar (el primero no dejó fila), así que si el primero
    // hubiera quedado escrito ahora habría DOS convenios para el crédito 72.
    insertFalla = null;
    armarBase();
    const res = await createPaymentAgreement(input);

    expect(res.success).toBe(true);
    expect(insertsPersistidos.filter(esConvenio)).toHaveLength(1);
  });

  /** Captura lo que el convenio loguea, para revisar qué AFIRMA. */
  const capturarLogs = async (fn: () => Promise<unknown>) => {
    const real = console.log;
    const lineas: string[] = [];
    console.log = (...args: unknown[]) => {
      lineas.push(args.map((a) => String(a)).join(" "));
    };
    try {
      await fn();
    } finally {
      console.log = real;
    }
    return lineas.join("\n");
  };

  it("el log solo dice 'registrada en el historial' cuando de verdad se anotó", async () => {
    armarBase();

    const salida = await capturarLogs(() => createPaymentAgreement(input));

    expect(
      inserts.some(
        (i) => (i.values as Record<string, unknown>).tipo_evento === "DESACTIVACION"
      )
    ).toBe(true);
    expect(salida).toContain("registrada en el historial");
  });

  it("si otro convenio ganó la carrera, el log NO afirma que quedó registrada", async () => {
    armarBase();
    // Los updates del flujo, en orden: 1) el status del crédito a EN_CONVENIO
    // (que además hace de candado) y 2) el de moras_credito. Que el SEGUNDO
    // devuelva 0 filas = otra ejecución concurrente ya la apagó (y anotó ella
    // el evento).
    updateResultQueue = [true, false];

    const salida = await capturarLogs(() => createPaymentAgreement(input));

    expect(
      inserts.some(
        (i) => (i.values as Record<string, unknown>).tipo_evento === "DESACTIVACION"
      )
    ).toBe(false);
    expect(salida).not.toContain("registrada en el historial");
    // Y tampoco puede afirmar la causa que no verificó.
    expect(salida).not.toContain("No había moras activas para desactivar");
  });
});

// ── Suites de COBROS-02 ─────────────────────────────────────────────────────
// processConvenioPaymentEnTx recibe la tx por parámetro: estas pruebas le pasan
// su propio doble (`createTransaction`), independiente de `dbMock`.

type Row = Record<string, any>;

const state = {
  selects: new Map<any, Row[]>(),
  reads: [] as any[],
  updates: [] as Array<{ table: any; values: Row }>,
};

function createTransaction() {
  return {
    select() {
      let table: any;
      const builder: any = {
        from(value: any) {
          table = value;
          state.reads.push(value);
          return builder;
        },
        where() {
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit() {
          return Promise.resolve(state.selects.get(table) ?? []);
        },
      };
      return builder;
    },
    update(table: any) {
      return {
        set(values: Row) {
          state.updates.push({ table, values });
          return {
            where() {
              const selected = state.selects.get(table) ?? [];
              const rows = table === convenios_pago
                ? selected.map((row) => ({ ...row, ...values }))
                : [];
              const query: any = Promise.resolve(rows);
              query.returning = () => Promise.resolve(rows);
              return query;
            },
          };
        },
      };
    },
  };
}

let transactionExecutor = createTransaction();

const params = {
  credito_id: 10,
  monto_pago: 500,
  creditoInfo: {
    credito: {},
    inversionistas: [],
    cuotasPendientes: [],
  },
  pagoMetadata: {
    montoBoleta: "500.00",
    registerBy: 1,
  },
} as never;

const activeAgreement = {
  convenio_id: 77,
  credito_id: 10,
  monto_total_convenio: "1000.00",
  numero_meses: 2,
  cuota_mensual: "500.00",
  fecha_convenio: new Date("2026-01-01T00:00:00Z"),
  monto_pagado: "500.00",
  monto_pendiente: "500.00",
  pagos_realizados: 1,
  pagos_pendientes: 1,
  activo: true,
  completado: false,
  motivo: null,
  observaciones: null,
  cuotas_convenio: [101, 102],
  created_by: 1,
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-01T00:00:00Z"),
};

describe("processConvenioPaymentEnTx", () => {
  beforeEach(() => {
    state.selects.clear();
    state.reads.length = 0;
    state.updates.length = 0;
    dbMock.transaction.mockClear();
    transactionExecutor = createTransaction();
  });

  it("usa el tx inyectado y devuelve el resultado existente cuando no hay convenio activo", async () => {
    state.selects.set(convenios_pago, []);

    const result = await processConvenioPaymentEnTx(params, transactionExecutor as never);

    expect(result).toEqual({
      success: false,
      message: "No active payment agreement found for this credit",
      convenio: null,
      pago_completo: false,
      monto_aplicado: "0",
      monto_restante: "0",
    });
    expect(state.reads).toEqual([convenios_pago]);
    expect(state.updates).toHaveLength(0);
    expect(dbMock.transaction).toHaveBeenCalledTimes(0);
  });

  it("completa convenio y ejecuta todos los reads y writes con el tx inyectado", async () => {
    state.selects.set(convenios_pago, [activeAgreement]);
    state.selects.set(convenio_cuotas, [
      { cuota_convenio_id: 901, convenio_id: 77, numero_cuota: 2 },
    ]);

    const result = await processConvenioPaymentEnTx(params, transactionExecutor as never);

    expect(result).toMatchObject({
      success: true,
      message: "¡Convenio completado exitosamente!",
      convenio: {
        convenio_id: 77,
        monto_pagado: "1000.00",
        monto_pendiente: "0.00",
        pagos_realizados: 2,
        pagos_pendientes: 0,
        completado: true,
        activo: false,
      },
      pago_completo: true,
      monto_aplicado: "500.00",
      monto_restante: "0.00",
    });
    expect(state.reads).toEqual([convenios_pago, convenio_cuotas]);
    expect(state.updates.map(({ table }) => table)).toEqual([
      convenios_pago,
      cuotas_credito,
      creditos,
      convenio_cuotas,
    ]);
    expect(state.updates.find(({ table }) => table === cuotas_credito)?.values).toEqual({
      pagado: true,
    });
    expect(state.updates.find(({ table }) => table === creditos)?.values).toEqual({
      statusCredit: "ACTIVO",
    });
    expect(dbMock.transaction).toHaveBeenCalledTimes(0);
  });
});

describe("processConvenioPayment", () => {
  beforeEach(() => {
    state.selects.clear();
    state.reads.length = 0;
    state.updates.length = 0;
    dbMock.transaction.mockClear();
    transactionExecutor = createTransaction();
  });

  // Merge develop→COBROS-02: el wrapper que queda es el de develop
  // (prepararConvenioPayment + commit), no `db.transaction(EnTx)`. La
  // transacción que abre es la CHICA del commit: una, y solo cuando hay
  // convenio que acreditar (sin convenio no hay nada que escribir).
  it("abre exactamente una transacción", async () => {
    selectQueue = [
      [{ ...convenioBase }],
      [{ cuota_convenio_id: 525, numero_cuota: 2 }],
    ];

    const result = await processConvenioPayment(params);

    expect(result.success).toBe(true);
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
  });

  it("sin convenio activo no abre ninguna transacción", async () => {
    selectQueue = [[]];

    const result = await processConvenioPayment(params);

    expect(result.success).toBe(false);
    expect(dbMock.transaction).toHaveBeenCalledTimes(0);
  });
});

/**
 * El ORDEN dentro de `createPaymentAgreement`, que es lo que la Fase 2 promete:
 * el crédito se queda en el bucket que tenía AL FIRMAR.
 *
 * Ese bucket se deriva de la mora activa y del status del crédito, y los dos
 * pasos que siguen los destruyen —se borra la mora y el status pasa a
 * EN_CONVENIO—. Con la lectura al final (como estaba, review de Codex P2)
 * `bucketAntesDelConvenio` se quedaba sin sus dos primeras fuentes y devolvía
 * B0 para todo crédito sin historial previo: el "borrón y cuenta nueva" que
 * esta fase existe para impedir.
 *
 * Se afirma sobre la fuente porque el daño no se ve en el resultado de la
 * función —devuelve el convenio igual—, solo en qué bucket quedó escrito.
 */
describe("createPaymentAgreement: orden de la salida del régimen normal", () => {
  const fuente = require("node:fs").readFileSync(
    new URL("./paymentAgreement.ts", import.meta.url).pathname,
    "utf8",
  ) as string;
  const cuerpo = fuente.slice(
    fuente.indexOf("export async function createPaymentAgreement("),
  );

  // Merge develop→COBROS-02: la mora ya no se BORRA, se desactiva con rastro
  // (`desactivarMoraPorConvenio`, develop), y el status se cambia con el
  // UPDATE que captura el estado previo (Fase 4). Lo que se vigila es lo
  // mismo: la lectura del bucket va antes de las dos mutaciones.
  it("lee el bucket antes de desactivar la mora y de cambiar el status", () => {
    const lectura = cuerpo.indexOf("bucketAntesDelConvenio(");
    const borrado = cuerpo.indexOf("desactivarMoraPorConvenio(");
    const cambioStatus = cuerpo.indexOf(`SET "statusCredit" = 'EN_CONVENIO'`);

    expect(lectura).toBeGreaterThan(-1);
    expect(borrado).toBeGreaterThan(-1);
    expect(cambioStatus).toBeGreaterThan(-1);
    expect(lectura).toBeLessThan(borrado);
    expect(lectura).toBeLessThan(cambioStatus);
  });

  it("toma el lock por crédito antes de leer el bucket", () => {
    const lock = cuerpo.indexOf("pg_advisory_xact_lock");
    const lectura = cuerpo.indexOf("bucketAntesDelConvenio(");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(lectura);
  });
});
