import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import config from "../config";
import { client, db } from "../database";
import {
  creditos,
  nexa_credit_bindings,
  nexa_payment_events,
  pagos_credito,
} from "../database/db";
import { facturarPagoCompleto } from "../routers/cofidi";
import { aplicarPagoAlCredito, insertPayment } from "./registerPayment";
import { createDeferredNexaBilling, runNexaBilling } from "./nexaBilling";
import {
  withPaymentAdvisoryLock,
  withPaymentBindingLock,
} from "../utils/paymentAdvisoryLock";
import { claimNexaPaymentEvent } from "./nexaPaymentRepository";
import {
  canAutomaticallyInvoiceNexa,
  createNexaPaymentHandler,
  getNexaReceiptFields,
  NexaPaymentError,
  type NexaPaymentDependencies,
} from "./nexaPayments";

export async function startNexaBilling(eventId: number) {
  const [started] = await db
    .update(nexa_payment_events)
    .set({ status: "billing_running", error: null, updated_at: new Date() })
    .where(and(
      eq(nexa_payment_events.id, eventId),
      inArray(nexa_payment_events.status, ["billing_pending", "billing_failed"]),
    ))
    .returning({ id: nexa_payment_events.id });
  return Boolean(started);
}

export async function completeNexaBilling(eventId: number, paymentId: number) {
  const [completed] = await db
    .update(nexa_payment_events)
    .set({
      status: "billed",
      pago_id: paymentId,
      error: null,
      updated_at: new Date(),
    })
    .where(and(
      eq(nexa_payment_events.id, eventId),
      eq(nexa_payment_events.status, "billing_running"),
    ))
    .returning({ id: nexa_payment_events.id });
  if (!completed) throw new Error("nexa billing completion fence failed");
}

export async function failNexaBilling(
  eventId: number,
  status: "billing_failed" | "billing_unknown",
  code: string,
) {
  await db
    .update(nexa_payment_events)
    .set({ status, error: code, updated_at: new Date() })
    .where(and(
      eq(nexa_payment_events.id, eventId),
      ne(nexa_payment_events.status, "billed"),
    ));
}

const deferredBilling = createDeferredNexaBilling({
  run: (eventId, paymentIds) => runNexaBilling({
    enabled: canAutomaticallyInvoiceNexa({
      environment: config.environment,
      enabled: config.nexaAutomaticInvoicingEnabled,
      simulated: process.env.SIMULAR_FACTURAS === "true",
    }),
    eventId,
    paymentIds,
    start: startNexaBilling,
    invoice: async (paymentId) => {
      const set: { status?: number | string } = { status: 200 };
      const response = await facturarPagoCompleto({
        body: { pago_id: paymentId },
        set,
      });
      const status = typeof set.status === "number" ? set.status : Number(set.status ?? 200);
      return { status: Number.isFinite(status) ? status : 500, response };
    },
  }),
  complete: completeNexaBilling,
  fail: failNexaBilling,
  logError: () => console.error("Nexa billing finalization failed; durable fence retained"),
});

export const nexaPaymentDependencies: NexaPaymentDependencies = {
  withCreditLock: (creditoId, work) => withPaymentAdvisoryLock(
    creditoId,
    (paymentLock) => withPaymentBindingLock(
      paymentLock,
      creditoId,
      (bindingExists) => {
        if (!bindingExists) throw new NexaPaymentError("binding_missing", 403);
        return work(paymentLock);
      },
    ),
  ),
  claim: (body, context) => claimNexaPaymentEvent(
    { query: async (text, values) => {
      const result = await client.query(text, values);
      return { rows: result.rows };
    } },
    body,
    context,
    deferredBilling.isRunning,
  ),
  loadCredit: async (creditoId) => {
    const [row] = await db
      .select({
        usuarioId: creditos.usuario_id,
        statusCredit: creditos.statusCredit,
        bindingCreditoId: nexa_credit_bindings.credito_id,
        activo: nexa_credit_bindings.activo,
        expires_at: nexa_credit_bindings.expires_at,
        max_payment_amount: nexa_credit_bindings.max_payment_amount,
      })
      .from(creditos)
      .leftJoin(
        nexa_credit_bindings,
        eq(nexa_credit_bindings.credito_id, creditos.credito_id),
      )
      .where(eq(creditos.credito_id, creditoId))
      .limit(1);
    if (!row) return null;
    return {
      usuarioId: row.usuarioId,
      statusCredit: row.statusCredit,
      binding: row.bindingCreditoId === null
        ? null
        : {
            activo: row.activo ?? false,
            expires_at: row.expires_at,
            max_payment_amount: row.max_payment_amount,
          },
    };
  },
  findPayments: async (eventId, creditoId) => db
    .select({
      paymentId: pagos_credito.pago_id,
      validationStatus: pagos_credito.validationStatus,
      amount: sql<string>`GREATEST(
        COALESCE(${pagos_credito.monto_aplicado}, 0),
        COALESCE(${pagos_credito.abono_capital}, 0)
          + COALESCE(${pagos_credito.abono_interes}, 0)
          + COALESCE(${pagos_credito.abono_iva_12}, 0)
          + COALESCE(${pagos_credito.abono_seguro}, 0)
          + COALESCE(${pagos_credito.abono_gps}, 0)
          + COALESCE(${pagos_credito.membresias_pago}, 0)
          + COALESCE(${pagos_credito.mora}, 0)
          + COALESCE(NULLIF(${pagos_credito.otros}, ''), '0')::numeric
      )`,
    })
    .from(pagos_credito)
    .where(and(
      eq(pagos_credito.credito_id, creditoId),
      eq(pagos_credito.nexaPaymentEventId, eventId),
    ))
    .orderBy(asc(pagos_credito.pago_id)),
  registerPayment: async (body, eventId, usuarioId, validateAfterLock, paymentLock) => {
    if (!body.tokenDate) throw new NexaPaymentError("payment_date_required", 503);
    try {
      await validateAfterLock();
    } catch (error) {
      if (error instanceof NexaPaymentError) {
        return { success: false as const, code: error.code, status: error.status };
      }
      throw error;
    }

    const set = { status: 200 };
    const result = await insertPayment({
      body: {
        credito_id: body.creditoId,
        usuario_id: usuarioId,
        monto_boleta: body.amount,
        ...getNexaReceiptFields(body),
        cuotaApagar: 1,
        url_boletas: [],
        registerBy: "NEXA",
        renuevo_o_nuevo: "NEXA",
        origen_pago: "transferencia",
      },
      set,
    }, {
      nexaPaymentEventId: eventId,
      paymentLock,
    });
    return result && "success" in result ? result : {};
  },
  applyPayment: (paymentId, paymentLock) => aplicarPagoAlCredito(paymentId, { paymentLock }),
  complete: async (eventId, paymentId) => {
    await db
      .update(nexa_payment_events)
      .set({
        status: "billing_pending",
        pago_id: paymentId,
        error: null,
        updated_at: new Date(),
      })
      .where(eq(nexa_payment_events.id, eventId));
  },
  fail: async (eventId, code) => {
    await db
      .update(nexa_payment_events)
      .set({
        status: code === "payment_outcome_uncertain" ? "manual_review" : "failed",
        error: code,
        updated_at: new Date(),
      })
      .where(and(
        eq(nexa_payment_events.id, eventId),
        ne(nexa_payment_events.status, "applied"),
      ));
  },
  billPayments: deferredBilling.run,
  completeBilling: completeNexaBilling,
  failBilling: failNexaBilling,
  now: () => new Date(),
};

export const nexaPaymentHandler = createNexaPaymentHandler({
  secret: process.env.NEXA_INTERNAL_API_SECRET ?? "",
  windowSeconds: Number(process.env.NEXA_HMAC_WINDOW_SECONDS ?? 300),
  dependencies: nexaPaymentDependencies,
});
