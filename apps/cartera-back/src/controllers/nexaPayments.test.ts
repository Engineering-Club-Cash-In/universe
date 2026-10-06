import { createHash, createHmac } from "node:crypto";
import { expect, test } from "bun:test";
import type { PaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";

const paymentLock = {} as PaymentAdvisoryLock;
const tokenDate = "2026-09-08T12:00:00Z";
const paymentBody = (externalReference: string) => ({
  externalReference,
  creditoId: 10,
  amount: "10.00",
  currency: "GTQ" as const,
  tokenDate,
  token: "1111222233334444",
});
const successfulBilling = {
  billPayments: async () => ({ kind: "billed" as const }),
  completeBilling: async () => undefined,
  failBilling: async () => undefined,
};

test("acepta el body mínimo GTQ con decimal cent-safe", async () => {
  const nexa = await import("./nexaPayments").catch(() => ({}));
  const schema = Reflect.get(nexa, "nexaPaymentSchema");

  expect(schema).toBeDefined();
  if (!schema) return;

  expect(
    schema.parse({
      externalReference: "qa-payment-1",
      creditoId: 10,
      amount: "1250.40",
      currency: "GTQ",
      tokenDate: "2026-09-08T23:30:00-06:00",
      transactionId: "synthetic-transaction-1",
    }),
  ).toEqual({
    externalReference: "qa-payment-1",
    creditoId: 10,
    amount: "1250.40",
    currency: "GTQ",
    tokenDate: "2026-09-08T23:30:00-06:00",
    transactionId: "synthetic-transaction-1",
  });
});

test("acepta el body legado sin fecha pero valida tokenDate cuando está presente", async () => {
  const { nexaPaymentSchema } = await import("./nexaPayments");
  const base = {
    externalReference: "qa-payment-date",
    creditoId: 10,
    amount: "10.00",
    currency: "GTQ" as const,
  };

  expect(nexaPaymentSchema.safeParse(base).success).toBe(true);
  expect(nexaPaymentSchema.safeParse({ ...base, tokenDate: "not-a-date" }).success).toBe(false);
  expect(nexaPaymentSchema.safeParse({ ...base, tokenDate: "2026-09-08T23:30:00-06:00" }).success).toBe(true);
});

test("un evento legado nuevo sin fecha falla retryable antes de cualquier efecto financiero", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let registered = false;
  let failedWith: string | undefined;

  await expect(processNexaPayment(
    {
      externalReference: "legacy-without-date",
      creditoId: 10,
      amount: "10.00",
      currency: "GTQ",
    },
    { nonce: "legacy-nonce", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => [],
      registerPayment: async () => { registered = true; return { success: true }; },
      applyPayment: async () => ({ success: true }),
      complete: async () => undefined,
      fail: async (_eventId, code) => { failedWith = code; },
    },
  )).rejects.toEqual(new NexaPaymentError("payment_date_required", 503));
  expect({ registered, failedWith }).toEqual({ registered: false, failedWith: "payment_date_required" });
});

test("rechaza montos que no sean strings positivos con dos decimales", async () => {
  const { nexaPaymentSchema } = await import("./nexaPayments");
  const base = {
    externalReference: "qa-payment-1",
    creditoId: 10,
    currency: "GTQ" as const,
    tokenDate,
  };

  expect(nexaPaymentSchema.safeParse({ ...base, amount: "1.001" }).success).toBe(false);
  expect(nexaPaymentSchema.safeParse({ ...base, amount: 1.0 }).success).toBe(false);
  expect(nexaPaymentSchema.safeParse({ ...base, amount: "0.00" }).success).toBe(false);
});

test("rechaza moneda distinta de GTQ y campos desconocidos", async () => {
  const { nexaPaymentSchema } = await import("./nexaPayments");
  const base = {
    externalReference: "qa-payment-1",
    creditoId: 10,
    amount: "10.00",
    tokenDate,
  };

  expect(nexaPaymentSchema.safeParse({ ...base, currency: "USD" }).success).toBe(false);
  expect(
    nexaPaymentSchema.safeParse({ ...base, currency: "GTQ", token: "do-not-store" }).success,
  ).toBe(false);
});

test("limita referencias al tamaño persistible", async () => {
  const { nexaPaymentSchema } = await import("./nexaPayments");
  const base = { creditoId: 10, amount: "10.00", currency: "GTQ" as const, tokenDate };

  expect(
    nexaPaymentSchema.safeParse({ ...base, externalReference: "r".repeat(151) }).success,
  ).toBe(false);
  expect(
    nexaPaymentSchema.safeParse({
      ...base,
      externalReference: "qa-payment-1",
      transactionId: "t".repeat(101),
    }).success,
  ).toBe(false);
});

test("normaliza referencias y limita creditoId al integer de PostgreSQL", async () => {
  const { nexaPaymentSchema } = await import("./nexaPayments");
  const base = { amount: "10.00", currency: "GTQ" as const, tokenDate };

  expect(nexaPaymentSchema.parse({
    ...base,
    externalReference: "  qa-payment-1  ",
    creditoId: 2_147_483_647,
    transactionId: "   ",
  })).toEqual({ ...base, externalReference: "qa-payment-1", creditoId: 2_147_483_647 });
  expect(nexaPaymentSchema.safeParse({
    ...base,
    externalReference: "qa-payment-2",
    creditoId: 2_147_483_648,
  }).success).toBe(false);
});

test("rechaza binding ausente, inactivo, expirado o con monto sobre el límite", async () => {
  const module = await import("./nexaPayments");
  const rejectBinding = Reflect.get(module, "getNexaBindingRejection");
  expect(rejectBinding).toBeFunction();
  if (typeof rejectBinding !== "function") return;

  const now = new Date("2026-09-08T12:00:00.000Z");
  const token = "1111222233334444";
  expect(rejectBinding(null, "10.00", now, token)).toBe("binding_missing");
  expect(rejectBinding({ activo: false, expires_at: null, max_payment_amount: null, nexa_token: token }, "10.00", now, token))
    .toBe("binding_inactive");
  expect(
    rejectBinding(
      { activo: true, expires_at: new Date("2026-09-08T11:59:59.000Z"), max_payment_amount: null, nexa_token: token },
      "10.00",
      now,
      token,
    ),
  ).toBe("binding_expired");
  expect(
    rejectBinding(
      { activo: true, expires_at: null, max_payment_amount: "9.99", nexa_token: token },
      "10.00",
      now,
      token,
    ),
  ).toBe("amount_exceeds_binding");
  expect(
    rejectBinding(
      { activo: true, expires_at: null, max_payment_amount: "10.00", nexa_token: token },
      "10.00",
      now,
      token,
    ),
  ).toBeNull();
});

test("registra y aplica una vez por el flujo canónico", async () => {
  const module = await import("./nexaPayments");
  const processPayment = Reflect.get(module, "processNexaPayment");
  expect(processPayment).toBeFunction();
  if (typeof processPayment !== "function") return;

  let registered = 0;
  let applied = 0;
  let completed = 0;
  const result = await processPayment(
    paymentBody("qa-payment-1"),
    { nonce: "nonce-1", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => registered
        ? [{ paymentId: 17, validationStatus: "pending", amount: "10.00" }]
        : [],
      registerPayment: async () => { registered += 1; return { success: true }; },
      applyPayment: async () => { applied += 1; return { success: true }; },
      complete: async () => { completed += 1; },
      fail: async () => undefined,
      ...successfulBilling,
    },
  );

  expect(result).toEqual({ paymentId: 17, paymentIds: [17], idempotent: false });
  expect({ registered, applied, completed }).toEqual({ registered: 1, applied: 1, completed: 1 });
});

test("no consume claim cuando el crédito no existe", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let claimed = false;

  await expect(processNexaPayment(
    paymentBody("missing-credit"),
    { nonce: "nonce-missing", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => { claimed = true; return { kind: "new", eventId: 7 }; },
      loadCredit: async () => null,
      findPayments: async () => [],
      registerPayment: async () => ({ success: true }),
      applyPayment: async () => ({ success: true }),
      complete: async () => undefined,
      fail: async () => undefined,
    },
  )).rejects.toEqual(new NexaPaymentError("credit_not_found", 404));
  expect(claimed).toBe(false);
});

test("revalida el binding con reloj fresco dentro del lock", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  const calls: string[] = [];

  await expect(processNexaPayment(
    paymentBody("expired-in-lock"),
    { nonce: "nonce-expired", payloadHash: "a".repeat(64), now: new Date("2026-09-08T11:59:00Z") },
    {
      now: () => new Date("2026-09-08T12:01:00Z"),
      withCreditLock: async (_creditoId, work) => { calls.push("lock"); return work(paymentLock); },
      claim: async () => { calls.push("claim"); return { kind: "new", eventId: 7 }; },
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: new Date("2026-09-08T12:00:00Z"), max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => [],
      registerPayment: async () => { calls.push("mutate"); return { success: true }; },
      applyPayment: async () => ({ success: true }),
      complete: async () => undefined,
      fail: async () => undefined,
    },
  )).rejects.toEqual(new NexaPaymentError("binding_expired", 403));
  expect(calls).toEqual(["lock", "claim"]);
});

test.each([
  ["expira", "binding_expired"],
  ["se desactiva", "binding_inactive"],
] as const)("revalida el binding bajo el lock canónico cuando %s durante la espera", async (mode, code) => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let now = new Date("2026-09-08T11:59:00Z");
  let active = true;
  let mutated = false;

  await expect(processNexaPayment(
    paymentBody(`binding-${mode}`),
    { nonce: `nonce-${mode}`, payloadHash: "a".repeat(64), now },
    {
      now: () => now,
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: active, expires_at: new Date("2026-09-08T12:00:00Z"), max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => mutated
        ? [{ paymentId: 17, validationStatus: "validated", amount: "10.00" }]
        : [],
      registerPayment: async (_body, _eventId, _usuarioId, validateAfterLock?: () => Promise<void>) => {
        if (mode === "expira") now = new Date("2026-09-08T12:01:00Z");
        else active = false;
        await validateAfterLock?.();
        mutated = true;
        return { success: true };
      },
      applyPayment: async () => ({ success: true }),
      complete: async () => undefined,
      fail: async () => undefined,
    },
  )).rejects.toEqual(new NexaPaymentError(code, 403));
  expect(mutated).toBe(false);
});

test("un total vinculado distinto queda incierto sin aplicar ni completar", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let applied = 0;
  let completed = false;
  const failures: string[] = [];

  await expect(processNexaPayment(
    paymentBody("partial-link"),
    { nonce: "nonce-partial", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "retry", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => [{ paymentId: 17, validationStatus: "pending", amount: "6.00" }],
      registerPayment: async () => ({ success: true }),
      applyPayment: async () => { applied += 1; return { success: true }; },
      complete: async () => { completed = true; },
      fail: async (_eventId, code) => { failures.push(code); },
    },
  )).rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
  expect({ applied, completed, failures }).toEqual({
    applied: 0,
    completed: false,
    failures: ["payment_outcome_uncertain"],
  });
});

test("exige success true al aplicar cada fila", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");

  await expect(processNexaPayment(
    paymentBody("undefined-success"),
    { nonce: "nonce-undefined", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "retry", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => [{ paymentId: 17, validationStatus: "pending", amount: "10.00" }],
      registerPayment: async () => ({ success: true }),
      applyPayment: async () => ({}),
      complete: async () => undefined,
      fail: async () => undefined,
    },
  )).rejects.toEqual(new NexaPaymentError("payment_not_applied", 409));
});

test("continúa un pago parcial de mora legado cuando dejó la fila exacta vinculada", async () => {
  const { processNexaPayment } = await import("./nexaPayments");
  let registered = 0;
  let applied = 0;
  let completed = 0;
  let failed = 0;

  const result = await processNexaPayment(
    paymentBody("partial-mora"),
    { nonce: "nonce-partial-mora", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "MOROSO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => registered
        ? [{ paymentId: 17, validationStatus: "pending", amount: "10.00" }]
        : [],
      registerPayment: async () => {
        registered += 1;
        return {
          message: "Pago parcial de mora aplicado",
          pagos: [],
          saldo_a_favor: "0",
        } as never;
      },
      applyPayment: async () => { applied += 1; return { success: true }; },
      complete: async () => { completed += 1; },
      fail: async () => { failed += 1; },
      ...successfulBilling,
    },
  );

  expect(result).toEqual({ paymentId: 17, paymentIds: [17], idempotent: false });
  expect({ registered, applied, completed, failed }).toEqual({
    registered: 1,
    applied: 1,
    completed: 1,
    failed: 0,
  });
});

test("mantiene un rechazo explícito sin efectos como rechazo normal", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let registered = 0;

  await expect(processNexaPayment(
    paymentBody("registration-result"),
    { nonce: "nonce-registration", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => [],
      registerPayment: async () => {
        registered += 1;
        return { success: false, code: "credit_not_payable", status: 409 };
      },
      applyPayment: async () => ({ success: true }),
      complete: async () => undefined,
      fail: async () => undefined,
    },
  )).rejects.toEqual(new NexaPaymentError("credit_not_payable", 409));
  expect(registered).toBe(1);
});

test("marca como incierto cualquier registro no rechazado sin fila vinculada", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  const failures: Array<{ eventId: number; code: string }> = [];

  const registrationAttempts = [
    async () => ({}),
    async () => ({ success: true }),
    async () => { throw new Error("post-registration failure"); },
  ];
  for (const registerPayment of registrationAttempts) {
    await expect(processNexaPayment(
      paymentBody("uncertain-registration"),
      { nonce: "nonce-uncertain", payloadHash: "a".repeat(64), now: new Date() },
      {
        withCreditLock: async (_creditoId, work) => work(paymentLock),
        claim: async () => ({ kind: "new", eventId: 7 }),
        loadCredit: async () => ({
          usuarioId: 5,
          statusCredit: "MOROSO",
          binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
        }),
        findPayments: async () => [],
        registerPayment,
        applyPayment: async () => ({ success: true }),
        complete: async () => undefined,
        fail: async (eventId, code) => { failures.push({ eventId, code }); },
      },
    )).rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
  }
  expect(failures).toEqual([
    { eventId: 7, code: "payment_outcome_uncertain" },
    { eventId: 7, code: "payment_outcome_uncertain" },
    { eventId: 7, code: "payment_outcome_uncertain" },
  ]);
});

test("un evento manual_review bloquea reintentos antes de mutar pagos", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let mutated = false;

  await expect(processNexaPayment(
    paymentBody("uncertain-registration"),
    { nonce: "nonce-uncertain-retry", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "manual_review" }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "MOROSO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => { mutated = true; return []; },
      registerPayment: async () => { mutated = true; return { success: true }; },
      applyPayment: async () => { mutated = true; return { success: true }; },
      complete: async () => { mutated = true; },
      fail: async () => { mutated = true; },
    },
  )).rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
  expect(mutated).toBe(false);
});

test("el reintento idempotente devuelve todas las filas del evento aun si el evento solo guarda la primera", async () => {
  const { processNexaPayment } = await import("./nexaPayments");
  const result = await processNexaPayment(
    paymentBody("qa-payment-multi"),
    { nonce: "nonce-2", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "applied", paymentId: 17, eventId: 7 }),
      loadCredit: async () => ({ usuarioId: 5, statusCredit: "ACTIVO", binding: null }),
      findPayments: async (eventId) => eventId === 7
        ? [
            { paymentId: 17, validationStatus: "validated", amount: "10.00" },
            { paymentId: 18, validationStatus: "validated", amount: "5.00" },
          ]
        : [],
      registerPayment: async () => ({ success: true }),
      applyPayment: async () => ({ success: true }),
      complete: async () => undefined,
      fail: async () => undefined,
    },
  );

  expect(result).toEqual({ paymentId: 17, paymentIds: [17, 18], idempotent: true });
});

test("devuelve el mismo paymentId en un reintento ya aplicado", async () => {
  const { processNexaPayment } = await import("./nexaPayments");
  let mutated = false;
  const result = await processNexaPayment(
    paymentBody("qa-payment-1"),
    { nonce: "nonce-2", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "applied", paymentId: 17 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => [],
      registerPayment: async () => { mutated = true; return { success: true }; },
      applyPayment: async () => { mutated = true; return { success: true }; },
      complete: async () => { mutated = true; },
      fail: async () => { mutated = true; },
    },
  );

  expect(result).toEqual({ paymentId: 17, paymentIds: [17], idempotent: true });
  expect(mutated).toBe(false);
});

test.each(["conflict", "replay"] as const)("rechaza un claim %s sin mutar", async (kind) => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let mutated = false;
  const promise = processNexaPayment(
    paymentBody("qa-payment-1"),
    { nonce: "nonce-2", payloadHash: "b".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => [],
      registerPayment: async () => { mutated = true; return { success: true }; },
      applyPayment: async () => { mutated = true; return { success: true }; },
      complete: async () => { mutated = true; },
      fail: async () => { mutated = true; },
    },
  );

  await expect(promise).rejects.toEqual(new NexaPaymentError(kind, 409));
  expect(mutated).toBe(false);
});

test("clasifica conflicto de payload, replay, retry e idempotencia persistente", async () => {
  const module = await import("./nexaPayments");
  const classify = Reflect.get(module, "classifyNexaClaim");
  expect(classify).toBeFunction();
  if (typeof classify !== "function") return;

  const requested = {
    creditoId: 10,
    amount: "10.00",
    currency: "GTQ",
    payloadHash: "a".repeat(64),
  };
  const event = {
    id: 7,
    credito_id: 10,
    amount: "10.00",
    currency: "GTQ",
    payload_hash: "a".repeat(64),
    status: "processing",
    pago_id: null,
  };

  expect(classify(event, false, requested)).toEqual({ kind: "manual_review" });
  expect(classify({ ...event, status: "failed" }, false, requested))
    .toEqual({ kind: "retry", eventId: 7 });
  expect(classify({ ...event, status: "manual_review" }, false, requested))
    .toEqual({ kind: "manual_review" });
  expect(classify({ ...event, status: "applied", pago_id: 17 }, false, requested))
    .toEqual({ kind: "applied", paymentId: 17, eventId: 7 });
  expect(classify({ ...event, status: "billed", pago_id: 17 }, false, requested))
    .toEqual({ kind: "applied", paymentId: 17, eventId: 7 });
  expect(classify({ ...event, status: "billing_pending", pago_id: 17 }, false, requested))
    .toEqual({ kind: "billing", eventId: 7 });
  expect(classify({ ...event, status: "billing_failed", pago_id: 17 }, false, requested))
    .toEqual({ kind: "billing_failed" });
  expect(classify({ ...event, status: "billing_running", pago_id: 17 }, false, requested))
    .toEqual({ kind: "manual_review", phase: "billing" });
  expect(classify({ ...event, status: "billing_unknown", pago_id: 17 }, false, requested))
    .toEqual({ kind: "manual_review", phase: "billing" });
  expect(classify(event, true, requested)).toEqual({ kind: "replay" });
  expect(classify(event, false, { ...requested, payloadHash: "b".repeat(64) }))
    .toEqual({ kind: "conflict" });

  const fingerprint = Reflect.get(module, "getNexaEventFingerprint");
  expect(fingerprint).toBeFunction();
  const firstDate = fingerprint(paymentBody("dated-retry"));
  const secondDate = fingerprint({ ...paymentBody("dated-retry"), tokenDate: "2026-09-09T12:00:00Z" });
  expect(firstDate).not.toBe(secondDate);
  expect(classify(
    { ...event, payload_hash: firstDate, status: "failed" },
    false,
    {
      ...requested,
      payloadHash: "b".repeat(64),
      compatiblePayloadHashes: [secondDate, "legacy-hash"],
    },
  )).toEqual({ kind: "conflict" });
});

test("un reintento de Nexa después de marcar CAÍDO se contesta como aplicado con el pago borrado", async () => {
  const { classifyNexaClaim, processNexaPayment } = await import("./nexaPayments");
  const requested = { creditoId: 10, amount: "10.00", currency: "GTQ", payloadHash: "a".repeat(64) };
  const caido = {
    id: 7,
    credito_id: 10,
    amount: "10.00",
    currency: "GTQ",
    payload_hash: "a".repeat(64),
    status: "applied",
    pago_id: null,
    pago_id_eliminado: 17,
  };
  for (const status of ["applied", "billed", "billing_pending", "billing_running", "billing_unknown", "billing_failed", "processing", "manual_review"]) {
    expect(classifyNexaClaim({ ...caido, status }, false, requested))
      .toEqual({ kind: "applied", paymentId: 17, eventId: 7 });
  }
  // Un `failed` (Nexa rechazó la transferencia y devolvió el dinero) nunca se contesta como
  // aplicado, aunque traiga la marca: sigue el camino de failed.
  expect(classifyNexaClaim({ ...caido, status: "failed" }, false, requested))
    .toEqual({ kind: "retry", eventId: 7 });
  // El conflicto y el replay siguen ganando.
  expect(classifyNexaClaim(caido, true, requested)).toEqual({ kind: "replay" });
  expect(classifyNexaClaim(caido, false, { ...requested, amount: "11.00" })).toEqual({ kind: "conflict" });
  // Sin pago borrado, sigue como antes.
  expect(classifyNexaClaim({ ...caido, pago_id_eliminado: null }, false, requested))
    .toEqual({ kind: "manual_review" });

  let mutated = false;
  const result = await processNexaPayment(
    paymentBody("qa-payment-caido"),
    { nonce: "nonce-nuevo", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => classifyNexaClaim({ ...caido, status: "billing_pending" }, false, requested),
      loadCredit: async () => ({ usuarioId: 5, statusCredit: "CAIDO", binding: null }),
      findPayments: async () => [],
      registerPayment: async () => { mutated = true; return { success: true }; },
      applyPayment: async () => { mutated = true; return { success: true }; },
      complete: async () => { mutated = true; },
      fail: async () => { mutated = true; },
      billPayments: async () => { mutated = true; return { kind: "billed" }; },
      completeBilling: async () => { mutated = true; },
      failBilling: async () => { mutated = true; },
    },
  );
  expect(result).toEqual({ paymentId: 17, paymentIds: [17], idempotent: true });
  expect(mutated).toBe(false);
});

test("el handler verifica el body exacto antes de procesar", async () => {
  const module = await import("./nexaPayments");
  const createHandler = Reflect.get(module, "createNexaPaymentHandler");
  expect(createHandler).toBeFunction();
  if (typeof createHandler !== "function") return;

  const rawBody = JSON.stringify({
    externalReference: "qa-payment-1",
    creditoId: 10,
    amount: "10.00",
    currency: "GTQ",
    tokenDate,
  });
  const timestamp = "1800000000";
  const nonce = "nonce-handler-1";
  const canonical = [
    "POST",
    "/internal/nexa/payments/apply",
    timestamp,
    nonce,
    createHash("sha256").update(rawBody).digest("hex"),
  ].join("\n");
  const secret = "s".repeat(32);
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  const set: { status?: number | string } = {};
  let claimContext: Record<string, unknown> | undefined;
  const handler = createHandler({
    secret: `  ${secret}  `,
    now: () => 1_800_000_000_000,
    dependencies: {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async (_body, context) => {
        claimContext = context;
        return { kind: "applied", paymentId: 17 };
      },
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => [],
      registerPayment: async () => ({ success: true }),
      applyPayment: async () => ({ success: true }),
      complete: async () => undefined,
      fail: async () => undefined,
    },
  });

  const result = await handler({
    request: new Request("http://localhost/internal/nexa/payments/apply", {
      method: "POST",
      body: rawBody,
      headers: {
        "x-nexa-timestamp": timestamp,
        "x-nexa-nonce": nonce,
        "x-nexa-signature": signature,
      },
    }),
    body: undefined,
    set,
  });

  expect(set.status).toBe(200);
  expect(result).toEqual({ status: "APPLIED", paymentId: 17, paymentIds: [17], idempotent: true });
  expect(claimContext).toMatchObject({
    payloadHash: createHash("sha256").update(rawBody).digest("hex"),
    legacyPayloadHash: createHash("sha256").update(JSON.stringify({
      externalReference: "qa-payment-1",
      creditoId: 10,
      amount: "10.00",
      currency: "GTQ",
    })).digest("hex"),
  });
  expect(claimContext?.eventFingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(claimContext?.eventFingerprint).not.toBe(claimContext?.payloadHash);
});

test("un fallo queda reintentable sin registrar ni aplicar dos veces", async () => {
  const { processNexaPayment } = await import("./nexaPayments");
  const body = paymentBody("qa-retry-1");
  let eventStatus = "new";
  let registered = 0;
  let applyAttempts = 0;
  let paymentStatus = "pending";
  const dependencies = {
    withCreditLock: async (_creditoId: number, work: (_lock: PaymentAdvisoryLock) => Promise<{ paymentId: number; paymentIds: number[]; idempotent: boolean }>) => work(paymentLock),
    claim: async () => eventStatus === "new"
      ? { kind: "new" as const, eventId: 7 }
      : { kind: "retry" as const, eventId: 7 },
    loadCredit: async () => ({
      usuarioId: 5,
      statusCredit: "ACTIVO",
      binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
    }),
    findPayments: async () => registered
      ? [{ paymentId: 17, validationStatus: paymentStatus, amount: "10.00" }]
      : [],
    registerPayment: async () => { registered += 1; return { success: true }; },
    applyPayment: async () => {
      applyAttempts += 1;
      if (applyAttempts === 1) throw new Error("synthetic failure");
      paymentStatus = "validated";
      return { success: true };
    },
    complete: async () => { eventStatus = "applied"; },
    fail: async () => { eventStatus = "failed"; },
    ...successfulBilling,
  };

  await expect(
    processNexaPayment(body, { nonce: "nonce-retry-1", payloadHash: "a".repeat(64), now: new Date() }, dependencies),
  ).rejects.toThrow("synthetic failure");
  await expect(
    processNexaPayment(body, { nonce: "nonce-retry-2", payloadHash: "a".repeat(64), now: new Date() }, dependencies),
  ).resolves.toEqual({ paymentId: 17, paymentIds: [17], idempotent: false });
  expect({ registered, applyAttempts, eventStatus }).toEqual({ registered: 1, applyAttempts: 2, eventStatus: "applied" });
});

test("serializa requests concurrentes y devuelve un único paymentId", async () => {
  const { processNexaPayment } = await import("./nexaPayments");
  const body = paymentBody("qa-concurrent-1");
  let tail = Promise.resolve();
  let eventStatus = "missing";
  let registered = 0;
  let applied = 0;
  const dependencies = {
    withCreditLock: async (_creditoId: number, work: (_lock: PaymentAdvisoryLock) => Promise<{ paymentId: number; paymentIds: number[]; idempotent: boolean }>) => {
      const previous = tail;
      let release: () => void = () => undefined;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await work(paymentLock); } finally { release(); }
    },
    claim: async () => eventStatus === "missing"
      ? (eventStatus = "processing", { kind: "new" as const, eventId: 7 })
      : { kind: "applied" as const, paymentId: 17 },
    loadCredit: async () => ({
      usuarioId: 5,
      statusCredit: "ACTIVO",
      binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
    }),
    findPayments: async () => registered
      ? [{ paymentId: 17, validationStatus: applied ? "validated" : "pending", amount: "10.00" }]
      : [],
    registerPayment: async () => { registered += 1; return { success: true }; },
    applyPayment: async () => { applied += 1; return { success: true }; },
    complete: async () => { eventStatus = "applied"; },
    fail: async () => { eventStatus = "failed"; },
    ...successfulBilling,
  };

  const results = await Promise.all([
    processNexaPayment(body, { nonce: "nonce-concurrent-1", payloadHash: "a".repeat(64), now: new Date() }, dependencies),
    processNexaPayment(body, { nonce: "nonce-concurrent-2", payloadHash: "a".repeat(64), now: new Date() }, dependencies),
  ]);

  expect(results).toEqual([
    { paymentId: 17, paymentIds: [17], idempotent: false },
    { paymentId: 17, paymentIds: [17], idempotent: true },
  ]);
  expect({ registered, applied }).toEqual({ registered: 1, applied: 1 });
});

test("serializa referencias distintas del mismo crédito", async () => {
  const { processNexaPayment } = await import("./nexaPayments");
  const locks = new Map<string | number, Promise<void>>();
  const lock = async (
    key: string | number,
    work: (_lock: PaymentAdvisoryLock) => Promise<{ paymentId: number; paymentIds: number[]; idempotent: boolean }>,
  ) => {
    const previous = locks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    locks.set(key, current);
    await previous;
    try {
      return await work(paymentLock);
    } finally {
      release();
      if (locks.get(key) === current) locks.delete(key);
    }
  };
  const registered = new Set<number>();
  let active = 0;
  let maxActive = 0;
  const dependencies = {
    withCreditLock: lock,
    claim: async (body: { externalReference: string }) => ({
      kind: "new" as const,
      eventId: body.externalReference.endsWith("1") ? 7 : 8,
    }),
    loadCredit: async () => ({
      usuarioId: 5,
      statusCredit: "ACTIVO",
      binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
    }),
    findPayments: async (eventId: number) => registered.has(eventId)
      ? [{ paymentId: eventId + 10, validationStatus: "pending", amount: "10.00" }]
      : [],
    registerPayment: async (_body: unknown, eventId: number) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep(10);
      registered.add(eventId);
      return { success: true };
    },
    applyPayment: async () => {
      active -= 1;
      return { success: true };
    },
    complete: async () => undefined,
    fail: async () => undefined,
    ...successfulBilling,
  };
  const context = { payloadHash: "a".repeat(64), now: new Date() };

  await Promise.all([
    processNexaPayment(
      paymentBody("qa-credit-lock-1"),
      { ...context, nonce: "nonce-credit-lock-1" },
      dependencies,
    ),
    processNexaPayment(
      paymentBody("qa-credit-lock-2"),
      { ...context, nonce: "nonce-credit-lock-2" },
      dependencies,
    ),
  ]);

  expect(maxActive).toBe(1);
});

test("conserva el día bancario y usa la referencia cuando la entrada no tiene autorización", async () => {
  const { getNexaReceiptFields } = await import("./nexaPayments");
  expect(getNexaReceiptFields({ ...paymentBody("bank-reference"), tokenDate: "2026-09-23T00:00:00.000Z" })).toEqual({
    fecha_pago: "2026-09-23T00:00:00.000Z",
    fecha_boleta: "2026-09-23",
    numeroAutorizacion: "bank-reference",
  });
  expect(getNexaReceiptFields({ ...paymentBody("bank-reference"), tokenDate: "2026-09-08T23:30:00-06:00", transactionId: "bank-authorization" })).toMatchObject({
    fecha_boleta: "2026-09-08", numeroAutorizacion: "bank-authorization",
  });
});

test.each([
  ["parcial", [{ paymentId: 17, validationStatus: "pending", amount: "10.00" }]],
  ["completo", [
    { paymentId: 17, validationStatus: "pending", amount: "6.00" },
    { paymentId: 18, validationStatus: "pending", amount: "4.00" },
  ]],
  ["convenio", [
    { paymentId: 17, validationStatus: "pending", amount: "3.00" },
    { paymentId: 18, validationStatus: "pending", amount: "7.00" },
  ]],
] as const)("factura todas las filas de un pago Nexa %s antes de reportarlo aplicado", async (_case, payments) => {
  const { processNexaPayment } = await import("./nexaPayments");
  const billed: number[][] = [];
  const completedBilling: number[] = [];

  await expect(processNexaPayment(
    paymentBody(`billing-${_case}`),
    { nonce: `nonce-billing-${_case}`, payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: _case === "convenio" ? "EN_CONVENIO" : "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => [...payments],
      registerPayment: async () => ({ success: true }),
      applyPayment: async () => ({ success: true }),
      complete: async () => undefined,
      fail: async () => undefined,
      billPayments: async (_eventId, paymentIds) => {
        billed.push(paymentIds);
        return { kind: "billed" };
      },
      completeBilling: async (_eventId, paymentId) => { completedBilling.push(paymentId); },
      failBilling: async () => undefined,
    },
  )).resolves.toEqual({
    paymentId: 17,
    paymentIds: payments.map((payment) => payment.paymentId),
    idempotent: false,
  });

  expect(billed).toEqual([payments.map((payment) => payment.paymentId)]);
  expect(completedBilling).toEqual([17]);
});

test("un billing pendiente no vuelve a autorizar ni aplicar el pago ya persistido", async () => {
  const { processNexaPayment } = await import("./nexaPayments");
  let paymentMutation = false;
  let billed = false;

  await expect(processNexaPayment(
    paymentBody("billing-resume"),
    { nonce: "nonce-billing-resume", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "billing", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "CANCELADO",
        binding: { activo: false, expires_at: new Date(0), max_payment_amount: null },
      }),
      findPayments: async () => [{ paymentId: 17, validationStatus: "validated", amount: "10.00" }],
      registerPayment: async () => { paymentMutation = true; return { success: true }; },
      applyPayment: async () => { paymentMutation = true; return { success: true }; },
      complete: async () => { paymentMutation = true; },
      fail: async () => { paymentMutation = true; },
      billPayments: async () => { billed = true; return { kind: "billed" }; },
      completeBilling: async () => undefined,
      failBilling: async () => undefined,
    },
  )).resolves.toEqual({ paymentId: 17, paymentIds: [17], idempotent: false });

  expect({ paymentMutation, billed }).toEqual({ paymentMutation: false, billed: true });
});

test("un proveedor que pudo aceptar queda billing_unknown y nunca se invoca otra vez", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let billingCalls = 0;
  let claim: { kind: "new"; eventId: number } | { kind: "manual_review"; phase: "billing" } = { kind: "new", eventId: 7 };
  const billingFailures: Array<{ status: string; code: string }> = [];
  const dependencies = {
    withCreditLock: async (_creditoId: number, work: (_lock: PaymentAdvisoryLock) => Promise<{ paymentId: number; paymentIds: number[]; idempotent: boolean }>) => work(paymentLock),
    claim: async () => claim,
    loadCredit: async () => ({
      usuarioId: 5,
      statusCredit: "ACTIVO",
      binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
    }),
    findPayments: async () => [{ paymentId: 17, validationStatus: "validated", amount: "10.00" }],
    registerPayment: async () => ({ success: true }),
    applyPayment: async () => ({ success: true }),
    complete: async () => undefined,
    fail: async () => undefined,
    billPayments: async () => {
      billingCalls += 1;
      return { kind: "unknown" as const, code: "provider_response_ambiguous" };
    },
    completeBilling: async () => undefined,
    failBilling: async (_eventId: number, status: string, code: string) => {
      billingFailures.push({ status, code });
      claim = { kind: "manual_review", phase: "billing" };
    },
  };

  await expect(processNexaPayment(
    paymentBody("billing-ambiguous"),
    { nonce: "nonce-billing-ambiguous-1", payloadHash: "a".repeat(64), now: new Date() },
    dependencies,
  )).rejects.toEqual(new NexaPaymentError("billing_outcome_unknown", 503));
  await expect(processNexaPayment(
    paymentBody("billing-ambiguous"),
    { nonce: "nonce-billing-ambiguous-2", payloadHash: "a".repeat(64), now: new Date() },
    dependencies,
  )).rejects.toEqual(new NexaPaymentError("billing_outcome_unknown", 503));

  expect(billingCalls).toBe(1);
  expect(billingFailures).toEqual([
    { status: "billing_unknown", code: "provider_response_ambiguous" },
  ]);
});

test("éxito del proveedor seguido por fallo local queda desconocido y no reintenta la mutación fiscal", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let providerCalls = 0;
  let manualReview = false;
  const dependencies = {
    withCreditLock: async (_creditoId: number, work: (_lock: PaymentAdvisoryLock) => Promise<{ paymentId: number; paymentIds: number[]; idempotent: boolean }>) => work(paymentLock),
    claim: async () => manualReview
      ? { kind: "manual_review" as const, phase: "billing" as const }
      : { kind: "new" as const, eventId: 7 },
    loadCredit: async () => ({
      usuarioId: 5,
      statusCredit: "ACTIVO",
      binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
    }),
    findPayments: async () => [{ paymentId: 17, validationStatus: "validated", amount: "10.00" }],
    registerPayment: async () => ({ success: true }),
    applyPayment: async () => ({ success: true }),
    complete: async () => undefined,
    fail: async () => undefined,
    billPayments: async () => {
      providerCalls += 1;
      return { kind: "billed" as const };
    },
    completeBilling: async () => {
      throw new Error("synthetic local persistence failure after provider success");
    },
    failBilling: async (_eventId: number, status: string, code: string) => {
      expect({ status, code }).toEqual({
        status: "billing_unknown",
        code: "billing_persistence_unknown",
      });
      manualReview = true;
    },
  };

  await expect(processNexaPayment(
    paymentBody("billing-local-failure"),
    { nonce: "nonce-billing-local-1", payloadHash: "a".repeat(64), now: new Date() },
    dependencies,
  )).rejects.toEqual(new NexaPaymentError("billing_outcome_unknown", 503));
  await expect(processNexaPayment(
    paymentBody("billing-local-failure"),
    { nonce: "nonce-billing-local-2", payloadHash: "a".repeat(64), now: new Date() },
    dependencies,
  )).rejects.toEqual(new NexaPaymentError("billing_outcome_unknown", 503));
  expect(providerCalls).toBe(1);
});

test("un rechazo fiscal definitivo queda billing_failed y no vuelve a emitir ni responde PENDING", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let claim: "new" | "billing_failed" = "new";
  let billingAttempts = 0;
  let paymentMutations = 0;
  const dependencies = {
    withCreditLock: async (_creditoId: number, work: (_lock: PaymentAdvisoryLock) => Promise<{ paymentId: number; paymentIds: number[]; idempotent: boolean }>) => work(paymentLock),
    claim: async () => claim === "new"
      ? { kind: "new" as const, eventId: 7 }
      : { kind: "billing_failed" as const },
    loadCredit: async () => ({
      usuarioId: 5,
      statusCredit: "ACTIVO",
      binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
    }),
    findPayments: async () => [{ paymentId: 17, validationStatus: "validated", amount: "10.00" }],
    registerPayment: async () => { paymentMutations += 1; return { success: true }; },
    applyPayment: async () => { paymentMutations += 1; return { success: true }; },
    complete: async () => undefined,
    fail: async () => undefined,
    billPayments: async () => {
      billingAttempts += 1;
      return billingAttempts === 1
        ? { kind: "failed" as const, code: "billing_rejected" }
        : { kind: "billed" as const };
    },
    completeBilling: async () => undefined,
    failBilling: async (_eventId: number, status: string) => {
      expect(status).toBe("billing_failed");
      claim = "billing_failed";
    },
  };

  await expect(processNexaPayment(
    paymentBody("billing-rejected"),
    { nonce: "nonce-billing-rejected-1", payloadHash: "a".repeat(64), now: new Date() },
    dependencies,
  )).rejects.toEqual(new NexaPaymentError("billing_failed", 503));
  await expect(processNexaPayment(
    paymentBody("billing-rejected"),
    { nonce: "nonce-billing-rejected-2", payloadHash: "a".repeat(64), now: new Date() },
    dependencies,
  )).rejects.toEqual(new NexaPaymentError("billing_failed", 503));
  expect({ billingAttempts, paymentMutations }).toEqual({ billingAttempts: 1, paymentMutations: 0 });
});

test("facturación automática deshabilitada deja el pago aplicado y la factura pendiente", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let paymentPersisted = 0;
  let billingFailure = 0;

  await expect(processNexaPayment(
    paymentBody("billing-disabled"),
    { nonce: "nonce-billing-disabled", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => [{ paymentId: 17, validationStatus: "validated", amount: "10.00" }],
      registerPayment: async () => ({ success: true }),
      applyPayment: async () => ({ success: true }),
      complete: async () => { paymentPersisted += 1; },
      fail: async () => undefined,
      billPayments: async () => ({ kind: "pending", code: "billing_not_enabled" }),
      completeBilling: async () => undefined,
      failBilling: async () => { billingFailure += 1; },
    },
  )).resolves.toEqual({
    paymentId: 17,
    paymentIds: [17],
    idempotent: false,
    billingStatus: "PENDING",
  });

  expect({ paymentPersisted, billingFailure }).toEqual({ paymentPersisted: 1, billingFailure: 0 });
});

test("solo producción explícitamente habilitada puede hacer facturación fiscal automática", async () => {
  const module = await import("./nexaPayments");
  const canInvoice = Reflect.get(module, "canAutomaticallyInvoiceNexa");
  expect(canInvoice).toBeFunction();
  if (typeof canInvoice !== "function") return;

  expect(canInvoice({ environment: "production", enabled: true, simulated: false })).toBe(true);
  expect(canInvoice({ environment: "production", enabled: false, simulated: false })).toBe(false);
  expect(canInvoice({ environment: "qa", enabled: true, simulated: false })).toBe(false);
  expect(canInvoice({ environment: "development", enabled: true, simulated: false })).toBe(false);
  expect(canInvoice({ environment: "production", enabled: true, simulated: true })).toBe(false);
});

test("solo clasifica como billed una respuesta fiscal completamente persistida", async () => {
  const module = await import("./nexaPayments");
  const classify = Reflect.get(module, "classifyNexaBillingResponse");
  expect(classify).toBeFunction();
  if (typeof classify !== "function") return;

  expect(classify(200, {
    success: true,
    data: { total_facturas: 1, facturas: [{ factura_id: 91 }], errores: undefined },
  })).toEqual({ kind: "billed" });
  expect(classify(200, {
    success: true,
    data: { total_facturas: 0, facturas: [], errores: undefined },
  })).toEqual({ kind: "billed" });
  expect(classify(200, {
    success: true,
    data: { facturas: [{ factura_id: 91 }], errores: [{ error: "timeout" }] },
  })).toEqual({ kind: "unknown", code: "partial_billing_result" });
  expect(classify(500, { success: false, error: "No se pudo generar ninguna factura" }))
    .toEqual({ kind: "unknown", code: "billing_provider_or_persistence_error" });
  expect(classify(404, { success: false, error: "Pago no encontrado" }))
    .toEqual({ kind: "failed", code: "billing_rejected" });
  expect(classify(200, { success: true }))
    .toEqual({ kind: "unknown", code: "invalid_billing_response" });
  expect(classify(500, {
    success: true,
    data: { total_facturas: 0, facturas: [] },
  })).toEqual({ kind: "unknown", code: "invalid_billing_response" });
  expect(classify(200, {
    success: true,
    data: { total_facturas: 1, facturas: [] },
  })).toEqual({ kind: "unknown", code: "invalid_billing_response" });
  expect(classify(200, {
    success: true,
    data: { total_facturas: 1, facturas: [{}] },
  })).toEqual({ kind: "unknown", code: "invalid_billing_response" });
});

test("token obligatorio: rechaza falta de token en pago o binding", async () => {
  const module = await import("./nexaPayments");
  const rejectBinding = Reflect.get(module, "getNexaBindingRejection");
  expect(rejectBinding).toBeFunction();
  if (typeof rejectBinding !== "function") return;

  const now = new Date("2026-09-08T12:00:00.000Z");
  const binding = { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" };

  expect(rejectBinding(binding, "10.00", now, "1111222233334444")).toBeNull();
  expect(rejectBinding(binding, "10.00", now, "9999888877776666")).toBe("token_mismatch");
  expect(rejectBinding(binding, "10.00", now, undefined)).toBe("token_missing");
  expect(rejectBinding(
    { activo: true, expires_at: null, max_payment_amount: null, nexa_token: null },
    "10.00",
    now,
    "9999888877776666",
  )).toBe("binding_token_missing");
  expect(rejectBinding(
    { activo: false, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
    "10.00",
    now,
    "9999888877776666",
  )).toBe("binding_inactive");
  expect(rejectBinding(
    { activo: true, expires_at: null, max_payment_amount: "1.00", nexa_token: "1111222233334444" },
    "10.00",
    now,
    "9999888877776666",
  )).toBe("token_mismatch");
});

test("processNexaPayment rechaza un pago con token no coincidente en el binding", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let registered = false;
  let failedWith: string | undefined;

  await expect(processNexaPayment(
    { ...paymentBody("qa-token-mismatch"), token: "9999888877776666" },
    { nonce: "nonce-token-mismatch", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => [],
      registerPayment: async () => { registered = true; return { success: true }; },
      applyPayment: async () => ({ success: true }),
      complete: async () => undefined,
      fail: async (_eventId, code) => { failedWith = code; },
    },
  )).rejects.toEqual(new NexaPaymentError("token_mismatch", 403));
  expect({ registered, failedWith }).toEqual({ registered: false, failedWith: "token_mismatch" });
});

test("processNexaPayment acepta un pago con token correcto y sigue el camino feliz", async () => {
  const { processNexaPayment } = await import("./nexaPayments");
  let registered = 0;
  let applied = 0;
  let completed = 0;

  const result = await processNexaPayment(
    { ...paymentBody("qa-token-correct"), token: "1111222233334444" },
    { nonce: "nonce-token-correct", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => registered
        ? [{ paymentId: 17, validationStatus: "pending", amount: "10.00" }]
        : [],
      registerPayment: async () => { registered += 1; return { success: true }; },
      applyPayment: async () => { applied += 1; return { success: true }; },
      complete: async () => { completed += 1; },
      fail: async () => undefined,
      ...successfulBilling,
    },
  );

  expect(result).toEqual({ paymentId: 17, paymentIds: [17], idempotent: false });
  expect({ registered, applied, completed }).toEqual({ registered: 1, applied: 1, completed: 1 });
});

test("processNexaPayment: pago sin token en el body es reintentable (503), no un rechazo", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let registered = false;
  let failedWith: string | undefined;

  await expect(processNexaPayment(
    { ...paymentBody("qa-token-missing"), token: undefined },
    { nonce: "nonce-token-missing", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => [],
      registerPayment: async () => { registered = true; return { success: true }; },
      applyPayment: async () => ({ success: true }),
      complete: async () => undefined,
      fail: async (_eventId, code) => { failedWith = code; },
    },
  )).rejects.toEqual(new NexaPaymentError("token_missing", 503));
  expect({ registered, failedWith }).toEqual({ registered: false, failedWith: "token_missing" });
});

test("el handler responde 503 a un pago sin token, como lo manda el nexa-server viejo", async () => {
  const { createNexaPaymentHandler } = await import("./nexaPayments");
  // Body exacto del cliente desplegado antes del token (e8379e73a): sin campo token.
  const rawBody = JSON.stringify({
    externalReference: "qa-old-nexa-server",
    creditoId: 10,
    amount: "10.00",
    currency: "GTQ",
    tokenDate,
    transactionId: "tx-old",
  });
  const timestamp = "1800000000";
  const nonce = "nonce-old-nexa-server";
  const secret = "s".repeat(32);
  const signature = createHmac("sha256", secret).update([
    "POST",
    "/internal/nexa/payments/apply",
    timestamp,
    nonce,
    createHash("sha256").update(rawBody).digest("hex"),
  ].join("\n")).digest("hex");
  const set: { status?: number | string } = {};
  let registered = false;
  let failedWith: string | undefined;
  const handler = createNexaPaymentHandler({
    secret,
    now: () => 1_800_000_000_000,
    dependencies: {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: async () => [],
      registerPayment: async () => { registered = true; return { success: true }; },
      applyPayment: async () => ({ success: true }),
      complete: async () => undefined,
      fail: async (_eventId, code) => { failedWith = code; },
    },
  });

  const result = await handler({
    request: new Request("http://localhost/internal/nexa/payments/apply", {
      method: "POST",
      body: rawBody,
      headers: { "x-nexa-timestamp": timestamp, "x-nexa-nonce": nonce, "x-nexa-signature": signature },
    }),
    body: undefined,
    set,
  });

  // nexa-server (viejo y nuevo) reintenta todo HTTP >= 500; un 403 con código lo rechaza
  // y Nexa devuelve la transferencia.
  expect(set.status).toBe(503);
  expect(result).toEqual({ error: "token_missing" });
  // El evento queda "failed": el reintento (ya con token) lo reclama de nuevo.
  expect({ registered, failedWith }).toEqual({ registered: false, failedWith: "token_missing" });
});

test("processNexaPayment rechaza pago cuando binding no tiene token", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let registered = false;
  let failedWith: string | undefined;

  await expect(processNexaPayment(
    paymentBody("qa-binding-token-missing"),
    { nonce: "nonce-binding-token-missing", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: null },
      }),
      findPayments: async () => [],
      registerPayment: async () => { registered = true; return { success: true }; },
      applyPayment: async () => ({ success: true }),
      complete: async () => undefined,
      fail: async (_eventId, code) => { failedWith = code; },
    },
  )).rejects.toEqual(new NexaPaymentError("binding_token_missing", 403));
  expect({ registered, failedWith }).toEqual({ registered: false, failedWith: "binding_token_missing" });
});

test("getNexaBindingRejection rechaza binding inactivo incluso con token", async () => {
  const module = await import("./nexaPayments");
  const rejectBinding = Reflect.get(module, "getNexaBindingRejection");
  expect(rejectBinding).toBeFunction();
  if (typeof rejectBinding !== "function") return;

  const now = new Date("2026-09-08T12:00:00.000Z");
  expect(rejectBinding(
    { activo: false, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
    "10.00",
    now,
    undefined,
  )).toBe("binding_inactive");
});

test("nexaPaymentSchema valida tokens de 10 a 32 dígitos", async () => {
  const { nexaPaymentSchema } = await import("./nexaPayments");
  const base = { creditoId: 10, amount: "10.00", currency: "GTQ" as const, tokenDate };

  expect(nexaPaymentSchema.safeParse({
    ...base,
    externalReference: "qa-token-digits",
    token: "1111222233334444",
  }).success).toBe(true);

  expect(nexaPaymentSchema.safeParse({
    ...base,
    externalReference: "qa-token-14",
    token: "12345100000001",
  }).success).toBe(true);

  expect(nexaPaymentSchema.safeParse({
    ...base,
    externalReference: "qa-token-short",
    token: "123456789",
  }).success).toBe(false);

  expect(nexaPaymentSchema.safeParse({
    ...base,
    externalReference: "qa-token-letters",
    token: "aaaa222233334444",
  }).success).toBe(false);

  expect(nexaPaymentSchema.safeParse({
    ...base,
    externalReference: "qa-token-optional",
  }).success).toBe(true);
});

test("getNexaEventFingerprint es invariante al token", async () => {
  const { getNexaEventFingerprint } = await import("./nexaPayments");
  const bodyWithoutToken = paymentBody("fingerprint-invariant");
  const bodyWithToken = { ...bodyWithoutToken, token: "1111222233334444" };

  const fingerprintWithout = getNexaEventFingerprint(bodyWithoutToken);
  const fingerprintWith = getNexaEventFingerprint(bodyWithToken);

  expect(fingerprintWithout).toBe(fingerprintWith);
});
