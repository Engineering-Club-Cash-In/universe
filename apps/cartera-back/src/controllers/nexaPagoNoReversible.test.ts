import { beforeEach, describe, expect, mock, test } from "bun:test";

process.env.SUPABASE_DB_URL ??= "postgresql://127.0.0.1:1/synthetic";
process.env.RESEND_API_KEY ??= "synthetic-test-key";
process.env.EMAIL_DOMAIN ??= "example.invalid";

const {
  NEXA_PAYMENT_NOT_REVERSIBLE_CODE,
  NEXA_PAYMENT_NOT_REVERSIBLE_MESSAGE,
  NexaPaymentNotReversibleError,
  pagoEntroPorNexa,
  pagoNexaBloqueaAnular,
  rechazarSiPagoEsNexa,
} = await import("./nexaPagoNoReversible");
const { createReversePayment } = await import("./reversePayment");
const { createRevertPaymentToPending } = await import("./revertPaymentToPending");

const textoSql = (q: any): string =>
  (q?.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join("") : "")).join("?");

/** La lectura del status del evento Nexa; undefined = no hay evento. */
function lecturaEvento(status: string | undefined, lecturas: string[] = []) {
  return async (q: any) => {
    if (!/SELECT status FROM cartera\.nexa_payment_events/.test(textoSql(q))) {
      throw new Error(`execute inesperado: ${textoSql(q)}`);
    }
    lecturas.push("evento");
    return { rows: status === undefined ? [] : [{ status }], rowCount: status === undefined ? 0 : 1 };
  };
}

function ejecutorConFila(fila: Record<string, unknown> | undefined, eventoStatus: string | undefined = "applied") {
  return {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(fila ? [fila] : []) }) }),
    }),
    execute: lecturaEvento(eventoStatus),
  } as any;
}

describe("pagoEntroPorNexa", () => {
  test("fila con nexa_payment_event_id -> true", async () => {
    expect(await pagoEntroPorNexa({ credito_id: 1, pago_id: 2 }, ejecutorConFila({ nexaPaymentEventId: 9 }))).toBe(true);
  });
  test("pago manual (NULL) o inexistente -> false", async () => {
    expect(await pagoEntroPorNexa({ credito_id: 1, pago_id: 2 }, ejecutorConFila({ nexaPaymentEventId: null }))).toBe(false);
    expect(await pagoEntroPorNexa({ credito_id: 1, pago_id: 2 }, ejecutorConFila(undefined))).toBe(false);
  });
  test("rechazarSiPagoEsNexa tira el error de negocio 409", async () => {
    const error = await rechazarSiPagoEsNexa({ credito_id: 1, pago_id: 2 }, ejecutorConFila({ nexaPaymentEventId: 9 })).catch((e) => e);
    expect(error).toBeInstanceOf(NexaPaymentNotReversibleError);
    expect(error.status).toBe(409);
    expect(error.code).toBe("nexa_payment_not_reversible");
    expect(error.message).toBe("Este pago entró por Nexa y no se puede anular.");
  });
  test("rechazarSiPagoEsNexa deja pasar la fila de un evento failed (Nexa devolvió el dinero)", async () => {
    await expect(rechazarSiPagoEsNexa({ credito_id: 1, pago_id: 2 }, ejecutorConFila({ nexaPaymentEventId: 9 }, "failed")))
      .resolves.toBeUndefined();
  });
});

describe("pagoNexaBloqueaAnular", () => {
  test("pago manual: no bloquea y ni lee el evento", async () => {
    const lecturas: string[] = [];
    expect(await pagoNexaBloqueaAnular({ execute: lecturaEvento("applied", lecturas) } as any, null)).toBe(false);
    expect(lecturas).toEqual([]);
  });
  test("solo un evento failed deja anular; aceptado, incierto o inexistente bloquea", async () => {
    const bloquea = (status: string | undefined) => pagoNexaBloqueaAnular({ execute: lecturaEvento(status) } as any, 9);
    expect(await bloquea("failed")).toBe(false);
    for (const status of ["processing", "manual_review", "applied", "billing_pending", "billing_running", "billing_unknown", "billing_failed", "billed", undefined]) {
      expect(await bloquea(status)).toBe(true);
    }
  });
});

const esperado = {
  success: false,
  code: NEXA_PAYMENT_NOT_REVERSIBLE_CODE,
  message: NEXA_PAYMENT_NOT_REVERSIBLE_MESSAGE,
};

describe("reversePayment", () => {
  const transaction = mock(() => Promise.reject(new Error("no debe abrirse")));
  const lock = mock(() => Promise.reject(new Error("no debe tomarse")));
  const handler = createReversePayment({
    runTransaction: transaction as any,
    withCreditLock: lock as any,
    reverseInvestors: mock() as any,
    reverseCapitalPayment: mock() as any,
    refrescarProyeccion: mock() as any,
    restituirMora: mock() as any,
    rechazarSiPagoEsNexa: (async () => {
      throw new NexaPaymentNotReversibleError();
    }) as any,
  });
  beforeEach(() => {
    transaction.mockClear();
    lock.mockClear();
  });

  test("pago Nexa -> 409 sin candado ni transacción", async () => {
    const set: any = {};
    const res = await handler({ body: { credito_id: 1, pago_id: 2 }, set, telemetryLogger: { info() {}, warn() {}, error() {} } });
    expect(set.status).toBe(409);
    expect(res as unknown).toEqual(esperado);
    expect(lock).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("revertPaymentToPending", () => {
  const transaction = mock(() => Promise.reject(new Error("no debe abrirse")));
  const lock = mock(() => Promise.reject(new Error("no debe tomarse")));
  const emitted: unknown[] = [];
  const handler = createRevertPaymentToPending({
    runTransaction: transaction as any,
    withCreditLock: lock as any,
    reverseInvestors: mock() as any,
    voidInvoice: mock() as any,
    setCapitalSource: mock() as any,
    emitTerminal: ((e: unknown) => emitted.push(e)) as any,
    rechazarSiPagoEsNexa: (async () => {
      throw new NexaPaymentNotReversibleError();
    }) as any,
  });

  test("pago Nexa -> 409 sin candado ni transacción", async () => {
    const set: any = {};
    const res = await handler({ body: { credito_id: 1, pago_id: 2 }, set });
    expect(set.status).toBe(409);
    expect(res as unknown).toEqual(esperado);
    expect(lock).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(emitted).toEqual([expect.objectContaining({ outcome: "rejected" })]);
  });
});

// Carrera: la lectura previa (sin candado) ve un pago manual, pero cuando la
// reversa entra al candado un callback Nexa ya marcó la fila. El re-chequeo
// dentro de la transacción tiene que frenarla antes de escribir.
function txConPagoYaNexa(escrituras: string[], eventoStatus = "applied") {
  const fila = { pago_id: 2, credito_id: 1, nexaPaymentEventId: 9, validationStatus: "validated", paymentFalse: false };
  const sel: any = {
    from: () => sel, where: () => sel, innerJoin: () => sel, leftJoin: () => sel, orderBy: () => sel, for: () => sel,
    limit: () => sel,
    then: (res: any, rej: any) => Promise.resolve([fila]).then(res, rej),
  };
  const escribe = (tipo: string) => () => {
    escrituras.push(tipo);
    const b: any = { set: () => b, values: () => b, where: () => b, returning: () => Promise.resolve([]), then: (res: any) => Promise.resolve({ rowCount: 1 }).then(res) };
    return b;
  };
  return { select: () => sel, update: escribe("update"), insert: escribe("insert"), delete: escribe("delete"), execute: lecturaEvento(eventoStatus) } as any;
}

describe("re-chequeo bajo el candado", () => {
  const sinNexaAntes = (async () => {}) as any;

  test("reversePayment: 409 y nada escrito", async () => {
    const escrituras: string[] = [];
    let transacciones = 0;
    const handler = createReversePayment({
      runTransaction: (async (fn: any) => (transacciones++, fn(txConPagoYaNexa(escrituras)))) as any,
      withCreditLock: (async (_id: number, fn: any) => fn()) as any,
      reverseInvestors: mock() as any,
      reverseCapitalPayment: mock() as any,
      refrescarProyeccion: mock() as any,
      restituirMora: mock() as any,
      rechazarSiPagoEsNexa: sinNexaAntes,
    });
    const set: any = {};
    const res = await handler({ body: { credito_id: 1, pago_id: 2 }, set, telemetryLogger: { info() {}, warn() {}, error() {} } });
    expect(transacciones).toBe(1);
    expect(set.status).toBe(409);
    expect(res as unknown).toEqual(esperado);
    expect(escrituras).toEqual([]);
  });

  test("revertPaymentToPending: 409 y nada escrito", async () => {
    const escrituras: string[] = [];
    let transacciones = 0;
    const handler = createRevertPaymentToPending({
      runTransaction: (async (fn: any) => (transacciones++, fn(txConPagoYaNexa(escrituras)))) as any,
      withCreditLock: (async (_id: number, fn: any) => fn()) as any,
      reverseInvestors: mock() as any,
      voidInvoice: mock() as any,
      setCapitalSource: mock() as any,
      emitTerminal: (() => {}) as any,
      rechazarSiPagoEsNexa: sinNexaAntes,
    });
    const set: any = {};
    const res = await handler({ body: { credito_id: 1, pago_id: 2 }, set });
    expect(transacciones).toBe(1);
    expect(set.status).toBe(409);
    expect(res as unknown).toEqual(esperado);
    expect(escrituras).toEqual([]);
  });

  test("falsePayment (anularPagoYRestituirMoraSerializado): error 409 bajo el candado y nada escrito", async () => {
    const { anularPagoYRestituirMoraSerializado, anularPagoYRestituirMora } = await import("./anularPagoMora");
    const escrituras: string[] = [];
    const llamadas: string[] = [];
    const deps = {
      updateMora: (async () => (llamadas.push("updateMora"), { success: true })) as any,
      resetAjusteFechaIdeal: (async () => { llamadas.push("reset"); }) as any,
      revertirRubros: (async () => (llamadas.push("rubros"), [])) as any,
    };
    let candado = 0;
    const error = await anularPagoYRestituirMoraSerializado({ pago_id: 2, credito_id: 1 }, {
      withCreditLock: (async (_id: number, fn: any) => (candado++, fn())) as any,
      runTransaction: (async (fn: any) => fn(txConPagoYaNexa(escrituras))) as any,
      anular: ((tx: any, ids: any) => anularPagoYRestituirMora(tx, ids, deps)) as any,
    }).catch((e) => e);
    expect(candado).toBe(1);
    expect(error).toBeInstanceOf(NexaPaymentNotReversibleError);
    expect(error.status).toBe(409);
    expect(escrituras).toEqual([]);
    expect(llamadas).toEqual([]);
  });
});
