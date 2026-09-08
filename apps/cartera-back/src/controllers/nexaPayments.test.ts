import { createHash, createHmac } from "node:crypto";
import { expect, test } from "bun:test";

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
      withCreditLock: async (_creditoId, work) => work(),
      claim: async () => ({ kind: "new", eventId: 7 }),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null },
      }),
      findPayments: async () => registered
        ? [{ paymentId: 17, validationStatus: "pending" }]
        : [],
      registerPayment: async () => { registered += 1; },
      applyPayment: async () => { applied += 1; return { success: true }; },
      complete: async () => { completed += 1; },
      fail: async () => undefined,
    },
  );

  expect(result).toEqual({ paymentId: 17, idempotent: false });
  expect({ registered, applied, completed }).toEqual({ registered: 1, applied: 1, completed: 1 });
});

test("devuelve el mismo paymentId en un reintento ya aplicado", async () => {
  const { processNexaPayment } = await import("./nexaPayments");
  let mutated = false;
  const result = await processNexaPayment(
    { externalReference: "qa-payment-1", creditoId: 10, amount: "10.00", currency: "GTQ" },
    { nonce: "nonce-2", payloadHash: "a".repeat(64), now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(),
      claim: async () => ({ kind: "applied", paymentId: 17 }),
      loadCredit: async () => { mutated = true; return null; },
      findPayments: async () => [],
      registerPayment: async () => { mutated = true; },
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
      withCreditLock: async (_creditoId, work) => work(),
      claim: async () => ({ kind }),
      loadCredit: async () => { mutated = true; return null; },
      findPayments: async () => [],
      registerPayment: async () => { mutated = true; },
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
  const signature = createHmac("sha256", "synthetic-secret").update(canonical).digest("hex");
  const set: { status?: number | string } = {};
  const handler = createHandler({
    secret: "synthetic-secret",
    now: () => 1_800_000_000_000,
    dependencies: {
      withCreditLock: async (_creditoId, work) => work(),
      claim: async () => ({ kind: "applied", paymentId: 17 }),
      loadCredit: async () => null,
      findPayments: async () => [],
      registerPayment: async () => undefined,
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
    withCreditLock: async (_creditoId: number, work: () => Promise<{ paymentId: number; idempotent: boolean }>) => work(),
    claim: async () => eventStatus === "new"
      ? { kind: "new" as const, eventId: 7 }
      : { kind: "retry" as const, eventId: 7 },
    loadCredit: async () => ({
      usuarioId: 5,
      statusCredit: "ACTIVO",
      binding: { activo: true, expires_at: null, max_payment_amount: null },
    }),
    findPayments: async () => registered
      ? [{ paymentId: 17, validationStatus: paymentStatus }]
      : [],
    registerPayment: async () => { registered += 1; },
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
    withCreditLock: async (_creditoId: number, work: () => Promise<{ paymentId: number; idempotent: boolean }>) => {
      const previous = tail;
      let release: () => void = () => undefined;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await work(); } finally { release(); }
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
      ? [{ paymentId: 17, validationStatus: applied ? "validated" : "pending" }]
      : [],
    registerPayment: async () => { registered += 1; },
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
    work: () => Promise<{ paymentId: number; idempotent: boolean }>,
  ) => {
    const previous = locks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    locks.set(key, current);
    await previous;
    try {
      return await work();
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
      ? [{ paymentId: eventId + 10, validationStatus: "pending" }]
      : [],
    registerPayment: async (_body: unknown, eventId: number) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep(10);
      registered.add(eventId);
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
