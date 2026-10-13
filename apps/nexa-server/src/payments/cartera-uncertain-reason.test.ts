import { expect, test } from "bun:test";
import type { ApplicationClaim, ApplicationWorkerRepository } from "./application-worker";
import { runApplicationWorkerOnce } from "./application-worker";
import { CarteraPaymentRequestError, HttpCarteraPaymentClient } from "./cartera-client";

// Un desenlace incierto de cartera (503 payment_outcome_uncertain) se reintenta
// igual que antes, pero su código queda como failureReason: es lo que ve la
// revisión manual (admin, logs y correo) en vez de un genérico.

const claim: ApplicationClaim = {
  id: 7,
  reference: "4617307",
  amount: 50,
  currency: "GTQ",
  tokenDate: "2026-05-04T10:00:00-06:00",
  tokenIdentifier: "100000002",
  tokenPrefix: "32200",
  transactionId: "7293",
  wasReturn: 0,
  attemptCount: 3,
};

const cartera = (body: unknown, status = 503) => new HttpCarteraPaymentClient({
  baseUrl: "https://cartera.test",
  secret: "s".repeat(32),
  fetch: async () => Response.json(body, { status, statusText: "Service Unavailable" }),
});

const runWorker = async (client: HttpCarteraPaymentClient, maxAttempts: number) => {
  const failed: Array<[number, string, Date | null]> = [];
  let claimed = false;
  const repository: ApplicationWorkerRepository = {
    claimNextApplication: async () => claimed ? null : (claimed = true, claim),
    resolveCreditoId: async () => 42,
    finalizeApplication: async () => { throw new Error("an uncertain outcome must not be finalized"); },
    markApplicationFailed: async (id, reason, nextAttemptAt) => { failed.push([id, reason, nextAttemptAt]); },
  };
  await runApplicationWorkerOnce({
    repository,
    cartera: client,
    now: () => new Date("2026-09-08T12:00:00Z"),
    leaseSeconds: 10,
    maxAttempts,
    backoffSeconds: 1,
    maxBackoffSeconds: 10,
  });
  return failed;
};

test("el 503 payment_outcome_uncertain sigue siendo reintentable y trae el código de cartera", async () => {
  const error = await cartera({ error: "payment_outcome_uncertain" })
    .applyNexaPayment({ creditoId: 42, transaction: { reference: "r", amount: 50, currency: "GTQ", tokenDate: claim.tokenDate } })
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(CarteraPaymentRequestError);
  expect((error as CarteraPaymentRequestError).retryable).toBe(true);
  expect((error as CarteraPaymentRequestError).reason).toBe("payment_outcome_uncertain");
});

test("un 503 sin código incierto no trae reason: el worker guarda el genérico", async () => {
  expect(await runWorker(cartera({ error: "configuration_error" }), 5))
    .toEqual([[7, "application_processing_failed", new Date("2026-09-08T12:00:04Z")]]);
});

test("el worker guarda payment_outcome_uncertain como failureReason: con reintento, y al agotarlos (MANUAL_REVIEW)", async () => {
  expect(await runWorker(cartera({ error: "payment_outcome_uncertain" }), 5))
    .toEqual([[7, "payment_outcome_uncertain", new Date("2026-09-08T12:00:04Z")]]);
  expect(await runWorker(cartera({ error: "payment_outcome_uncertain" }), 3))
    .toEqual([[7, "payment_outcome_uncertain", null]]);
});

test("un campo de más en el 503 (de una cartera más nueva) se tolera", async () => {
  expect(await runWorker(cartera({ error: "payment_outcome_uncertain", detalle: "lo que sea" }), 3))
    .toEqual([[7, "payment_outcome_uncertain", null]]);
});

test.each([
  ["anulada", "payment_outcome_uncertain:condonacion_anulada"],
  ["conservada", "payment_outcome_uncertain:condonacion_conservada"],
  ["conservada_pago_posterior", "payment_outcome_uncertain:condonacion_conservada_pago_posterior"],
  ["sin_verificar", "payment_outcome_uncertain:condonacion_sin_verificar"],
])("el 503 incierto con condonacion=%s queda en el failureReason como %s", async (condonacion, reason) => {
  expect(await runWorker(cartera({ error: "payment_outcome_uncertain", condonacion }), 3))
    .toEqual([[7, reason, null]]);
});

test("una condonacion desconocida (o texto libre) se ignora: queda el código solo", async () => {
  for (const condonacion of ["otra_cosa", "Texto Libre", 7]) {
    expect(await runWorker(cartera({ error: "payment_outcome_uncertain", condonacion }), 3))
      .toEqual([[7, "payment_outcome_uncertain", null]]);
  }
});

test("condonacion solo acompaña a payment_outcome_uncertain", async () => {
  expect(await runWorker(cartera({ error: "payment_amount_mismatch", condonacion: "anulada" }), 3))
    .toEqual([[7, "payment_amount_mismatch", null]]);
});
