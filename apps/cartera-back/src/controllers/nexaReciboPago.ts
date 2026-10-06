/**
 * Recibo por WhatsApp de los pagos de Nexa, con bandeja de salida en
 * `nexa_payment_events` (migración 0046).
 *
 * Cuando el pago de Nexa queda aplicado, el runtime deja el evento con
 * `recibo_status = 'PENDIENTE'` (solo con RECIBO_PAGO_WHATSAPP_ENABLED) y
 * dispara `intentarReciboNexa` sin esperarlo. El intento toma el evento de
 * forma atómica (PENDIENTE → ENVIANDO), así que dos disparos a la vez o un
 * reintento de Nexa no mandan el recibo dos veces. Un ENVIANDO o FALLIDO de
 * más de 30 minutos se vuelve a tomar, hasta 5 intentos;
 * `reintentarRecibosNexaPendientes` los barre.
 */

import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../database";
import { nexa_payment_events, pagos_credito } from "../database/db";
import { enviarRecibosPagoDeCreditoBestEffort } from "../services/reciboPagoWhatsapp";

export const MAX_INTENTOS_RECIBO_NEXA = 5;
const MINUTOS_PARA_RETOMAR = 30;

export type ReciboNexaDeps = {
  /** Toma el evento si se puede enviar; devuelve el crédito o null. */
  tomar: (eventId: number) => Promise<{ creditoId: number } | null>;
  pagosDelEvento: (eventId: number) => Promise<number[]>;
  enviar: (params: { creditoId: number; pagoIds: number[] }) => Promise<{ success: boolean }[]>;
  cerrar: (eventId: number, estado: "ENVIADO" | "FALLIDO") => Promise<void>;
};

export async function intentarReciboNexa(
  eventId: number,
  deps: ReciboNexaDeps = reciboNexaDeps,
): Promise<"ENVIADO" | "FALLIDO" | "OMITIDO"> {
  try {
    const tomado = await deps.tomar(eventId);
    if (!tomado) return "OMITIDO";

    const pagoIds = await deps.pagosDelEvento(eventId);
    const resultados = pagoIds.length > 0
      ? await deps.enviar({ creditoId: tomado.creditoId, pagoIds })
      : [];
    const enviado =
      pagoIds.length > 0 &&
      resultados.length === pagoIds.length &&
      resultados.every((r) => r.success);

    const estado = enviado ? "ENVIADO" : "FALLIDO";
    await deps.cerrar(eventId, estado);
    return estado;
  } catch (error) {
    console.error(
      `⚠️ Recibo por WhatsApp del evento Nexa ${eventId} falló (NO afecta el pago):`,
      error instanceof Error ? error.message : error,
    );
    return "FALLIDO";
  }
}

/** Barre los recibos de Nexa pendientes o atascados. Nunca lanza. */
export async function reintentarRecibosNexaPendientes(limite = 50): Promise<{ intentados: number; enviados: number }> {
  try {
    const candidatos = await db
      .select({ id: nexa_payment_events.id })
      .from(nexa_payment_events)
      .where(and(
        inArray(nexa_payment_events.recibo_status, ["PENDIENTE", "ENVIANDO", "FALLIDO"]),
        lt(nexa_payment_events.recibo_intentos, MAX_INTENTOS_RECIBO_NEXA),
        // Un PENDIENTE recién creado lo está mandando el disparo del pago.
        lt(nexa_payment_events.recibo_actualizado_at, sql`now() - interval '5 minutes'`),
      ))
      .orderBy(asc(nexa_payment_events.recibo_actualizado_at))
      .limit(limite);
    let enviados = 0;
    for (const { id } of candidatos) {
      if ((await intentarReciboNexa(id)) === "ENVIADO") enviados += 1;
    }
    return { intentados: candidatos.length, enviados };
  } catch (error) {
    console.error(
      "⚠️ No se pudieron reintentar los recibos de Nexa:",
      error instanceof Error ? error.message : error,
    );
    return { intentados: 0, enviados: 0 };
  }
}

export const reciboNexaDeps: ReciboNexaDeps = {
  tomar: async (eventId) => {
    const [tomado] = await db
      .update(nexa_payment_events)
      .set({
        recibo_status: "ENVIANDO",
        recibo_intentos: sql`${nexa_payment_events.recibo_intentos} + 1`,
        recibo_actualizado_at: new Date(),
      })
      .where(and(
        eq(nexa_payment_events.id, eventId),
        lt(nexa_payment_events.recibo_intentos, MAX_INTENTOS_RECIBO_NEXA),
        or(
          eq(nexa_payment_events.recibo_status, "PENDIENTE"),
          and(
            inArray(nexa_payment_events.recibo_status, ["ENVIANDO", "FALLIDO"]),
            lt(
              nexa_payment_events.recibo_actualizado_at,
              sql`now() - make_interval(mins => ${MINUTOS_PARA_RETOMAR}::int)`,
            ),
          ),
        ),
      ))
      .returning({ creditoId: nexa_payment_events.credito_id });
    return tomado ?? null;
  },
  pagosDelEvento: async (eventId) => {
    const pagos = await db
      .select({ pagoId: pagos_credito.pago_id })
      .from(pagos_credito)
      .where(eq(pagos_credito.nexaPaymentEventId, eventId))
      .orderBy(asc(pagos_credito.pago_id));
    return pagos.map((p) => p.pagoId);
  },
  enviar: (params) => enviarRecibosPagoDeCreditoBestEffort(params),
  cerrar: async (eventId, estado) => {
    await db
      .update(nexa_payment_events)
      .set({ recibo_status: estado, recibo_actualizado_at: new Date() })
      .where(and(
        eq(nexa_payment_events.id, eventId),
        eq(nexa_payment_events.recibo_status, "ENVIANDO"),
      ));
  },
};
