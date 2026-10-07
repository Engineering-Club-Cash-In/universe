import { expect, spyOn, test } from "bun:test";
import type { PaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
import { CondonacionConservadaError, NexaPaymentError, processNexaPayment, type NexaPaymentDependencies } from "./nexaPayments";

// La saga de la condonación a tiempo dentro de processNexaPayment: condona
// antes de registrar; si el registro no termina en éxito decide por el estado
// observado (sin filas de pago del evento → anula; con filas → conserva); si
// no puede verificarlo, conserva y deja un log de error; y no vuelve a condonar
// cuando el pago ya existe.

const paymentLock = {} as PaymentAdvisoryLock;
const body = {
  externalReference: "ach-1",
  creditoId: 10,
  amount: "1000.00",
  currency: "GTQ" as const,
  tokenDate: "2026-10-07T00:00:00Z",
  token: "1111222233334444",
};
const context = { nonce: "n-1", payloadHash: "a".repeat(64), now: new Date() };

const crearDeps = (over: Partial<NexaPaymentDependencies> & { registrar?: boolean } = {}) => {
  const log: string[] = [];
  let registrado = false;
  const deps: NexaPaymentDependencies = {
    withCreditLock: async (_c, work) => work(paymentLock),
    claim: async () => ({ kind: "new", eventId: 7 }),
    loadCredit: async () => ({
      usuarioId: 5,
      statusCredit: "MOROSO",
      binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
    }),
    findPayments: async () => registrado
      ? [{ paymentId: 17, validationStatus: "pending", amount: "1000.00" }]
      : [],
    condonarMoraATiempo: async (_b, eventId) => { log.push(`condonar:${eventId}`); return { monto: "13.37" }; },
    anularCondonacionATiempo: async (eventId) => { log.push(`anular:${eventId}`); },
    registerPayment: async () => {
      log.push("registrar");
      registrado = over.registrar ?? true;
      return { success: true };
    },
    applyPayment: async () => { log.push("aplicar"); return { success: true }; },
    complete: async () => undefined,
    fail: async (_e, code) => { log.push(`fail:${code}`); },
    billPayments: async () => ({ kind: "billed" as const }),
    completeBilling: async () => undefined,
    failBilling: async () => undefined,
    ...over,
  };
  return { deps, log };
};

test("condona ANTES de registrar el pago, y no anula si el pago entra", async () => {
  const { deps, log } = crearDeps();
  const result = await processNexaPayment(body, context, deps);
  expect(result.paymentId).toBe(17);
  expect(log).toEqual(["condonar:7", "registrar", "aplicar"]);
});

test("rechazo definitivo del registro → anula la condonación del evento", async () => {
  const { deps, log } = crearDeps({
    registerPayment: async () => ({ success: false, code: "credit_not_payable", status: 409 }),
  });
  await expect(processNexaPayment(body, context, deps))
    .rejects.toEqual(new NexaPaymentError("credit_not_payable", 409));
  expect(log).toEqual(["condonar:7", "anular:7", "fail:credit_not_payable"]);
});

test("NexaPaymentError lanzado por el registro también es definitivo → anula", async () => {
  const { deps, log } = crearDeps({
    registerPayment: async () => { throw new NexaPaymentError("payment_date_required", 503); },
  });
  await expect(processNexaPayment(body, context, deps))
    .rejects.toEqual(new NexaPaymentError("payment_date_required", 503));
  expect(log).toContain("anular:7");
});

test("desenlace incierto SIN filas de pago (error genérico o respuesta vacía) → anula, y sigue incierto", async () => {
  for (const registerPayment of [
    async () => { throw new Error("db blip"); },
    async () => ({}),
    async () => ({ success: true }),
  ]) {
    const { deps, log } = crearDeps({ registerPayment, registrar: false });
    await expect(processNexaPayment(body, context, deps))
      .rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
    expect(log).toEqual(["condonar:7", "anular:7", "fail:payment_outcome_uncertain"]);
  }
});

test("error genérico pero el pago SÍ dejó filas → la condonación se conserva", async () => {
  const { deps, log } = crearDeps({
    registerPayment: async () => { throw new Error("db blip después del insert"); },
    findPayments: async () => log.includes("condonar:7")
      ? [{ paymentId: 17, validationStatus: "pending", amount: "1000.00" }]
      : [],
  });
  await expect(processNexaPayment(body, context, deps))
    .rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
  expect(log.some((l) => l.startsWith("anular"))).toBe(false);
  expect(log).toContain("fail:payment_outcome_uncertain");
});

test("si la consulta de filas falla tras el registro → conserva, log de error, y queda incierto", async () => {
  const errores = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    let consultas = 0;
    const { deps, log } = crearDeps({
      registerPayment: async () => { throw new Error("db blip"); },
      findPayments: async () => {
        consultas += 1;
        if (consultas > 1) throw new Error("db down");
        return [];
      },
    });
    await expect(processNexaPayment(body, context, deps))
      .rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
    expect(log.some((l) => l.startsWith("anular"))).toBe(false);
    expect(log).toContain("fail:payment_outcome_uncertain");
    const registro = JSON.parse(String(errores.mock.calls.at(-1)?.[0]));
    expect(registro).toMatchObject({
      level: "error",
      event: "nexa.condonacion_a_tiempo.viva_sin_verificar",
      paso: "consultar_filas_de_pago",
      nexa_payment_event_id: 7,
      credito_id: 10,
      monto_condonado: "13.37",
      error: "db down",
    });
  } finally {
    errores.mockRestore();
  }
});

test("si la anulación falla, el evento queda incierto (revisión manual), no como rechazo", async () => {
  const { deps, log } = crearDeps({
    registerPayment: async () => ({ success: false, code: "credit_not_payable", status: 409 }),
    anularCondonacionATiempo: async () => { throw new Error("db down"); },
  });
  const errores = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await expect(processNexaPayment(body, context, deps))
      .rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
    expect(log).toContain("fail:payment_outcome_uncertain");
    expect(JSON.parse(String(errores.mock.calls.at(-1)?.[0]))).toMatchObject({
      paso: "anular_condonacion",
      nexa_payment_event_id: 7,
      credito_id: 10,
      monto_condonado: "13.37",
    });
  } finally {
    errores.mockRestore();
  }
});

test("reintento con el pago ya registrado: no vuelve a condonar ni registrar", async () => {
  const { deps, log } = crearDeps({
    claim: async () => ({ kind: "retry", eventId: 7 }),
    findPayments: async () => [{ paymentId: 17, validationStatus: "pending", amount: "1000.00" }],
  });
  await processNexaPayment(body, context, deps);
  expect(log).toEqual(["aplicar"]);
});

test("binding rechazado antes de registrar: no condona", async () => {
  const { deps, log } = crearDeps({
    loadCredit: async () => ({
      usuarioId: 5,
      statusCredit: "MOROSO",
      binding: { activo: false, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
    }),
  });
  await expect(processNexaPayment(body, context, deps)).rejects.toEqual(new NexaPaymentError("binding_inactive", 403));
  expect(log.some((l) => l.startsWith("condonar"))).toBe(false);
});

test("sin las dependencias de condonación el flujo sigue igual que antes", async () => {
  const { deps, log } = crearDeps();
  delete deps.condonarMoraATiempo;
  delete deps.anularCondonacionATiempo;
  await processNexaPayment(body, context, deps);
  expect(log).toEqual(["registrar", "aplicar"]);
});

test("con condonación y el pago aplicado, verifica que el crédito quedó al día (después de completar)", async () => {
  const verificados: string[] = [];
  const { deps, log } = crearDeps({
    complete: async () => { log.push("completar"); },
    verificarCondonacionATiempo: async (creditoId, eventId) => { verificados.push(`${creditoId}:${eventId}`); log.push("verificar"); },
  });
  await processNexaPayment(body, context, deps);
  expect(verificados).toEqual(["10:7"]);
  expect(log).toEqual(["condonar:7", "registrar", "aplicar", "completar", "verificar"]);
});

test("sin condonación no verifica; y si la verificación revienta, el pago igual queda aplicado", async () => {
  let verificaciones = 0;
  const sinCondonar = crearDeps({
    condonarMoraATiempo: async () => undefined,
    verificarCondonacionATiempo: async () => { verificaciones += 1; },
  });
  await processNexaPayment(body, context, sinCondonar.deps);
  expect(verificaciones).toBe(0);

  const fallos: string[] = [];
  const revienta = crearDeps({
    verificarCondonacionATiempo: async () => { throw new Error("db blip"); },
    fail: async (_e, code) => { fallos.push(code); },
  });
  const result = await processNexaPayment(body, context, revienta.deps);
  expect(result.paymentId).toBe(17);
  expect(fallos).toEqual([]);
});

test("pago registrado pero applyPayment lo rechaza → anula la condonación y responde 409", async () => {
  const { deps, log } = crearDeps({
    applyPayment: async () => { log.push("aplicar"); return { success: false }; },
  });
  await expect(processNexaPayment(body, context, deps))
    .rejects.toEqual(new NexaPaymentError("payment_not_applied", 409));
  expect(log).toEqual(["condonar:7", "registrar", "aplicar", "anular:7", "fail:payment_not_applied"]);
});

test("applyPayment rechaza y la anulación revienta → incierto (503) con log, no 409", async () => {
  const errores = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const { deps, log } = crearDeps({
      applyPayment: async () => ({ success: false }),
      anularCondonacionATiempo: async () => { throw new Error("db down"); },
    });
    await expect(processNexaPayment(body, context, deps))
      .rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
    expect(log).toContain("fail:payment_outcome_uncertain");
    expect(JSON.parse(String(errores.mock.calls.at(-1)?.[0]))).toMatchObject({
      level: "error",
      event: "nexa.condonacion_a_tiempo.viva_sin_verificar",
      nexa_payment_event_id: 7,
      credito_id: 10,
      error: "db down",
    });
  } finally {
    errores.mockRestore();
  }
});

test("reintento con filas pending y applyPayment rechaza → anula la condonación del primer intento", async () => {
  const { deps, log } = crearDeps({
    claim: async () => ({ kind: "retry", eventId: 7 }),
    findPayments: async () => [{ paymentId: 17, validationStatus: "pending", amount: "1000.00" }],
    applyPayment: async () => { log.push("aplicar"); return { success: false }; },
  });
  await expect(processNexaPayment(body, context, deps))
    .rejects.toEqual(new NexaPaymentError("payment_not_applied", 409));
  expect(log).toEqual(["aplicar", "anular:7", "fail:payment_not_applied"]);
});

test("reintento que aplica el pago: también verifica (la condonación pudo quedar del primer intento)", async () => {
  const verificados: string[] = [];
  const { deps, log } = crearDeps({
    claim: async () => ({ kind: "retry", eventId: 7 }),
    findPayments: async () => [{ paymentId: 17, validationStatus: "pending", amount: "1000.00" }],
    verificarCondonacionATiempo: async (creditoId, eventId) => { verificados.push(`${creditoId}:${eventId}`); },
  });
  await processNexaPayment(body, context, deps);
  expect(verificados).toEqual(["10:7"]);
  expect(log).toEqual(["aplicar"]);
});

// La anulación se niega porque hay un pago posterior no vinculado (pudo ser
// esta misma transferencia, registrada a mano): rechazarle a Nexa le devolvería
// el dinero con el pago registrado igual. Ante la duda: 503 incierto.
const negativa = async () => { throw new CondonacionConservadaError("pago_posterior_no_vinculado"); };

test("registro rechazado sin filas y la anulación se niega por pago posterior → 503 incierto, no el rechazo", async () => {
  const errores = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const { deps, log } = crearDeps({
      registerPayment: async () => ({ success: false, code: "credit_not_payable", status: 409 }),
      anularCondonacionATiempo: negativa,
    });
    await expect(processNexaPayment(body, context, deps))
      .rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
    expect(log).toContain("fail:payment_outcome_uncertain");
    expect(JSON.parse(String(errores.mock.calls.at(-1)?.[0]))).toMatchObject({
      event: "nexa.condonacion_a_tiempo.viva_sin_verificar",
      paso: "anular_condonacion",
      nexa_payment_event_id: 7,
      error: "condonacion_conservada: pago_posterior_no_vinculado",
    });
  } finally {
    errores.mockRestore();
  }
  // Sin negativa el rechazo genuino sigue siendo rechazo.
  const genuino = crearDeps({
    registerPayment: async () => ({ success: false, code: "credit_not_payable", status: 409 }),
  });
  await expect(processNexaPayment(body, context, genuino.deps))
    .rejects.toEqual(new NexaPaymentError("credit_not_payable", 409));
  expect(genuino.log).toContain("anular:7");
});

test("applyPayment rechaza y la anulación se niega por pago posterior → 503 incierto, no 409", async () => {
  const errores = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const { deps, log } = crearDeps({
      applyPayment: async () => ({ success: false }),
      anularCondonacionATiempo: negativa,
    });
    await expect(processNexaPayment(body, context, deps))
      .rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
    expect(log).toContain("fail:payment_outcome_uncertain");
    expect(JSON.parse(String(errores.mock.calls.at(-1)?.[0]))).toMatchObject({
      event: "nexa.condonacion_a_tiempo.viva_sin_verificar",
      paso: "anular_condonacion_pago_no_aplicado",
      error: "condonacion_conservada: pago_posterior_no_vinculado",
    });
  } finally {
    errores.mockRestore();
  }
});
