import { tokenDateSchema, type ReviewTransferStatus } from "../nexa/schemas";
import { CarteraPaymentRequestError, formatAmount, type CarteraPaymentClient, type CarteraTokenClient } from "./cartera-client";

export type ApplicationClaim = {
  id: number;
  reference: string;
  amount: number;
  currency: "GTQ" | "USD";
  tokenDate: string;
  tokenIdentifier: string;
  tokenPrefix: string;
  transactionId: string;
  wasReturn: 0 | 1;
  attemptCount: number;
  retryAttemptCount?: number;
  carteraPaymentId?: number | null;
};

export type ApplicationWorkerRepository = {
  claimNextApplication(now: Date, leaseSeconds: number): Promise<ApplicationClaim | null>;
  resolveCreditoId(tokenIdentifier: string, tokenPrefix: string): Promise<number | null>;
  finalizeApplication(id: number, outcome: {
    paymentId: number | null;
    reviewStatus: ReviewTransferStatus;
    failureReason: string | null;
    nextAttemptAt?: Date | null;
  }, now: Date, attemptCount: number): Promise<void>;
  markApplicationFailed(id: number, reason: string, nextAttemptAt: Date | null, now: Date, attemptCount: number): Promise<void>;
};

export type TokenRepair = {
  findTokenUser(tokenIdentifier: string, tokenPrefix: string): Promise<{
    creditoId: number;
    token: string;
    identifier: string;
    nexaUserId: number;
  } | null>;
  cartera: CarteraTokenClient;
};

export async function runApplicationWorkerOnce(options: {
  repository: ApplicationWorkerRepository;
  cartera: CarteraPaymentClient;
  now?: () => Date;
  leaseSeconds: number;
  maxAttempts: number;
  backoffSeconds: number;
  maxBackoffSeconds: number;
  tokenRepair?: TokenRepair;
}) {
  const now = options.now?.() ?? new Date();
  const claim = await options.repository.claimNextApplication(now, options.leaseSeconds);
  if (!claim) return false;

  try {
    if (claim.wasReturn === 1) {
      await options.repository.finalizeApplication(claim.id, {
        paymentId: null,
        reviewStatus: "REJECTED",
        failureReason: "returned_transfer",
      }, now, claim.attemptCount);
      return true;
    }

    const tokenDate = tokenDateSchema.parse(claim.tokenDate);
    const unsupportedReason = getUnsupportedTransactionReason(claim);
    if (unsupportedReason) {
      await options.repository.finalizeApplication(claim.id, {
        paymentId: null,
        reviewStatus: "REJECTED",
        failureReason: unsupportedReason,
      }, now, claim.attemptCount);
      return true;
    }

    const creditoId = await options.repository.resolveCreditoId(claim.tokenIdentifier, claim.tokenPrefix);
    if (!creditoId) {
      if (claim.carteraPaymentId) throw new Error("Billing credit could not be resolved");
      await options.repository.finalizeApplication(claim.id, {
        paymentId: null,
        reviewStatus: "REJECTED",
        failureReason: "token_user_not_found",
      }, now, claim.attemptCount);
      return true;
    }

    const paymentInput = {
      creditoId,
      transaction: {
        reference: claim.reference,
        amount: claim.amount,
        currency: claim.currency,
        tokenDate,
        transactionId: claim.transactionId,
        // nexa-server no persiste el token completo: es prefijo + identificador,
        // igual que lo parte el webhook (slice(0, -9) / slice(-9)).
        token: `${claim.tokenPrefix}${claim.tokenIdentifier}`,
      },
    };
    let result = await options.cartera.applyNexaPayment(paymentInput);
    let repairFailure: string | null = null;
    if (
      result.status === "REJECTED"
      && options.tokenRepair
      && ["binding_missing", "binding_token_missing"].includes(safeRejectionReason(result.reason))
    ) {
      // Cartera todavía no conoce el token de este crédito: se lo registramos y
      // reintentamos una vez, en vez de que el banco rechace la transferencia.
      const tokenUser = await options.tokenRepair.findTokenUser(claim.tokenIdentifier, claim.tokenPrefix);
      if (!tokenUser || tokenUser.creditoId !== creditoId) {
        // El crédito salió de este mismo token: si ahora no se encuentra (o es
        // otro), son nuestros datos los que no cuadran, no el pago del cliente.
        repairFailure = tokenUser ? "credit_mismatch" : "token_user_not_found";
      } else {
        const registered = await options.tokenRepair.cartera.registerNexaToken({
          creditoId: tokenUser.creditoId,
          token: paymentInput.transaction.token,
          identifier: tokenUser.identifier,
          nexaUserId: tokenUser.nexaUserId,
        });
        if (registered.status !== "REJECTED") {
          result = await options.cartera.applyNexaPayment(paymentInput);
        } else if (DEFINITIVE_REJECTIONS.has(registered.reason)) {
          result = { status: "REJECTED", reason: registered.reason };
        } else if (registered.reason === "replay" || /^http_\d{3}$/.test(registered.reason)) {
          // Nonce repetido o una respuesta que no es de cartera (404 de una
          // réplica vieja, HTML de un proxy): transitorio, se reintenta.
          throw new Error(`Token repair failed transiently: ${registered.reason}`);
        } else {
          repairFailure = safeRejectionReason(registered.reason);
        }
      }
    }
    if (claim.carteraPaymentId && (result.status !== "APPLIED" || result.paymentId !== claim.carteraPaymentId)) {
      throw new Error("Billing retry did not confirm the applied payment");
    }
    if (repairFailure) {
      await options.repository.markApplicationFailed(claim.id, `token_repair_failed:${repairFailure}`, null, now, claim.attemptCount);
      return true;
    }
    if (result.status === "REJECTED") {
      const reason = safeRejectionReason(result.reason);
      if (reason === "replay" || reason === "cartera_rejected") {
        // replay: la primera entrega pudo entrar; el reintento (nonce nuevo) lo
        // confirma. cartera_rejected: la respuesta no trae un código de cartera.
        throw new Error(`Cartera payment outcome not definitive: ${reason}`);
      }
      if (!DEFINITIVE_REJECTIONS.has(reason)) {
        // Rechazar haría que Nexa devuelva el dinero: sin certeza, lo mira una persona.
        await options.repository.markApplicationFailed(claim.id, reason, null, now, claim.attemptCount);
        return true;
      }
    }
    await options.repository.finalizeApplication(claim.id, result.status === "APPLIED" ? {
      paymentId: result.paymentId,
      reviewStatus: "APPROVED",
      failureReason: result.billingStatus === "PENDING" ? "billing_pending" : null,
      // A disabled fiscal feature is a successful wait, not an exhausted retry.
      nextAttemptAt: result.billingStatus === "PENDING"
        ? getNextAttemptAt(now, claim.attemptCount, Infinity, options.backoffSeconds, options.maxBackoffSeconds)
        : null,
    } : {
      paymentId: null,
      reviewStatus: "REJECTED",
      failureReason: safeRejectionReason(result.reason),
    }, now, claim.attemptCount);
  } catch (error) {
    const nextAttemptAt = getNextAttemptAt(
      now,
      claim.retryAttemptCount ?? claim.attemptCount,
      options.maxAttempts,
      options.backoffSeconds,
      options.maxBackoffSeconds,
    );
    await options.repository.markApplicationFailed(
      claim.id,
      // Un desenlace incierto de cartera conserva su código (y el detalle que
      // traiga): es lo que la revisión manual necesita ver. Lo demás, genérico.
      error instanceof CarteraPaymentRequestError && error.reason ? error.reason : "application_processing_failed",
      nextAttemptAt,
      now,
      claim.attemptCount,
    );
    return true;
  }
  return true;
}

// Un REJECTED hace que Nexa le devuelva el dinero al cliente: solo se rechaza
// cuando cartera prueba que el pago no puede aplicarse nunca. Todo otro código
// (token_mismatch, binding_*_missing, conflict, credit_not_payable,
// payment_not_applied, uno desconocido...) va a revisión manual.
// credit_not_found tampoco es definitivo: el crédito sale del token mismo, así
// que si cartera no lo conoce el error es nuestro, no del cliente.
const DEFINITIVE_REJECTIONS = new Set([
  // Un CANCELADO nunca se reactiva (lo responde el registro del token).
  "credit_cancelled",
  // El binding solo se desactiva al cancelar el crédito.
  "binding_inactive",
  // Límites configurados a propósito en el binding.
  "binding_expired",
  "amount_exceeds_binding",
]);

function getUnsupportedTransactionReason(claim: ApplicationClaim) {
  if (claim.currency !== "GTQ") return "unsupported_currency";
  try {
    formatAmount(claim.amount);
  } catch {
    return "invalid_amount";
  }
  const reference = claim.reference.trim();
  if (!reference || reference.length > 150) return "invalid_reference";
  if (claim.transactionId.trim().length > 100) return "invalid_transaction_id";
  return null;
}

function safeRejectionReason(reason: string) {
  const trimmed = reason.trim().slice(0, 128);
  if (/^[a-z0-9_]{1,64}$/.test(trimmed)) return trimmed;
  return trimmed.match(/\(([a-z0-9_]{1,64})\)$/)?.[1] ?? "cartera_rejected";
}

export function getNextAttemptAt(now: Date, attemptCount: number, maxAttempts: number, backoffSeconds: number, maxBackoffSeconds: number) {
  return attemptCount >= maxAttempts
    ? null
    : new Date(now.getTime() + Math.min(maxBackoffSeconds, backoffSeconds * 2 ** (attemptCount - 1)) * 1_000);
}
