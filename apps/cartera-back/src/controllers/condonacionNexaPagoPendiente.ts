import { and, eq, isNull, sql } from "drizzle-orm";
import type { db } from "../database";
import { moras_condonaciones } from "../database/db/schema";
import { anularCondonacionNexaATiempo } from "./latefee";

// Vive fuera de `latefee.ts` porque ese módulo no puede tener llamadas a
// `console` (latefeeStructuredLogging.test.ts) y este hecho necesita su log.
/**
 * Un pago PENDIENTE dejó de serlo sin validarse (falsePayment / anularPagoMora,
 * reversePayment): las condonaciones Nexa vivas del crédito que se sostenían
 * en él (`pagos_pendientes_ids`, drizzle/0052) se anulan —la mora vuelve y el
 * ledger queda compensado con ANULACION—, sin la guarda del pago posterior.
 *
 * Va en la transacción del que revierte el pago (`dbClient`), que ya tiene el
 * candado del crédito: o se revierte el pago y se anula la condonación, o
 * ninguna de las dos. Si la anulación falla, lanza y aborta la reversa.
 * Solo para pagos que estaban `pending`: uno validado ya cerró la cuota y la
 * condonación quedó firme. Devuelve los condonacion_id anulados.
 */
export async function anularCondonacionesNexaPorPagoPendiente({
  credito_id,
  pago_id,
  accion,
  dbClient,
}: {
  credito_id: number;
  pago_id: number;
  /** Qué le pasó al pendiente, para el motivo y el log. */
  accion: "anulo" | "revirtio";
  dbClient: typeof db;
}): Promise<number[]> {
  const vivas = await dbClient
    .select({
      condonacion_id: moras_condonaciones.condonacion_id,
      nexa_payment_event_id: moras_condonaciones.nexa_payment_event_id,
    })
    .from(moras_condonaciones)
    .where(and(
      eq(moras_condonaciones.credito_id, credito_id),
      isNull(moras_condonaciones.anulada_at),
      sql`${moras_condonaciones.nexa_payment_event_id} IS NOT NULL`,
      sql`${moras_condonaciones.pagos_pendientes_ids} && ARRAY[${pago_id}]::integer[]`,
    ));
  const anuladas: number[] = [];
  for (const viva of vivas) {
    const motivo = `Condonación Nexa anulada: el pago pendiente ${pago_id} que la sostenía se ${accion === "anulo" ? "anuló" : "revirtió"}`;
    const resultado = await anularCondonacionNexaATiempo({
      nexa_payment_event_id: viva.nexa_payment_event_id!,
      motivo,
      porPagoPendienteRevertido: true,
      dbClient,
    });
    if (!resultado.anulada) continue;
    anuladas.push(viva.condonacion_id);
    console.warn(JSON.stringify({
      level: "warn",
      event: "nexa.condonacion_a_tiempo.anulada_por_pago_pendiente",
      mensaje: motivo,
      credito_id,
      pago_id,
      condonacion_id: viva.condonacion_id,
      nexa_payment_event_id: viva.nexa_payment_event_id,
      monto_restituido: resultado.monto,
    }));
  }
  return anuladas;
}
