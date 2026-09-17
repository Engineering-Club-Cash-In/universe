import { createHash, createHmac } from "node:crypto";
import { expect, test } from "bun:test";
import type { PaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";

const paymentLock = {} as PaymentAdvisoryLock;

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
      transactionId: "synthetic-transaction-1",
    }),
  ).toEqual({
    externalReference: "qa-payment-1",
    creditoId: 10,
    amount: "1250.40",
    currency: "GTQ",
    transactionId: "synthetic-transaction-1",
  });
});

test("rechaza montos que no sean strings positivos con dos decimales", async () => {
  const { nexaPaymentSchema } = await import("./nexaPayments");
  const base = {
    externalReference: "qa-payment-1",
    creditoId: 10,
    currency: "GTQ" as const,
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
  };

  expect(nexaPaymentSchema.safeParse({ ...base, currency: "USD" }).success).toBe(false);
  expect(
    nexaPaymentSchema.safeParse({ ...base, currency: "GTQ", token: "do-not-store" }).success,
  ).toBe(false);
});

test("limita referencias al tamaño persistible", async () => {
  const { nexaPaymentSchema } = await import("./nexaPayments");
  const base = { creditoId: 10, amount: "10.00", currency: "GTQ" as const };

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
  const base = { amount: "10.00", currency: "GTQ" as const };

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
  expect(rejectBinding(null, "10.00", now)).toBe("binding_missing");
  expect(rejectBinding({ activo: false, expires_at: null, max_payment_amount: null }, "10.00", now))
    .toBe("binding_inactive");
  expect(
    rejectBinding(
      { activo: true, expires_at: new Date("2026-09-08T11:59:59.000Z"), max_payment_amount: null },
      "10.00",
      now,
    ),
  ).toBe("binding_expired");
  expect(
    rejectBinding(
      { activo: true, expires_at: null, max_payment_amount: "9.99" },
      "10.00",
      now,
    ),
  ).toBe("amount_exceeds_binding");
  expect(
    rejectBinding(
      { activo: true, expires_at: null, max_payment_amount: "10.00" },
      "10.00",
      now,
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
    {
      externalReference: "qa-payment-1",
      creditoId: 10,
      amount: "10.00",
      currency: "GTQ",
    },
    { nonce: "nonce-1", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null },
      }),
      findPayments: async () => registered
        ? [{ paymentId: 17, validationStatus: "pending", amount: "10.00" }]
        : [],
      registerPayment: async () => { registered += 1; return { success: true }; },
      applyPayment: async () => { applied += 1; return { success: true }; },
      complete: async () => { completed += 1; },
      fail: async () => undefined,
    },
  );

  expect(result).toEqual({ paymentId: 17, idempotent: false });
  expect({ registered, applied, completed }).toEqual({ registered: 1, applied: 1, completed: 1 });
});

test("no consume claim cuando el crédito no existe", async () => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let claimed = false;

  await expect(processNexaPayment(
    { externalReference: "missing-credit", creditoId: 10, amount: "10.00", currency: "GTQ" },
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
    { externalReference: "expired-in-lock", creditoId: 10, amount: "10.00", currency: "GTQ" },
    { nonce: "nonce-expired", payloadHash: "a".repeat(64), now: new Date("2026-09-08T11:59:00Z") },
    {
      now: () => new Date("2026-09-08T12:01:00Z"),
      withCreditLock: async (_creditoId, work) => { calls.push("lock"); return work(paymentLock); },
      claim: async () => { calls.push("claim"); return { kind: "new", eventId: 7 }; },
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: new Date("2026-09-08T12:00:00Z"), max_payment_amount: null },
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
    { externalReference: `binding-${mode}`, creditoId: 10, amount: "10.00", currency: "GTQ" },
    { nonce: `nonce-${mode}`, payloadHash: "a".repeat(64), now },
    {
      now: () => now,
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: active, expires_at: new Date("2026-09-08T12:00:00Z"), max_payment_amount: null },
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
    { externalReference: "partial-link", creditoId: 10, amount: "10.00", currency: "GTQ" },
    { nonce: "nonce-partial", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "retry", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null },
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
    { externalReference: "undefined-success", creditoId: 10, amount: "10.00", currency: "GTQ" },
    { nonce: "nonce-undefined", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "retry", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null },
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
    { externalReference: "partial-mora", creditoId: 10, amount: "10.00", currency: "GTQ" },
    { nonce: "nonce-partial-mora", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "MOROSO",
        binding: { activo: true, expires_at: null, max_payment_amount: null },
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
    },
  );

  expect(result).toEqual({ paymentId: 17, idempotent: false });
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
    { externalReference: "registration-result", creditoId: 10, amount: "10.00", currency: "GTQ" },
    { nonce: "nonce-registration", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null },
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
      { externalReference: "uncertain-registration", creditoId: 10, amount: "10.00", currency: "GTQ" },
      { nonce: "nonce-uncertain", payloadHash: "a".repeat(64), now: new Date() },
      {
        withCreditLock: async (_creditoId, work) => work(paymentLock),
        claim: async () => ({ kind: "new", eventId: 7 }),
        loadCredit: async () => ({
          usuarioId: 5,
          statusCredit: "MOROSO",
          binding: { activo: true, expires_at: null, max_payment_amount: null },
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
    { externalReference: "uncertain-registration", creditoId: 10, amount: "10.00", currency: "GTQ" },
    { nonce: "nonce-uncertain-retry", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "manual_review" }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "MOROSO",
        binding: { activo: true, expires_at: null, max_payment_amount: null },
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

test("devuelve el mismo paymentId en un reintento ya aplicado", async () => {
  const { processNexaPayment } = await import("./nexaPayments");
  let mutated = false;
  const result = await processNexaPayment(
    { externalReference: "qa-payment-1", creditoId: 10, amount: "10.00", currency: "GTQ" },
    { nonce: "nonce-2", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "applied", paymentId: 17 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null },
      }),
      findPayments: async () => [],
      registerPayment: async () => { mutated = true; return { success: true }; },
      applyPayment: async () => { mutated = true; return { success: true }; },
      complete: async () => { mutated = true; },
      fail: async () => { mutated = true; },
    },
  );

  expect(result).toEqual({ paymentId: 17, idempotent: true });
  expect(mutated).toBe(false);
});

test.each(["conflict", "replay"] as const)("rechaza un claim %s sin mutar", async (kind) => {
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  let mutated = false;
  const promise = processNexaPayment(
    { externalReference: "qa-payment-1", creditoId: 10, amount: "10.00", currency: "GTQ" },
    { nonce: "nonce-2", payloadHash: "b".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null },
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

  expect(classify(event, false, requested)).toEqual({ kind: "retry", eventId: 7 });
  expect(classify({ ...event, status: "manual_review" }, false, requested))
    .toEqual({ kind: "manual_review" });
  expect(classify({ ...event, status: "applied", pago_id: 17 }, false, requested))
    .toEqual({ kind: "applied", paymentId: 17 });
  expect(classify(event, true, requested)).toEqual({ kind: "replay" });
  expect(classify(event, false, { ...requested, payloadHash: "b".repeat(64) }))
    .toEqual({ kind: "conflict" });
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
  const handler = createHandler({
    secret: `  ${secret}  `,
    now: () => 1_800_000_000_000,
    dependencies: {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: async () => ({ kind: "applied", paymentId: 17 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null },
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
  expect(result).toEqual({ status: "APPLIED", paymentId: 17, idempotent: true });
});

test("un fallo queda reintentable sin registrar ni aplicar dos veces", async () => {
  const { processNexaPayment } = await import("./nexaPayments");
  const body = { externalReference: "qa-retry-1", creditoId: 10, amount: "10.00", currency: "GTQ" as const };
  let eventStatus = "new";
  let registered = 0;
  let applyAttempts = 0;
  let paymentStatus = "pending";
  const dependencies = {
    withCreditLock: async (_creditoId: number, work: (_lock: PaymentAdvisoryLock) => Promise<{ paymentId: number; idempotent: boolean }>) => work(paymentLock),
    claim: async () => eventStatus === "new"
      ? { kind: "new" as const, eventId: 7 }
      : { kind: "retry" as const, eventId: 7 },
    loadCredit: async () => ({
      usuarioId: 5,
      statusCredit: "ACTIVO",
      binding: { activo: true, expires_at: null, max_payment_amount: null },
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
  };

  await expect(
    processNexaPayment(body, { nonce: "nonce-retry-1", payloadHash: "a".repeat(64), now: new Date() }, dependencies),
  ).rejects.toThrow("synthetic failure");
  await expect(
    processNexaPayment(body, { nonce: "nonce-retry-2", payloadHash: "a".repeat(64), now: new Date() }, dependencies),
  ).resolves.toEqual({ paymentId: 17, idempotent: false });
  expect({ registered, applyAttempts, eventStatus }).toEqual({ registered: 1, applyAttempts: 2, eventStatus: "applied" });
});

test("serializa requests concurrentes y devuelve un único paymentId", async () => {
  const { processNexaPayment } = await import("./nexaPayments");
  const body = { externalReference: "qa-concurrent-1", creditoId: 10, amount: "10.00", currency: "GTQ" as const };
  let tail = Promise.resolve();
  let eventStatus = "missing";
  let registered = 0;
  let applied = 0;
  const dependencies = {
    withCreditLock: async (_creditoId: number, work: (_lock: PaymentAdvisoryLock) => Promise<{ paymentId: number; idempotent: boolean }>) => {
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
      binding: { activo: true, expires_at: null, max_payment_amount: null },
    }),
    findPayments: async () => registered
      ? [{ paymentId: 17, validationStatus: applied ? "validated" : "pending", amount: "10.00" }]
      : [],
    registerPayment: async () => { registered += 1; return { success: true }; },
    applyPayment: async () => { applied += 1; return { success: true }; },
    complete: async () => { eventStatus = "applied"; },
    fail: async () => { eventStatus = "failed"; },
  };

  const results = await Promise.all([
    processNexaPayment(body, { nonce: "nonce-concurrent-1", payloadHash: "a".repeat(64), now: new Date() }, dependencies),
    processNexaPayment(body, { nonce: "nonce-concurrent-2", payloadHash: "a".repeat(64), now: new Date() }, dependencies),
  ]);

  expect(results).toEqual([
    { paymentId: 17, idempotent: false },
    { paymentId: 17, idempotent: true },
  ]);
  expect({ registered, applied }).toEqual({ registered: 1, applied: 1 });
});

test("serializa referencias distintas del mismo crédito", async () => {
  const { processNexaPayment } = await import("./nexaPayments");
  const locks = new Map<string | number, Promise<void>>();
  const lock = async (
    key: string | number,
    work: (_lock: PaymentAdvisoryLock) => Promise<{ paymentId: number; idempotent: boolean }>,
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
      binding: { activo: true, expires_at: null, max_payment_amount: null },
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
  };
  const context = { payloadHash: "a".repeat(64), now: new Date() };

  await Promise.all([
    processNexaPayment(
      { externalReference: "qa-credit-lock-1", creditoId: 10, amount: "10.00", currency: "GTQ" },
      { ...context, nonce: "nonce-credit-lock-1" },
      dependencies,
    ),
    processNexaPayment(
      { externalReference: "qa-credit-lock-2", creditoId: 10, amount: "10.00", currency: "GTQ" },
      { ...context, nonce: "nonce-credit-lock-2" },
      dependencies,
    ),
  ]);

  expect(maxActive).toBe(1);
});

test("calcula la fecha de pago en Guatemala", async () => {
  const module = await import("./nexaPayments");
  const formatDate = Reflect.get(module, "formatNexaPaymentDate");

  expect(formatDate).toBeFunction();
  if (typeof formatDate !== "function") return;
  expect(formatDate(new Date("2026-09-09T02:00:00Z"))).toBe("2026-09-08");
});
