import { and, asc, eq, ne } from "drizzle-orm";
import { client, db, lockPool } from "../database";
import {
  creditos,
  nexa_credit_bindings,
  nexa_payment_events,
  pagos_credito,
} from "../database/db";
import { aplicarPagoAlCredito, insertPayment } from "./registerPayment";
import { claimNexaPaymentEvent } from "./nexaPaymentRepository";
import {
  createNexaPaymentHandler,
  formatNexaPaymentDate,
  NexaPaymentError,
  type NexaPaymentDependencies,
} from "./nexaPayments";

const NEXA_CREDIT_LOCK_NAMESPACE = 8766;
const marker = (eventId: number) => `NEXA:${eventId}`;

export const nexaPaymentDependencies: NexaPaymentDependencies = {
  withCreditLock: async (creditoId, work) => {
    const connection = await lockPool.connect();
    try {
      await connection.query("SELECT pg_advisory_lock($1, $2)", [
        NEXA_CREDIT_LOCK_NAMESPACE,
        creditoId,
      ]);
      return await work();
    } finally {
      try {
        await connection.query("SELECT pg_advisory_unlock($1, $2)", [
          NEXA_CREDIT_LOCK_NAMESPACE,
          creditoId,
        ]);
      } finally {
        connection.release();
      }
    }
  },
  claim: (body, context) => claimNexaPaymentEvent(
    { query: async (text, values) => {
      const result = await client.query(text, values);
      return { rows: result.rows };
    } },
    body,
    context,
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
    })
    .from(pagos_credito)
    .where(and(
      eq(pagos_credito.credito_id, creditoId),
      eq(pagos_credito.registerBy, marker(eventId)),
    ))
    .orderBy(asc(pagos_credito.pago_id)),
  registerPayment: async (body, eventId, usuarioId) => {
    const date = formatNexaPaymentDate(new Date());
    const set = { status: 200 };
    const result = await insertPayment({
      body: {
        credito_id: body.creditoId,
        usuario_id: usuarioId,
        monto_boleta: body.amount,
        fecha_pago: date,
        cuotaApagar: 1,
        url_boletas: [],
        numeroAutorizacion: body.transactionId,
        registerBy: marker(eventId),
        fecha_boleta: date,
        renuevo_o_nuevo: "NEXA",
        origen_pago: "transferencia",
      },
      set,
    });
    if (result && "success" in result && result.success === false) {
      throw new NexaPaymentError("payment_registration_rejected", set.status);
    }
  },
  applyPayment: aplicarPagoAlCredito,
  complete: async (eventId, paymentId) => {
    await db
      .update(nexa_payment_events)
      .set({
        status: "applied",
        pago_id: paymentId,
        error: null,
        updated_at: new Date(),
      })
      .where(eq(nexa_payment_events.id, eventId));
  },
  fail: async (eventId, code) => {
    await db
      .update(nexa_payment_events)
      .set({ status: "failed", error: code, updated_at: new Date() })
      .where(and(
        eq(nexa_payment_events.id, eventId),
        ne(nexa_payment_events.status, "applied"),
      ));
  },
};

export const nexaPaymentHandler = createNexaPaymentHandler({
  secret: process.env.NEXA_INTERNAL_API_SECRET ?? "",
  windowSeconds: Number(process.env.NEXA_HMAC_WINDOW_SECONDS ?? 300),
  dependencies: nexaPaymentDependencies,
});
