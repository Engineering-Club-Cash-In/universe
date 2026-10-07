/**
 * Un recibo por BOLETA, no por fila de pago.
 *
 * Cuando una boleta cubre varias cuotas, `registerPayment` la parte en varias
 * filas de `pagos_credito` (una por cuota) y TODAS llevan `monto_boleta` = la
 * boleta completa. Un recibo por fila le decía al cliente "Monto pagado
 * Q6,000" dos o tres veces (en PROD, ~1 de cada 5 boletas tiene varias filas).
 *
 * No existe un id de boleta, así que las filas hermanas se reconocen así:
 *  - Pago de Nexa: mismo `nexa_payment_event_id` (un evento = una boleta).
 *  - Pago manual: mismo crédito, `monto_boleta`, `fecha_boleta`, referencia
 *    (`numeroautorizacion`) y quien registró, insertadas con menos de 2 minutos
 *    de diferencia (las filas de una boleta se graban con segundos de
 *    diferencia; en PROD el máximo observado es 4 s).
 * Siempre dentro del mismo estado de anulación (`paymentFalse`).
 *
 * El comprobante de la boleta es su `pago_id` más bajo: es también la llave de
 * idempotencia del envío por WhatsApp.
 */

import { sql } from "drizzle-orm";
import { db } from "../database";
import { estadoReciboPago, type EstadoReciboPago } from "../utils/reciboPagoHtml";

export type FilaBoleta = {
  pago_id: number;
  validation_status: string | null;
  payment_false: boolean | null;
  cuota_pagada: boolean | null;
  monto_aplicado: string | number | null;
  mora: string | number | null;
  otros: string | number | null;
  numero_cuota: number | null;
};

export type ResumenBoleta = {
  /** `pago_id` más bajo: número de comprobante y llave del envío. */
  representativo: number;
  pagoIds: number[];
  estado: EstadoReciboPago;
  /** Todas las filas ya quedaron aplicadas (ninguna espera validación). */
  completa: boolean;
  montoAplicado: number;
  mora: number;
  otros: number;
  cuotas: number[];
};

const numero = (v: string | number | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function resumirBoleta(filas: FilaBoleta[]): ResumenBoleta {
  if (filas.length === 0) throw new Error("La boleta no tiene filas de pago");
  const ordenadas = [...filas].sort((a, b) => a.pago_id - b.pago_id);
  const estados = ordenadas.map((f) =>
    estadoReciboPago(f.validation_status, f.payment_false, {
      cuotaPagada: f.cuota_pagada,
      montoAplicado: numero(f.monto_aplicado),
    }),
  );
  const estado: EstadoReciboPago = estados.includes("anulado")
    ? "anulado"
    : estados.includes("en_validacion")
      ? "en_validacion"
      : estados.includes("aplicado")
        ? "aplicado"
        : "registrado";
  const cuotas = [...new Set(
    ordenadas
      .map((f) => f.numero_cuota)
      .filter((c): c is number => c != null && Number(c) > 0)
      .map(Number),
  )].sort((a, b) => a - b);
  return {
    representativo: ordenadas[0]!.pago_id,
    pagoIds: ordenadas.map((f) => f.pago_id),
    estado,
    completa: estado === "aplicado",
    montoAplicado: ordenadas.reduce((acc, f) => acc + numero(f.monto_aplicado), 0),
    mora: ordenadas.reduce((acc, f) => acc + numero(f.mora), 0),
    otros: ordenadas.reduce((acc, f) => acc + numero(f.otros), 0),
    cuotas,
  };
}

/** Filas de la boleta a la que pertenece `pagoId` (incluida ella misma). */
export async function filasDeLaBoleta(pagoId: number): Promise<FilaBoleta[]> {
  const result = await db.execute(sql`
    WITH p AS (
      SELECT pago_id, credito_id, monto_boleta, fecha_boleta, numeroautorizacion,
             registerby, fecha_pago, nexa_payment_event_id, "paymentFalse"
      FROM cartera.pagos_credito
      WHERE pago_id = ${pagoId}
    )
    SELECT h.pago_id, h.validation_status, h."paymentFalse" AS payment_false,
           cq.pagado AS cuota_pagada, h.monto_aplicado, h.mora, h.otros, cq.numero_cuota
    FROM cartera.pagos_credito h
    CROSS JOIN p
    LEFT JOIN cartera.cuotas_credito cq ON cq.cuota_id = h.cuota_id
    WHERE h.pago_id = p.pago_id
       OR (
         h."paymentFalse" = p."paymentFalse"
         AND (
           (p.nexa_payment_event_id IS NOT NULL
             AND h.nexa_payment_event_id = p.nexa_payment_event_id)
           OR (
             p.nexa_payment_event_id IS NULL
             AND h.nexa_payment_event_id IS NULL
             AND COALESCE(p.monto_boleta, 0) > 0
             AND p.fecha_boleta IS NOT NULL
             AND h.credito_id = p.credito_id
             AND h.monto_boleta = p.monto_boleta
             AND h.fecha_boleta = p.fecha_boleta
             AND COALESCE(h.numeroautorizacion, '') = COALESCE(p.numeroautorizacion, '')
             AND h.registerby = p.registerby
             AND abs(extract(epoch FROM (h.fecha_pago - p.fecha_pago))) <= 120
           )
         )
       )
    ORDER BY h.pago_id
  `);
  return (result.rows as FilaBoleta[]).map((f) => ({
    ...f,
    pago_id: Number(f.pago_id),
    numero_cuota: f.numero_cuota != null ? Number(f.numero_cuota) : null,
  }));
}
