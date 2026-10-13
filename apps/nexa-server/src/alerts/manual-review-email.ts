import type { AppConfig } from "../config";

export type ManualReviewEmailCase = {
  id: number;
  creditoId: number | null;
  amount: string;
  currency: string;
  reference: string;
  transactionId: string;
  failureReason: string | null;
  createdAt: Date;
  // Enmascarado en la consulta: solo los últimos 4 dígitos.
  maskedToken: string;
};

export type ManualReviewEmailRepository = {
  listUnsentManualReviewEmailAlerts(staleBefore: Date): Promise<ManualReviewEmailCase[]>;
  markManualReviewEmailAlertsSent(ids: number[], now: Date): Promise<void>;
};

export type EmailMessage = { to: string[]; subject: string; text: string };
export type EmailSender = (message: EmailMessage) => Promise<void>;

// Lo que falta para mandar alertas por correo; vacío = encendidas.
export function missingEmailAlertConfig(config: Pick<AppConfig, "nexaAlertasCorreos" | "resendApiKey" | "emailDomain">) {
  return [
    ...(config.nexaAlertasCorreos.length ? [] : ["NEXA_ALERTAS_CORREOS"]),
    ...(config.resendApiKey ? [] : ["RESEND_API_KEY"]),
    ...(config.emailDomain ? [] : ["EMAIL_DOMAIN"]),
  ];
}

// La API REST de Resend (el mismo proveedor y la misma llave que packages/email),
// sin sumar dependencias a la imagen de nexa-server.
export function createResendSender(options: { apiKey: string; domain: string; fetch?: typeof fetch; timeoutMs?: number }): EmailSender {
  const doFetch = options.fetch ?? fetch;
  return async (message) => {
    const response = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Nexa Cash In <no-reply@${options.domain}>`, ...message }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    if (!response.ok) throw new Error(`Resend responded HTTP ${response.status}`);
  };
}

const guatemalaTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Guatemala",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

export function buildManualReviewEmail(cases: ManualReviewEmailCase[]) {
  const subject = cases.length === 1
    ? "Nexa: 1 pago en revisión manual"
    : `Nexa: ${cases.length} pagos en revisión manual`;
  const lines = cases.map((item, index) => [
    `${index + 1}. ${item.creditoId === null ? "Crédito: sin asociar" : `Crédito ${item.creditoId}`} · ${item.amount} ${item.currency}`,
    `   Referencia: ${item.reference} · transactionId: ${item.transactionId || "(vacío)"}`,
    ...describeReason(item.failureReason),
    `   Recibido: ${guatemalaTime.format(item.createdAt)} (hora de Guatemala)`,
    `   Token: ${item.maskedToken}`,
  ].join("\n"));
  const text = [
    `${cases.length === 1 ? "Un pago Nexa quedó" : `${cases.length} pagos Nexa quedaron`} en revisión manual y necesita${cases.length === 1 ? "" : "n"} a una persona.`,
    "Qué hacer: revisar en nexa-server / cartera.",
    "",
    lines.join("\n\n"),
    "",
  ].join("\n");
  return { subject, text };
}

// Los motivos son códigos internos (token_mismatch, token_repair_failed:token_in_use);
// cualquier otra cosa no se copia al correo.
function safeReason(reason: string | null) {
  if (!reason) return "sin motivo registrado";
  return /^[a-z0-9_:]{1,128}$/.test(reason) ? reason : "processing_failed";
}

const UNCERTAIN = "payment_outcome_uncertain";

// Lo que cartera hizo con la condonación a tiempo de la mora cuando el pago quedó incierto.
const CONDONACION: Record<string, string> = {
  anulada: "condonación anulada (el crédito no quedó al día)",
  conservada: "condonación conservada (el crédito quedó al día)",
  conservada_pago_posterior: "condonación conservada (hay un pago posterior no vinculado que pudo ser esta transferencia; revisarlo)",
  sin_verificar: "condonación sin verificar (sigue vigente; revisarla a mano)",
};

// El código queda a la vista; el incierto de cartera se explica en español y,
// si trae lo que pasó con la condonación de la mora, va en su propio renglón.
function describeReason(reason: string | null) {
  const safe = safeReason(reason);
  const condonacion = safe.startsWith(`${UNCERTAIN}:condonacion_`)
    ? CONDONACION[safe.slice(`${UNCERTAIN}:condonacion_`.length)]
    : undefined;
  if (safe !== UNCERTAIN && !condonacion) return [`   Motivo: ${safe}`];
  return [
    `   Motivo: ${UNCERTAIN} (cartera no pudo confirmar si el pago quedó aplicado; quedó en revisión manual)`,
    ...(condonacion ? [`   Mora: ${condonacion}`] : []),
  ];
}

// Una pasada: un solo correo con todos los casos nuevos. Solo se marcan si el envío
// salió; si falla, queda el log y se reintenta en la próxima pasada.
export async function sendManualReviewEmailAlerts(options: {
  repository: ManualReviewEmailRepository;
  send: EmailSender;
  recipients: string[];
  staleBefore: Date;
  now: Date;
  logError: (message: string) => void;
}) {
  const cases = await options.repository.listUnsentManualReviewEmailAlerts(options.staleBefore);
  if (!cases.length) return 0;
  try {
    await options.send({ to: options.recipients, ...buildManualReviewEmail(cases) });
  } catch (error) {
    // Solo el estado HTTP de Resend: ningún otro detalle del error va al log.
    const status = error instanceof Error ? error.message.match(/^Resend responded (HTTP \d{3})$/)?.[1] : undefined;
    options.logError(`Manual review email alert failed for ${cases.length} case(s)${status ? ` (${status})` : ""}; retrying on the next scan`);
    return 0;
  }
  await options.repository.markManualReviewEmailAlertsSent(cases.map((item) => item.id), options.now);
  return cases.length;
}
