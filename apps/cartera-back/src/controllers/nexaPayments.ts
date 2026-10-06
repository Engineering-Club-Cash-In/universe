import { createHash } from "node:crypto";
import Big from "big.js";
import { z } from "zod";
import type { PaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
import { verifyNexaHmac } from "./nexaHmac";

export const nexaPaymentSchema = z
  .object({
    externalReference: z.string().trim().min(1).max(150),
    creditoId: z.number().int().positive().max(2_147_483_647),
    amount: z.string().regex(/^(?=.*[1-9])(?:0|[1-9]\d{0,15})\.\d{2}$/),
    currency: z.literal("GTQ"),
    tokenDate: z.string().datetime({ offset: true })
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid tokenDate")
      .optional(),
    transactionId: z.string().trim().max(100).transform((value) => value || undefined).optional(),
    // Mismo formato que acepta el registro del token: prefijo variable + 9 dígitos.
    token: z.string().regex(/^\d{10,32}$/).optional(),
  })
  .strict();

type NexaCreditBinding = {
  activo: boolean;
  expires_at: Date | null;
  max_payment_amount: string | null;
  nexa_token?: string | null;
};

export const getNexaBindingRejection = (
  binding: NexaCreditBinding | null,
  amount: string,
  now: Date,
  token: string | undefined,
) => {
  if (!binding) return "binding_missing" as const;
  if (!binding.activo) return "binding_inactive" as const;
  if (binding.expires_at && binding.expires_at <= now) return "binding_expired" as const;
  if (!token) return "token_missing" as const;
  if (!binding.nexa_token) return "binding_token_missing" as const;
  if (token !== binding.nexa_token) return "token_mismatch" as const;
  if (binding.max_payment_amount && new Big(amount).gt(binding.max_payment_amount)) {
    return "amount_exceeds_binding" as const;
  }
  return null;
};

// Un pago SIN token no es un rechazo del banco: es un nexa-server que todavía
// no manda el token (cartera desplegada antes) o que lo omitió. Se responde 503
// porque nexa-server —la versión vieja y la nueva— reintenta todo >= 500 y
// convierte un 403 con código en REJECTED, lo que le DEVUELVE el dinero al
// cliente. binding_token_missing (auto-reparación) y token_mismatch siguen 403.
const nexaBindingRejectionError = (
  code: NonNullable<ReturnType<typeof getNexaBindingRejection>>,
) => new NexaPaymentError(code, code === "token_missing" ? 503 : 403);

export type NexaPaymentBody = z.infer<typeof nexaPaymentSchema>;

export type NexaPaymentContext = {
  nonce: string;
  payloadHash: string;
  eventFingerprint?: string;
  legacyPayloadHash?: string;
  now: Date;
};

export type NexaClaim =
  | { kind: "new" | "retry" | "billing"; eventId: number }
  | { kind: "applied"; paymentId: number; eventId?: number; billingStatus?: "PENDING" }
  // processingEventId: solo cuando ESTA entrega pasa el evento de processing a
  // manual_review (el proceso anterior murió), para reconciliar su condonación.
  | { kind: "manual_review"; phase?: "payment" | "billing"; processingEventId?: number }
  | { kind: "conflict" | "replay" | "billing_failed" };

export type NexaBillingOutcome =
  | { kind: "billed" }
  | { kind: "pending" | "failed" | "unknown"; code: string };

export type StoredNexaEvent = {
  id: number;
  credito_id: number;
  amount: string;
  currency: string;
  payload_hash: string;
  status: string;
  pago_id: number | null;
  /** Pago que tenía el evento antes de que marcar CAÍDO lo borrara. */
  pago_id_eliminado?: number | null;
};

export const classifyNexaClaim = (
  event: StoredNexaEvent | null,
  nonceUsed: boolean,
  requested: {
    creditoId: number;
    amount: string;
    currency: string;
    payloadHash: string;
    compatiblePayloadHashes?: string[];
  },
  billingIsRunning = false,
): NexaClaim => {
  if (nonceUsed) return { kind: "replay" };
  if (!event) throw new Error("nexa event claim missing");
  if (
    event.credito_id !== requested.creditoId ||
    !new Big(event.amount).eq(requested.amount) ||
    event.currency !== requested.currency ||
    ![requested.payloadHash, ...(requested.compatiblePayloadHashes ?? [])].includes(event.payload_hash)
  ) {
    return { kind: "conflict" };
  }
  // Marcar CAÍDO borró el pago de una transferencia que cartera ya aceptó: el reintento de Nexa
  // se contesta como ya aplicado con el pago original. Nunca para un `failed`: esa transferencia
  // se rechazó y Nexa devolvió el dinero; sigue el camino de failed de abajo.
  if (event.pago_id === null && event.pago_id_eliminado != null && event.status !== "failed") {
    return { kind: "applied", paymentId: event.pago_id_eliminado, eventId: event.id };
  }
  if (["applied", "billed"].includes(event.status) && event.pago_id !== null) {
    return { kind: "applied", paymentId: event.pago_id, eventId: event.id };
  }
  if (event.status === "failed") return { kind: "retry", eventId: event.id };
  // Preserve a durable rejection across polls instead of resetting Nexa's retry budget with PENDING.
  if (event.status === "billing_failed") return { kind: "billing_failed" };
  if (event.status === "billing_pending" && event.pago_id !== null) {
    return { kind: "billing", eventId: event.id };
  }
  if (event.status === "billing_running" && billingIsRunning && event.pago_id !== null) {
    return { kind: "applied", paymentId: event.pago_id, eventId: event.id, billingStatus: "PENDING" };
  }
  if (["billing_running", "billing_unknown"].includes(event.status)) {
    return { kind: "manual_review", phase: "billing" };
  }
  // Un evento ya en manual_review NO: un operador pudo resolverlo registrando la
  // boleta a mano (fila sin nexaPaymentEventId) y 0 filas vinculadas no
  // probaría que el pago no entró. Una anulación fallida que ya dejó el evento
  // en manual_review queda con el log viva_sin_verificar para revisión humana.
  if (event.status === "processing" && event.pago_id_eliminado == null) {
    return { kind: "manual_review", processingEventId: event.id };
  }
  return { kind: "manual_review" };
};

type NexaPaymentResult = {
  paymentId: number;
  /** Todos los pago_id del evento (ascendente); paymentId es el primero. */
  paymentIds: number[];
  idempotent: boolean;
  billingStatus?: "PENDING";
};

export const getNexaReceiptFields = (body: NexaPaymentBody) => {
  if (!body.tokenDate) throw new NexaPaymentError("payment_date_required", 503);
  // Nexa statements supply a banking calendar date, not a local receipt time.
  // Keep the original bank value for audit; do not shift the statement day.
  return {
    fecha_pago: body.tokenDate,
    fecha_boleta: body.tokenDate.slice(0, 10),
    numeroAutorizacion: body.transactionId || body.externalReference,
  };
};

export type NexaPaymentDependencies = {
  withCreditLock: (
    creditoId: number,
    work: (lock: PaymentAdvisoryLock) => Promise<NexaPaymentResult>,
  ) => Promise<NexaPaymentResult>;
  claim: (body: NexaPaymentBody, context: NexaPaymentContext) => Promise<NexaClaim>;
  loadCredit: (creditoId: number) => Promise<{
    usuarioId: number;
    statusCredit: string;
    binding: NexaCreditBinding | null;
  } | null>;
  findPayments: (eventId: number, creditoId: number) => Promise<{
    paymentId: number;
    validationStatus: string;
    amount: string;
  }[]>;
  registerPayment: (
    body: NexaPaymentBody,
    eventId: number,
    usuarioId: number,
    validateAfterLock: () => Promise<void>,
    paymentLock: PaymentAdvisoryLock,
  ) => Promise<{ success?: boolean; code?: string; status?: number }>;
  /**
   * Condona la mora de un pago ACH que llegó a tiempo (ver
   * `utils/condonacionNexaATiempo.ts`). Idempotente por evento y nunca lanza.
   * Devuelve el monto condonado cuando lo sabe (solo para el log de error).
   */
  condonarMoraATiempo?: (body: NexaPaymentBody, eventId: number) => Promise<{ monto: string } | void>;
  /**
   * Anula la condonación viva del evento (si no hay, no hace nada). Si se niega
   * a anular porque hay un pago posterior no vinculado (pudo ser esta misma
   * transferencia, registrada a mano), lanza `CondonacionConservadaError`: la
   * saga lo trata como cualquier fallo de anulación → 503 incierto y
   * manual_review, nunca un rechazo (Nexa devolvería un dinero que entró).
   */
  anularCondonacionATiempo?: (eventId: number) => Promise<void>;
  /**
   * Con el pago ya aplicado, revisa que el crédito haya quedado al día (la
   * condición de la condonación). Si no, deja alerta durable; NO anula: el
   * pago sí entró. Nunca lanza.
   */
  verificarCondonacionATiempo?: (creditoId: number, eventId: number) => Promise<void>;
  /**
   * El registro dejó filas de pago vinculadas pero el desenlace quedó incierto
   * (monto que no cuadra, registro que reventó, proceso que murió). Si las
   * filas suman el monto de Nexa, el pago entró completo y la condonación se
   * conserva siempre. Si entró A MEDIAS y el crédito NO quedó al día, se anula
   * (con la guarda del pago posterior no vinculado); al día se conserva. La
   * respuesta a Nexa no cambia. Nunca lanza.
   */
  reconciliarCondonacionIncierta?: (creditoId: number, eventId: number, montoNexa: string) => Promise<void>;
  /**
   * Qué pasó con la condonación del evento de este pago, para informarlo en
   * cada 503 incierto (también en los reintentos, que ya no pasan por la saga).
   * undefined = el evento no tiene condonación.
   */
  condonacionDelPago?: (body: NexaPaymentBody) => Promise<CondonacionNexaIncierta | undefined>;
  applyPayment: (
    paymentId: number,
    paymentLock: PaymentAdvisoryLock,
  ) => Promise<{ success?: boolean }>;
  complete: (eventId: number, paymentId: number) => Promise<void>;
  fail: (eventId: number, code: string) => Promise<void>;
  billPayments?: (eventId: number, paymentIds: number[]) => Promise<NexaBillingOutcome>;
  completeBilling?: (eventId: number, paymentId: number) => Promise<void>;
  failBilling?: (
    eventId: number,
    status: "billing_failed" | "billing_unknown",
    code: string,
  ) => Promise<void>;
  now?: () => Date;
};

export const canAutomaticallyInvoiceNexa = ({
  environment,
  enabled,
  simulated,
}: {
  environment: string;
  enabled: boolean;
  simulated: boolean;
}) => environment.toLowerCase() === "production" && enabled && !simulated;

export const classifyNexaBillingResponse = (
  status: number,
  response: unknown,
): NexaBillingOutcome => {
  if (!response || typeof response !== "object") {
    return { kind: "unknown", code: "invalid_billing_response" };
  }
  const result = response as Record<string, unknown>;
  if (result.success === true) {
    if (status < 200 || status >= 300 || !result.data || typeof result.data !== "object") {
      return { kind: "unknown", code: "invalid_billing_response" };
    }
    const data = result.data as Record<string, unknown>;
    if (Array.isArray(data.errores) && data.errores.length > 0) {
      return { kind: "unknown", code: "partial_billing_result" };
    }
    if (
      typeof data.total_facturas !== "number" ||
      !Number.isInteger(data.total_facturas) ||
      !Array.isArray(data.facturas) ||
      data.total_facturas !== data.facturas.length ||
      data.facturas.some((invoice) => {
        if (!invoice || typeof invoice !== "object") return true;
        const id = (invoice as Record<string, unknown>).factura_id;
        return typeof id !== "number" || !Number.isInteger(id) || id <= 0;
      })
    ) {
      return { kind: "unknown", code: "invalid_billing_response" };
    }
    return { kind: "billed" };
  }
  if (status >= 400 && status < 500 && !("facturasExistentes" in result)) {
    return { kind: "failed", code: "billing_rejected" };
  }
  return { kind: "unknown", code: "billing_provider_or_persistence_error" };
};

export class CondonacionConservadaError extends Error {
  constructor(readonly motivo: "pago_posterior_no_vinculado") {
    super(`condonacion_conservada: ${motivo}`);
  }
}

/**
 * Lo que cartera le informa a nexa-server de la condonación a tiempo en un 503
 * `payment_outcome_uncertain`:
 *  - anulada: con lo que entró, el crédito no quedó al día (o no entró nada);
 *  - conservada: con lo que entró, el crédito quedó al día;
 *  - conservada_pago_posterior: no se anuló porque hay un pago posterior no
 *    vinculado que pudo ser esta misma transferencia;
 *  - sin_verificar: sigue viva y no se pudo decidir.
 */
export type CondonacionNexaIncierta = "anulada" | "conservada" | "conservada_pago_posterior" | "sin_verificar";

export class NexaPaymentError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly condonacion?: CondonacionNexaIncierta,
  ) {
    super(code);
  }
}

export const processNexaPayment = (
  body: NexaPaymentBody,
  context: NexaPaymentContext,
  dependencies: NexaPaymentDependencies,
) => dependencies.withCreditLock(body.creditoId, async (paymentLock) => {
  try {
    return await procesarPagoNexa(body, context, dependencies, paymentLock);
  } catch (error) {
    if (
      !(error instanceof NexaPaymentError)
      || error.code !== "payment_outcome_uncertain"
      || !dependencies.condonacionDelPago
    ) throw error;
    // Todavía con el candado del crédito: lo que se informa es lo que quedó.
    // Si no se pudo leer, se dice: "sin_verificar" (no se sabe qué pasó). Leída y
    // sin condonación, el 503 va sin el campo.
    const condonacion = await dependencies.condonacionDelPago(body)
      .catch((): CondonacionNexaIncierta => "sin_verificar");
    throw condonacion ? new NexaPaymentError(error.code, error.status, condonacion) : error;
  }
});

const procesarPagoNexa = async (
  body: NexaPaymentBody,
  context: NexaPaymentContext,
  dependencies: NexaPaymentDependencies,
  paymentLock: PaymentAdvisoryLock,
): Promise<NexaPaymentResult> => {
  const existingCredit = await dependencies.loadCredit(body.creditoId);
  if (!existingCredit) throw new NexaPaymentError("credit_not_found", 404);
  const claim = await dependencies.claim(body, context);
  if ("paymentId" in claim) {
    // Buscar por nexa_payment_event_id: nexa_payment_events.pago_id solo guarda el primero y puede ser NULL.
    const linked = claim.eventId === undefined
      ? []
      : (await dependencies.findPayments?.(claim.eventId, body.creditoId)) ?? [];
    const paymentIds = [...new Set([claim.paymentId, ...linked.map((payment) => payment.paymentId)])]
      .sort((a, b) => a - b);
    return { paymentId: claim.paymentId, paymentIds, idempotent: true, ...(claim.billingStatus ? { billingStatus: claim.billingStatus } : {}) };
  }
  if (claim.kind === "billing_failed") throw new NexaPaymentError("billing_failed", 503);
  if (claim.kind === "manual_review") {
    if (claim.phase !== "billing" && claim.processingEventId !== undefined && dependencies.anularCondonacionATiempo) {
      // El proceso pudo morir entre la condonación (commiteada) y el registro: el
      // evento queda processing → manual_review y la saga no vuelve a correr. Con
      // el candado del crédito tomado nadie más está registrando: 0 filas de pago
      // vinculadas = el pago no entró → se anula, salvo que el crédito tenga un
      // pago posterior no vinculado (la anulación lo conserva: ver
      // anularCondonacionNexaATiempo). Con filas, se decide por si el crédito
      // quedó al día con lo que entró. La respuesta a Nexa no cambia.
      try {
        const linked = await dependencies.findPayments(claim.processingEventId, body.creditoId);
        if (linked.length === 0) await dependencies.anularCondonacionATiempo(claim.processingEventId);
        else await dependencies.reconciliarCondonacionIncierta?.(body.creditoId, claim.processingEventId, body.amount);
      } catch (error) {
        console.error(JSON.stringify({
          level: "error",
          event: "nexa.condonacion_a_tiempo.viva_sin_verificar",
          paso: "reconciliar_evento_incierto",
          nexa_payment_event_id: claim.processingEventId,
          credito_id: body.creditoId,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    throw new NexaPaymentError(
      claim.phase === "billing" ? "billing_outcome_unknown" : "payment_outcome_uncertain",
      503,
    );
  }
  if (!("eventId" in claim)) {
    throw new NexaPaymentError(claim.kind, 409);
  }
  const eventId = claim.eventId;
  let payments: Awaited<ReturnType<NexaPaymentDependencies["findPayments"]>>;

  if (claim.kind === "billing") {
    if (!dependencies.failBilling) throw new NexaPaymentError("billing_not_configured", 503);
    try {
      payments = await dependencies.findPayments(eventId, body.creditoId);
      if (payments.length === 0) throw new Error("linked payments missing");
      const linkedAmount = payments.reduce((total, payment) => total.plus(payment.amount), new Big(0));
      if (!linkedAmount.eq(body.amount)) throw new Error("linked payment amount mismatch");
    } catch {
      await dependencies.failBilling(eventId, "billing_unknown", "billing_payment_link_unknown");
      throw new NexaPaymentError("billing_outcome_unknown", 503);
    }
  } else {
    try {
      if (!body.tokenDate) throw new NexaPaymentError("payment_date_required", 503);
      const credit = await dependencies.loadCredit(body.creditoId);
      if (!credit) throw new NexaPaymentError("credit_not_found", 404);
      const bindingRejection = getNexaBindingRejection(
        credit.binding,
        body.amount,
        dependencies.now?.() ?? new Date(),
        body.token,
      );
      if (bindingRejection) throw nexaBindingRejectionError(bindingRejection);
      if (!["ACTIVO", "MOROSO", "EN_CONVENIO", "INCOBRABLE"].includes(credit.statusCredit)) {
        throw new NexaPaymentError("credit_not_payable", 409);
      }

      payments = await dependencies.findPayments(eventId, body.creditoId);
      let condonacion: Awaited<ReturnType<NonNullable<NexaPaymentDependencies["condonarMoraATiempo"]>>> | undefined;
      const condonacionVivaSinVerificar = (paso: string, error: unknown) => {
        console.error(JSON.stringify({
          level: "error",
          event: "nexa.condonacion_a_tiempo.viva_sin_verificar",
          paso,
          nexa_payment_event_id: eventId,
          credito_id: body.creditoId,
          monto_condonado: condonacion?.monto ?? null,
          error: error instanceof Error ? error.message : String(error),
        }));
        return new NexaPaymentError("payment_outcome_uncertain", 503);
      };
      // Registro a medias (filas vinculadas, desenlace incierto): la condonación
      // se decide por lo que realmente entró. También en un reintento.
      const inciertoConFilas = async () => {
        await dependencies.reconciliarCondonacionIncierta?.(body.creditoId, eventId, body.amount);
        return new NexaPaymentError("payment_outcome_uncertain", 503);
      };
      if (payments.length === 0) {
        // Saga: la condonación commitea ANTES del registro (insertPayment no es
        // una sola transacción). Si el registro no termina en éxito —rechazo
        // definitivo, desenlace incierto o excepción— se decide por el ESTADO
        // OBSERVADO, no por la forma del error: ya con el registro terminado
        // (await completo), se buscan las filas de pago del evento.
        //  - 0 filas: el pago NO entró → se anula la condonación (restituye la
        //    mora y compensa el ledger). El desenlace hacia nexa-server no cambia.
        //  - ≥1 fila: el pago entró → la condonación se conserva.
        // No se puede dejar para el reintento: un evento incierto queda en
        // manual_review y `claim` corta ahí, sin volver a pasar por la saga.
        condonacion = await dependencies.condonarMoraATiempo?.(body, eventId);
        let registered: Awaited<ReturnType<NexaPaymentDependencies["registerPayment"]>> | undefined;
        let registroError: unknown;
        try {
          registered = await dependencies.registerPayment(
            body,
            eventId,
            credit.usuarioId,
            async () => {
              const currentCredit = await dependencies.loadCredit(body.creditoId);
              if (!currentCredit) throw new NexaPaymentError("credit_not_found", 404);
              const rejection = getNexaBindingRejection(
                currentCredit.binding,
                body.amount,
                dependencies.now?.() ?? new Date(),
                body.token,
              );
              if (rejection) throw nexaBindingRejectionError(rejection);
            },
            paymentLock,
          );
        } catch (error) {
          registroError = error;
        }
        try {
          payments = await dependencies.findPayments(eventId, body.creditoId);
        } catch (error) {
          throw dependencies.condonarMoraATiempo
            ? condonacionVivaSinVerificar("consultar_filas_de_pago", error)
            : error;
        }
        if (payments.length === 0) {
          const desenlace = registroError !== undefined
            ? registroError instanceof NexaPaymentError
              ? registroError
              : new NexaPaymentError("payment_outcome_uncertain", 503)
            : registered?.success === false
              ? new NexaPaymentError(
                  registered.code ?? "payment_registration_rejected",
                  registered.status ?? 409,
                )
              : new NexaPaymentError("payment_outcome_uncertain", 503);
          try {
            await dependencies.anularCondonacionATiempo?.(eventId);
          } catch (error) {
            throw condonacionVivaSinVerificar("anular_condonacion", error);
          }
          throw desenlace;
        }
        // Hay filas pero el registro reventó: no se sabe si terminó de escribir.
        if (registroError !== undefined) throw await inciertoConFilas();
      }
      const linkedAmount = payments.reduce((total, payment) => total.plus(payment.amount), new Big(0));
      if (!linkedAmount.eq(body.amount)) {
        throw await inciertoConFilas();
      }

      for (const payment of payments) {
        if (["validated", "capital_validated"].includes(payment.validationStatus)) continue;
        const applied = await dependencies.applyPayment(payment.paymentId, paymentLock);
        if (applied.success !== true) {
          // nexa-server toma el 409 como rechazo y Nexa devuelve el dinero: la
          // condonación (de este intento o de uno anterior, por eso sin condición;
          // es idempotente) no puede quedar viva. Si no se puede anular, el
          // desenlace queda incierto para revisión manual en vez de rechazo.
          try {
            await dependencies.anularCondonacionATiempo?.(eventId);
          } catch (error) {
            throw condonacionVivaSinVerificar("anular_condonacion_pago_no_aplicado", error);
          }
          throw new NexaPaymentError("payment_not_applied", 409);
        }
      }
      await dependencies.complete(eventId, payments[0]!.paymentId);
      // En un reintento `condonacion` es undefined, pero el primer intento pudo
      // dejarla viva: también se verifica (sin condonación viva no hace nada).
      if (condonacion || claim.kind === "retry") {
        // La simulación pudo equivocarse: con el pago ya aplicado se revisa de
        // verdad. Un fallo acá no puede marcar como fallido un pago que entró.
        await dependencies.verificarCondonacionATiempo?.(body.creditoId, eventId).catch(() => undefined);
      }
    } catch (error) {
      const code = error instanceof NexaPaymentError ? error.code : "processing_failed";
      await dependencies.fail(eventId, code);
      throw error;
    }
  }

  const paymentId = payments[0]!.paymentId;
  const paymentIds = payments.map((payment) => payment.paymentId);
  if (!dependencies.billPayments || !dependencies.completeBilling || !dependencies.failBilling) {
    throw new NexaPaymentError("billing_not_configured", 503);
  }
  let billing: NexaBillingOutcome;
  try {
    billing = await dependencies.billPayments(
      eventId,
      payments.map((payment) => payment.paymentId),
    );
    if (billing.kind === "billed") {
      await dependencies.completeBilling(eventId, paymentId);
      return { paymentId, paymentIds, idempotent: false };
    }
    if (billing.kind === "pending") {
      return { paymentId, paymentIds, idempotent: false, billingStatus: "PENDING" };
    }
    await dependencies.failBilling(
      eventId,
      billing.kind === "failed" ? "billing_failed" : "billing_unknown",
      billing.code,
    );
    throw new NexaPaymentError(
      billing.kind === "failed" ? "billing_failed" : "billing_outcome_unknown",
      503,
    );
  } catch (error) {
    if (error instanceof NexaPaymentError) throw error;
    try {
      await dependencies.failBilling(eventId, "billing_unknown", "billing_persistence_unknown");
    } catch {
      // billing_running is itself the durable fail-closed fence when this write fails.
    }
    throw new NexaPaymentError("billing_outcome_unknown", 503);
  }
};

export const createNexaPaymentHandler = ({
  secret,
  windowSeconds = 300,
  now = Date.now,
  dependencies,
}: {
  secret: string;
  windowSeconds?: number;
  now?: () => number;
  dependencies: NexaPaymentDependencies;
}) => async ({ request, set }: {
  request: Request;
  body: unknown;
  set: { status?: number | string };
}) => {
  const normalizedSecret = secret.trim();
  if (normalizedSecret.length < 32 || Buffer.byteLength(normalizedSecret) < 32) {
    set.status = 503;
    return { error: "configuration_error" };
  }

  const rawBody = await request.text();
  const timestamp = request.headers.get("x-nexa-timestamp") ?? "";
  const nonce = request.headers.get("x-nexa-nonce") ?? "";
  const signature = request.headers.get("x-nexa-signature") ?? "";
  const verified = verifyNexaHmac({
    method: request.method,
    path: new URL(request.url).pathname,
    body: rawBody,
    secret: normalizedSecret,
    timestamp,
    nonce,
    signature,
    now: now(),
    windowSeconds,
  });
  if (!verified.ok || !nonce) {
    set.status = 401;
    return { error: "invalid_authentication" };
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    set.status = 400;
    return { error: "invalid_body" };
  }
  const parsed = nexaPaymentSchema.safeParse(json);
  if (!parsed.success) {
    set.status = 400;
    return { error: "invalid_body" };
  }

  try {
    const result = await processNexaPayment(
      parsed.data,
      {
        nonce,
        payloadHash: hashNexaPayload(rawBody),
        eventFingerprint: getNexaEventFingerprint(parsed.data),
        legacyPayloadHash: hashNexaPayload(JSON.stringify(getLegacyNexaPaymentBody(parsed.data))),
        now: new Date(now()),
      },
      dependencies,
    );
    set.status = 200;
    return { status: "APPLIED" as const, ...result };
  } catch (error) {
    set.status = error instanceof NexaPaymentError ? error.status : 500;
    return {
      error: error instanceof NexaPaymentError ? error.code : "processing_failed",
      ...(error instanceof NexaPaymentError && error.condonacion ? { condonacion: error.condonacion } : {}),
    };
  }
};

const hashNexaPayload = (payload: string) => createHash("sha256").update(payload).digest("hex");

export const getNexaEventFingerprint = (body: NexaPaymentBody) => body.tokenDate
  ? hashNexaPayload(JSON.stringify([
      "nexa-payment-v2",
      body.externalReference,
      body.creditoId,
      body.amount,
      body.currency,
      body.transactionId ?? "",
      body.tokenDate,
    ]))
  : hashNexaPayload(JSON.stringify(getLegacyNexaPaymentBody(body)));

const getLegacyNexaPaymentBody = (body: NexaPaymentBody) => ({
  externalReference: body.externalReference,
  creditoId: body.creditoId,
  amount: body.amount,
  currency: body.currency,
  ...(body.transactionId ? { transactionId: body.transactionId } : {}),
});
