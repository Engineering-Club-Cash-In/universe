import { expect, test } from "bun:test";
import { loadConfig } from "../config";
import {
  buildManualReviewEmail,
  createResendSender,
  missingEmailAlertConfig,
  sendManualReviewEmailAlerts,
  type EmailMessage,
  type ManualReviewEmailCase,
} from "./manual-review-email";

const recipients = ["jalvarado@clubcashin.com", "l.ralda@clubcashin.com", "daniel.r@clubcashin.com"];
const now = new Date("2026-10-07T18:00:00Z");

const tokenMismatch: ManualReviewEmailCase = {
  id: 11,
  creditoId: 9234,
  amount: "1500.00",
  currency: "GTQ",
  reference: "4617307",
  transactionId: "7293",
  failureReason: "token_mismatch",
  createdAt: new Date("2026-10-07T16:15:00Z"),
  maskedToken: "************5010",
};
const repairFailed: ManualReviewEmailCase = {
  ...tokenMismatch,
  id: 12,
  creditoId: null,
  amount: "50.00",
  reference: "4617308",
  transactionId: "",
  failureReason: "token_repair_failed:token_in_use",
  createdAt: new Date("2026-10-08T05:30:00Z"),
};

// Repositorio en memoria que respeta la marca, como la columna alerta_correo_enviada_at.
function memoryRepository(cases: ManualReviewEmailCase[]) {
  const sent = new Map<number, Date>();
  return {
    sent,
    listUnsentManualReviewEmailAlerts: async () => cases.filter((item) => !sent.has(item.id)),
    markManualReviewEmailAlertsSent: async (ids: number[], at: Date) => { ids.forEach((id) => sent.set(id, at)); },
  };
}

test("los casos nuevos salen en UN correo con el resumen y no se repiten en la siguiente pasada", async () => {
  const repository = memoryRepository([tokenMismatch, repairFailed]);
  const messages: EmailMessage[] = [];
  const pass = () => sendManualReviewEmailAlerts({
    repository, send: async (message) => { messages.push(message); }, recipients, staleBefore: now, now, logError: () => {},
  });

  expect(await pass()).toBe(2);
  expect(await pass()).toBe(0);

  expect(messages).toHaveLength(1);
  expect(messages[0]).toEqual({
    to: recipients,
    subject: "Nexa: 2 pagos en revisión manual",
    text: [
      "2 pagos Nexa quedaron en revisión manual y necesitan a una persona.",
      "Qué hacer: revisar en nexa-server / cartera.",
      "",
      "1. Crédito 9234 · 1500.00 GTQ",
      "   Referencia: 4617307 · transactionId: 7293",
      "   Motivo: token_mismatch",
      "   Recibido: 2026-10-07 10:15 (hora de Guatemala)",
      "   Token: ************5010",
      "",
      "2. Crédito: sin asociar · 50.00 GTQ",
      "   Referencia: 4617308 · transactionId: (vacío)",
      "   Motivo: token_repair_failed:token_in_use",
      "   Recibido: 2026-10-07 23:30 (hora de Guatemala)",
      "   Token: ************5010",
      "",
    ].join("\n"),
  });
  expect([...repository.sent.entries()]).toEqual([[11, now], [12, now]]);
});

test("si el envío falla no se marca nada, queda un log y la próxima pasada lo reintenta", async () => {
  const repository = memoryRepository([tokenMismatch]);
  const errors: string[] = [];
  let attempts = 0;
  const pass = () => sendManualReviewEmailAlerts({
    repository,
    send: async () => { if (++attempts === 1) throw new Error("Resend responded HTTP 503"); },
    recipients, staleBefore: now, now, logError: (message) => errors.push(message),
  });

  expect(await pass()).toBe(0);
  expect(repository.sent.size).toBe(0);
  expect(errors).toEqual(["Manual review email alert failed for 1 case(s) (HTTP 503); retrying on the next scan"]);

  expect(await pass()).toBe(1);
  expect(attempts).toBe(2);
  expect(repository.sent.has(11)).toBe(true);
});

test("el log de un fallo no copia el detalle del error", async () => {
  const errors: string[] = [];
  await sendManualReviewEmailAlerts({
    repository: memoryRepository([tokenMismatch]),
    send: async () => { throw new Error("connect ECONNREFUSED re_secret_key 123456710005010"); },
    recipients, staleBefore: now, now, logError: (message) => errors.push(message),
  });
  expect(errors).toEqual(["Manual review email alert failed for 1 case(s); retrying on the next scan"]);
});

test("sin casos nuevos no se manda correo", async () => {
  let sends = 0;
  expect(await sendManualReviewEmailAlerts({
    repository: memoryRepository([]), send: async () => { sends++; }, recipients, staleBefore: now, now, logError: () => {},
  })).toBe(0);
  expect(sends).toBe(0);
});

test("un motivo que no es un código interno no se copia al correo", () => {
  const { subject, text } = buildManualReviewEmail([{ ...tokenMismatch, failureReason: "Cartera said: token 123456710005010 <b>" }]);
  expect(subject).toBe("Nexa: 1 pago en revisión manual");
  expect(text).toContain("Un pago Nexa quedó en revisión manual y necesita a una persona.");
  expect(text).toContain("Motivo: processing_failed");
  expect(text).not.toContain("123456710005010");
});

test("el sender de Resend manda el correo por la API REST y falla con el estado HTTP", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  let status = 200;
  const send = createResendSender({
    apiKey: "re_test_key",
    domain: "servicioscashin.com",
    fetch: (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response("{}", { status });
    }) as unknown as typeof fetch,
  });

  await send({ to: recipients, subject: "Nexa: 1 pago en revisión manual", text: "cuerpo" });
  expect(requests[0]?.url).toBe("https://api.resend.com/emails");
  expect(requests[0]?.init.headers).toEqual({ Authorization: "Bearer re_test_key", "Content-Type": "application/json" });
  expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
    from: "Nexa Cash In <no-reply@servicioscashin.com>",
    to: recipients,
    subject: "Nexa: 1 pago en revisión manual",
    text: "cuerpo",
  });

  status = 422;
  expect(send({ to: recipients, subject: "s", text: "t" })).rejects.toThrow("Resend responded HTTP 422");
});

const minimalEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/nexa",
  NEXA_BASE_URL: "https://open-bank.example.com",
  NEXA_API_KEY: "api-key",
  NEXA_BEARER_TOKEN: "bearer-token",
  NEXA_ACCUMULATOR_ACCOUNT: "123456",
  NEXA_PAYMENT_TOKEN_NAME: "Cashin",
  NEXA_WEBHOOK_FLOW_ID: "flow",
  NEXA_WEBHOOK_BEARER_TOKEN: "webhook-token",
  MOCK_CARTERA: "true",
};

test("config: la lista de correos se parte por comas y sin variables las alertas quedan apagadas", () => {
  const off = loadConfig({ ...minimalEnv, RESEND_API_KEY: "", EMAIL_DOMAIN: "" });
  expect(off.nexaAlertasCorreos).toEqual([]);
  expect(missingEmailAlertConfig(off)).toEqual(["NEXA_ALERTAS_CORREOS", "RESEND_API_KEY", "EMAIL_DOMAIN"]);

  const on = loadConfig({
    ...minimalEnv,
    NEXA_ALERTAS_CORREOS: " jalvarado@clubcashin.com, l.ralda@clubcashin.com ,daniel.r@clubcashin.com,",
    RESEND_API_KEY: "re_key",
    EMAIL_DOMAIN: "servicioscashin.com",
  });
  expect(on.nexaAlertasCorreos).toEqual(recipients);
  expect(missingEmailAlertConfig(on)).toEqual([]);

  expect(() => loadConfig({ ...minimalEnv, NEXA_ALERTAS_CORREOS: "jalvarado@clubcashin.com,no-es-correo" })).toThrow();
});

test("un pago incierto de cartera se explica y dice qué pasó con la condonación de la mora", () => {
  const incierto = (id: number, failureReason: string): ManualReviewEmailCase => ({ ...tokenMismatch, id, failureReason });
  const { text } = buildManualReviewEmail([
    incierto(21, "payment_outcome_uncertain:condonacion_anulada"),
    incierto(22, "payment_outcome_uncertain:condonacion_conservada"),
    incierto(23, "payment_outcome_uncertain:condonacion_conservada_pago_posterior"),
    incierto(24, "payment_outcome_uncertain:condonacion_sin_verificar"),
    incierto(25, "payment_outcome_uncertain"),
    incierto(26, "payment_outcome_uncertain:condonacion_otra_cosa"),
  ]);
  const casos = text.split("\n\n").slice(1, 7);
  const motivo = "   Motivo: payment_outcome_uncertain (cartera no pudo confirmar si el pago quedó aplicado; quedó en revisión manual)";
  expect(casos[0]).toContain(`${motivo}\n   Mora: condonación anulada (el crédito no quedó al día)\n`);
  expect(casos[1]).toContain(`${motivo}\n   Mora: condonación conservada (el crédito quedó al día)\n`);
  expect(casos[2]).toContain(`${motivo}\n   Mora: condonación conservada (hay un pago posterior no vinculado que pudo ser esta transferencia; revisarlo)\n`);
  expect(casos[3]).toContain(`${motivo}\n   Mora: condonación sin verificar (sigue vigente; revisarla a mano)\n`);
  // Sin condonación: solo el motivo explicado, sin renglón de mora.
  expect(casos[4]).toContain(`${motivo}\n   Recibido:`);
  // Un detalle que el correo no conoce queda como código, sin inventar texto.
  expect(casos[5]).toContain("   Motivo: payment_outcome_uncertain:condonacion_otra_cosa\n   Recibido:");
  expect(text.match(/   Mora: /g)).toHaveLength(4);
});
