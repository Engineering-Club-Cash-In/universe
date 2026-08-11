// ============================================================================
// IDEMPOTENCIA DE FACTURACIÓN
// ----------------------------------------------------------------------------
// Certificar en SAT es IRREVERSIBLE (deshacerlo cuesta una anulación), así que
// /facturar-generico no puede depender de que el caller nunca repita el POST.
// El 2026-08-07 el CRM reintentó una llamada que había abortado por timeout y
// SAT emitió dos veces la misma factura de Q150 (99606D3F y 2FCBE7E1).
//
// Mecánica (tabla cartera.facturas_idempotencia, migración 0027):
//   1. `buscarFacturaPorIdempotencyKey` → si la clave ya tiene factura, se
//      devuelve esa misma en vez de emitir otra.
//   2. `reservarIdempotencyKey` → reserva la clave ANTES de certificar. Si otra
//      request la tiene tomada y sigue viva, devuelve "en_proceso" (el caller
//      responde 409 en vez de duplicar). Una reserva vieja sin factura se
//      considera abandonada y se puede retomar (proceso caído a mitad).
//   3. `confirmarIdempotencyKey` tras certificar / `liberarIdempotencyKey` si
//      falló (para que un reintento legítimo pueda volver a intentar).
// ============================================================================

import { sql } from "drizzle-orm";
import { db } from "../../database";

/** Una reserva sin factura más vieja que esto se considera abandonada. */
const RESERVA_ABANDONADA = "10 minutes";

export interface FacturaIdempotente {
  factura_id: number;
  serie: string;
  numero: string;
  uuid: string;
  monto_total: string;
  monto_iva: string;
  pdf_url: string;
  receptor_nit: string;
  receptor_nombre: string;
  status: string;
}

/** Factura ya emitida para esa clave (cualquier status), o null si no hay. */
export async function buscarFacturaPorIdempotencyKey(
  key: string
): Promise<FacturaIdempotente | null> {
  const res = await db.execute(sql`
    SELECT f.factura_id, f.serie, f.numero, f.uuid, f.monto_total, f.monto_iva,
           f.pdf_url, f.receptor_nit, f.receptor_nombre, f.status::text AS status
    FROM cartera.facturas_idempotencia i
    JOIN cartera.facturas_electronicas f ON f.factura_id = i.factura_id
    WHERE i.idempotency_key = ${key}
    LIMIT 1
  `);
  return ((res as any).rows?.[0] as FacturaIdempotente) ?? null;
}

/**
 * Toma la clave para esta request.
 * - "reservada": se puede certificar.
 * - "en_proceso": otra request la está usando ahora mismo; NO certificar.
 */
export async function reservarIdempotencyKey(
  key: string
): Promise<"reservada" | "en_proceso"> {
  const res = await db.execute(sql`
    INSERT INTO cartera.facturas_idempotencia AS fi (idempotency_key)
    VALUES (${key})
    ON CONFLICT (idempotency_key) DO UPDATE
      SET created_at = now()
      WHERE fi.factura_id IS NULL
        AND fi.created_at < now() - ${RESERVA_ABANDONADA}::interval
    RETURNING fi.idempotency_key
  `);
  return (res as any).rows?.length ? "reservada" : "en_proceso";
}

/** Ancla la clave a la factura que se acaba de emitir. */
export async function confirmarIdempotencyKey(
  key: string,
  facturaId: number
): Promise<void> {
  await db.execute(sql`
    UPDATE cartera.facturas_idempotencia
    SET factura_id = ${facturaId}
    WHERE idempotency_key = ${key}
  `);
}

/**
 * Suelta una reserva para que un reintento legítimo pueda volver a emitir.
 *
 * @param incluirConFactura por defecto NO borra reservas que ya apuntan a una
 *   factura (esas son el candado que evita el duplicado). Se pasa `true` solo
 *   cuando la factura quedó ANULADA y se quiere reemitir con la misma clave.
 */
export async function liberarIdempotencyKey(
  key: string,
  incluirConFactura = false
): Promise<void> {
  await db.execute(sql`
    DELETE FROM cartera.facturas_idempotencia
    WHERE idempotency_key = ${key}
      ${incluirConFactura ? sql`` : sql`AND factura_id IS NULL`}
  `);
}
