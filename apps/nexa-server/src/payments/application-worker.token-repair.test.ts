import { expect, test } from "bun:test";
import type { ApplicationClaim, ApplicationWorkerRepository } from "./application-worker";
import { runApplicationWorkerOnce } from "./application-worker";
import { HttpCarteraPaymentClient } from "./cartera-client";

// Un REJECTED hace que Nexa le devuelva el dinero al cliente: solo puede salir
// de un rechazo definitivo de cartera. Lo demás se reintenta o va a MANUAL_REVIEW.

const baseClaim: ApplicationClaim = {
  id: 7,
  reference: "4617307",
  amount: 50,
  currency: "GTQ",
  tokenDate: "2026-05-04T10:00:00-06:00",
  tokenIdentifier: "10005010",
  tokenPrefix: "1234567",
  transactionId: "7293",
  wasReturn: 0,
  attemptCount: 1,
};

function repository(claim: ApplicationClaim, callbacks: {
  finalize: (...args: Parameters<ApplicationWorkerRepository["finalizeApplication"]>) => void;
  fail: (...args: Parameters<ApplicationWorkerRepository["markApplicationFailed"]>) => void;
}): ApplicationWorkerRepository {
  let claimed = false;
  return {
    claimNextApplication: async () => claimed ? null : (claimed = true, claim),
    resolveCreditoId: async () => 42,
    finalizeApplication: async (...args) => callbacks.finalize(...args),
    markApplicationFailed: async (...args) => callbacks.fail(...args),
  };
}

const tokenUser = { creditoId: 42, token: "1234567310005010", identifier: "310005010", nexaUserId: 5 };
const rejectedBy = (code: string) => ({ status: "REJECTED" as const, reason: `Cartera payment rejected: HTTP 403 Forbidden (${code})` });

// Desenlaces: "approved", "retry" (reintento), "manual:<motivo>" (MANUAL_REVIEW,
// sin revisión hacia Nexa) o "rejected:<motivo>" (Nexa devuelve el dinero).
test.each([
  { name: "binding_token_missing: registra el token y aprueba", code: "binding_token_missing", outcome: "approved", applies: 2, registers: 1 },
  { name: "binding_missing: registra el token y aprueba", code: "binding_missing", outcome: "approved", applies: 2, registers: 1 },
  { name: "el registro falla: queda para reintento, no se rechaza", code: "binding_token_missing", register: "throw", outcome: "retry", applies: 1, registers: 1 },
  { name: "cartera rechaza el registro con token_conflict: revisión manual, no rechazo", code: "binding_token_missing", register: "token_conflict", outcome: "manual:token_repair_failed:token_conflict", applies: 1, registers: 1 },
  { name: "cartera responde credit_cancelled: desactiva el token user local y rechaza", code: "binding_token_missing", register: "credit_cancelled", outcome: "rejected:credit_cancelled", applies: 1, registers: 1, deactivated: [42] },
  { name: "cartera responde credit_not_found al registrar: revisión manual, no rechazo", code: "binding_token_missing", register: "credit_not_found", outcome: "manual:token_repair_failed:credit_not_found", applies: 1, registers: 1 },
  { name: "registrado pero cartera sigue sin binding: revisión manual", code: "binding_token_missing", secondApply: "binding_token_missing", outcome: "manual:binding_token_missing", applies: 2, registers: 1 },
  { name: "token_mismatch no se repara: revisión manual", code: "token_mismatch", outcome: "manual:token_mismatch", applies: 1, registers: 0, lookups: 0 },
  { name: "sin tokenRepair: revisión manual", code: "binding_token_missing", noRepair: true, outcome: "manual:binding_token_missing", applies: 1, registers: 0, lookups: 0 },
  { name: "el token user es de otro crédito: no registra, revisión manual", code: "binding_token_missing", user: { ...tokenUser, creditoId: 99 }, outcome: "manual:token_repair_failed:credit_mismatch", applies: 1, registers: 0 },
  { name: "findTokenUser no encuentra el token user: revisión manual", code: "binding_token_missing", user: null, outcome: "manual:token_repair_failed:token_user_not_found", applies: 1, registers: 0, lookups: 1 },
] as const)("auto-reparación del token: $name", async (c) => {
  const finalized: unknown[][] = [];
  const failed: unknown[][] = [];
  const registered: unknown[] = [];
  let applies = 0;
  let lookups = 0;
  const deactivated: number[] = [];

  await runApplicationWorkerOnce({
    repository: repository(baseClaim, { finalize: (...args) => { finalized.push(args); }, fail: (...args) => { failed.push(args); } }),
    cartera: {
      applyNexaPayment: async () => (++applies === 1
        ? rejectedBy(c.code)
        : "secondApply" in c ? rejectedBy(c.secondApply as string) : { status: "APPLIED", paymentId: 701 }),
    },
    ...("noRepair" in c ? {} : {
      tokenRepair: {
        findTokenUser: async () => (lookups++, ("user" in c ? c.user : tokenUser) as typeof tokenUser | null),
        cartera: {
          registerNexaToken: async (input) => {
            registered.push(input);
            if ("register" in c && c.register === "throw") throw new Error("cartera caído");
            return "register" in c ? { status: "REJECTED", reason: c.register as string } : { status: "CREATED" };
          },
        },
        cancelledTokenUsers: { deactivateByCreditoId: async (creditoId) => (deactivated.push(creditoId), 1) },
      },
    }),
    now: () => new Date("2026-09-08T12:00:00Z"),
    leaseSeconds: 10, maxAttempts: 3, backoffSeconds: 1, maxBackoffSeconds: 10,
  });

  expect({ applies, registers: registered.length }).toEqual({ applies: c.applies as number, registers: c.registers as number });
  if ("lookups" in c) expect(lookups).toBe(c.lookups as number);
  // Solo credit_cancelled desactiva el token user local.
  expect(deactivated).toEqual("deactivated" in c ? [...(c.deactivated as readonly number[])] : []);
  // Se registra prefijo + identificador del pago (lo que cartera compara), no el token de Nexa.
  if (c.registers) expect(registered[0]).toEqual({ ...tokenUser, token: "123456710005010" });
  expectOutcome(c.outcome, finalized, failed);
});

function expectOutcome(outcome: string, finalized: unknown[][], failed: unknown[][]) {
  const now = new Date("2026-09-08T12:00:00Z");
  if (outcome === "retry") {
    expect(finalized).toEqual([]);
    expect(failed).toEqual([[7, "application_processing_failed", new Date("2026-09-08T12:00:01Z"), now, 1]]);
  } else if (outcome === "approved") {
    expect(failed).toEqual([]);
    expect(finalized[0]?.[1]).toEqual({ paymentId: 701, reviewStatus: "APPROVED", failureReason: null, nextAttemptAt: null });
  } else if (outcome.startsWith("manual:")) {
    // markApplicationFailed sin próximo intento = MANUAL_REVIEW, sin revisión hacia Nexa.
    expect(finalized).toEqual([]);
    expect(failed).toEqual([[7, outcome.slice("manual:".length), null, now, 1]]);
  } else {
    expect(failed).toEqual([]);
    expect(finalized).toEqual([[7, { paymentId: null, reviewStatus: "REJECTED", failureReason: outcome.slice("rejected:".length) }, now, 1]]);
  }
}

// Con el cliente HTTP real y fetch simulado: lo que cartera (o lo que se hace
// pasar por cartera) responde al pago y al registro del token.
const respond = (status: number, body: unknown) => typeof body === "string"
  ? new Response(body, { status, headers: { "Content-Type": "text/html" } })
  : Response.json(body, { status });

async function runWithHttpCartera(responses: { payment: Response[]; token?: Response }) {
  const finalized: unknown[][] = [];
  const failed: unknown[][] = [];
  const paths: string[] = [];
  const cartera = new HttpCarteraPaymentClient({
    baseUrl: "https://cartera.example.com",
    secret: "c".repeat(32),
    clock: () => Date.parse("2026-09-08T12:00:00Z"),
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      const next = path === "/internal/nexa/tokens" ? responses.token : responses.payment.shift();
      if (!next) throw new Error(`unexpected request to ${path}`);
      return next;
    },
  });
  const user = { creditoId: 42, token: "32200100000002", identifier: "100000002", nexaUserId: 5 };
  await runApplicationWorkerOnce({
    repository: repository({ ...baseClaim, tokenPrefix: "32200", tokenIdentifier: "100000002" }, {
      finalize: (...args) => { finalized.push(args); },
      fail: (...args) => { failed.push(args); },
    }),
    cartera,
    tokenRepair: {
      findTokenUser: async () => user,
      cartera,
      cancelledTokenUsers: { deactivateByCreditoId: async () => 1 },
    },
    now: () => new Date("2026-09-08T12:00:00Z"),
    leaseSeconds: 10, maxAttempts: 3, backoffSeconds: 1, maxBackoffSeconds: 10,
  });
  return { finalized, failed, paths };
}

const bindingTokenMissing = () => respond(403, { error: "binding_token_missing" });

test.each([
  { name: "404 NOT_FOUND (réplica vieja de cartera)", token: () => respond(404, "NOT_FOUND"), outcome: "retry" },
  { name: "403 HTML de un proxy", token: () => respond(403, "<html><body>Forbidden</body></html>"), outcome: "retry" },
  { name: "409 replay", token: () => respond(409, { error: "replay" }), outcome: "retry" },
  { name: "503", token: () => respond(503, {}), outcome: "retry" },
  { name: "409 token_in_use", token: () => respond(409, { error: "token_in_use" }), outcome: "manual:token_repair_failed:token_in_use" },
  { name: "409 token_conflict", token: () => respond(409, { error: "token_conflict" }), outcome: "manual:token_repair_failed:token_conflict" },
  { name: "409 credit_cancelled", token: () => respond(409, { error: "credit_cancelled" }), outcome: "rejected:credit_cancelled" },
  { name: "404 credit_not_found", token: () => respond(404, { error: "credit_not_found" }), outcome: "manual:token_repair_failed:credit_not_found" },
])("reparación por HTTP: cartera responde $name al registro del token", async (c) => {
  const { finalized, failed, paths } = await runWithHttpCartera({ payment: [bindingTokenMissing()], token: c.token() });
  expect(paths).toEqual(["/internal/nexa/payments/apply", "/internal/nexa/tokens"]);
  expectOutcome(c.outcome, finalized, failed);
});

test.each([
  // Datos nuestros que no cuadran o desenlace no definitivo: nunca se devuelve el dinero.
  { name: "403 token_mismatch", response: () => respond(403, { error: "token_mismatch" }), outcome: "manual:token_mismatch" },
  { name: "409 conflict", response: () => respond(409, { error: "conflict" }), outcome: "manual:conflict" },
  { name: "409 credit_not_payable", response: () => respond(409, { error: "credit_not_payable" }), outcome: "manual:credit_not_payable" },
  { name: "409 payment_not_applied", response: () => respond(409, { error: "payment_not_applied" }), outcome: "manual:payment_not_applied" },
  { name: "409 payment_registration_rejected", response: () => respond(409, { error: "payment_registration_rejected" }), outcome: "manual:payment_registration_rejected" },
  { name: "409 replay", response: () => respond(409, { error: "replay" }), outcome: "retry" },
  { name: "404 NOT_FOUND", response: () => respond(404, "NOT_FOUND"), outcome: "retry" },
  { name: "422 <html>Unprocessable</html>", response: () => respond(422, "<html>Unprocessable</html>"), outcome: "retry" },
  // El crédito sale del token: si cartera no lo conoce, el error es nuestro.
  { name: "404 credit_not_found", response: () => respond(404, { error: "credit_not_found" }), outcome: "manual:credit_not_found" },
  // Rechazos definitivos: el pago no puede aplicarse nunca.
  { name: "403 binding_inactive", response: () => respond(403, { error: "binding_inactive" }), outcome: "rejected:binding_inactive" },
  { name: "403 binding_expired", response: () => respond(403, { error: "binding_expired" }), outcome: "rejected:binding_expired" },
  { name: "403 amount_exceeds_binding", response: () => respond(403, { error: "amount_exceeds_binding" }), outcome: "rejected:amount_exceeds_binding" },
])("clasificación del pago: cartera responde $name", async (c) => {
  const { finalized, failed, paths } = await runWithHttpCartera({ payment: [c.response()] });
  expect(paths).toEqual(["/internal/nexa/payments/apply"]);
  expectOutcome(c.outcome, finalized, failed);
});
