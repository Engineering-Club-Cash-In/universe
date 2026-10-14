/**
 * "Boleta" de los pagos de Nexa: una imagen PNG que simula el comprobante de
 * la transferencia (número de transferencia, monto, fecha, crédito, cliente),
 * guardada como una boleta más (R2 + tabla `boletas`) para que el pago se vea
 * con boleta en todos los lugares donde hoy se ven las boletas.
 *
 * REGLA MADRE: si cartera le falla un pago a Nexa, Nexa le devuelve la plata
 * al cliente. Por eso nada de esto toca el pago: se genera DESPUÉS de que el
 * pago quedó aplicado, sin esperarlo, fuera de su transacción y de su candado,
 * y cualquier error solo queda en el log. Lo que no se generó lo retoma el
 * barrido `generate_nexa_receipt_images` (cada 15 minutos), que además hace el
 * backfill de los pagos Nexa que ya entraron sin imagen.
 *
 * Con NEXA_BOLETA_IMAGEN_ENABLED=false no se genera nada (por defecto, prendido).
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import { db } from "../database";
import { launchBrowser } from "../utils/functions/browser";
import { s3 } from "../utils/functions/uploadsFiles";

/** Namespace PROPIO del advisory lock del registro (8765 pagos, 8766 espejo, 8767 cuenta Nexa). */
export const BOLETA_NEXA_ADVISORY_LOCK_NAMESPACE = 8768;

export type DatosBoletaNexa = {
  pagoId: number;
  numeroAutorizacion: string | null;
  /** monto_boleta como texto ("1234.50"). */
  monto: string | null;
  /** fecha_boleta como "YYYY-MM-DD" (fecha calendario del banco). */
  fechaBoleta: string | null;
  numeroSifco: string | null;
  cliente: string | null;
};

// ========================================
// HTML (puro)
// ========================================

const escaparHtml = (valor: string) => valor
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

/** "1234.5" → "Q 1,234.50". Con texto para no perder centavos. */
export function formatearMontoQ(monto: string | null): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec((monto ?? "").trim());
  if (!match) return "—";
  const [, signo, enteros, decimales = ""] = match;
  const miles = enteros!.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${signo}Q ${miles}.${decimales.padEnd(2, "0").slice(0, 2)}`;
}

/**
 * "2026-10-01" → "01/10/2026". Es una fecha calendario del banco: se corta el
 * texto, sin pasar por Date (que la correría de día según la zona horaria).
 */
export function formatearFechaBoleta(fecha: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
}

export function htmlBoletaNexa(datos: DatosBoletaNexa, logoDataUri: string | null = null): string {
  const texto = (valor: string | null | undefined) => escaparHtml(valor?.trim() || "—");
  const fila = (etiqueta: string, valor: string) =>
    `<div class="fila"><span class="etiqueta">${etiqueta}</span><span class="valor">${valor}</span></div>`;
  const logo = logoDataUri
    ? `<img class="logo" src="${escaparHtml(logoDataUri)}" alt="Nexa">`
    : `<div class="logo-texto">nexa</div>`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #ffffff; font-family: -apple-system, "Segoe UI", "Helvetica Neue", Arial, "Liberation Sans", sans-serif; color: #1f2937; }
  #boleta { width: 600px; background: #ffffff; padding: 32px 36px 24px; border: 1px solid #e5e7eb; }
  .logo { height: 44px; width: auto; display: block; }
  .logo-texto { font-size: 36px; font-weight: 800; letter-spacing: -1px; color: #0f1a45; line-height: 44px; }
  .acento { height: 3px; background: #8b2fc9; margin: 20px 0 18px; width: 64px; border-radius: 2px; }
  h1 { font-size: 20px; font-weight: 600; color: #0f1a45; }
  .transferencia { margin: 22px 0 18px; padding: 16px 18px; border: 1px solid #e5e7eb; border-left: 4px solid #8b2fc9; border-radius: 6px; }
  .transferencia .etiqueta { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: #6b7280; }
  .transferencia .numero { display: block; margin-top: 4px; font-size: 30px; font-weight: 700; color: #0f1a45; letter-spacing: 1px; font-variant-numeric: tabular-nums; word-break: break-all; }
  .fila { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid #f0f1f3; font-size: 15px; }
  .fila .etiqueta { color: #6b7280; }
  .fila .valor { color: #111827; font-weight: 600; text-align: right; }
  .pie { margin-top: 20px; font-size: 11px; line-height: 1.5; color: #9ca3af; }
</style></head><body>
<div id="boleta">
  ${logo}
  <div class="acento"></div>
  <h1>Comprobante de transferencia</h1>
  <div class="transferencia">
    <span class="etiqueta">No. de transferencia</span>
    <span class="numero">${texto(datos.numeroAutorizacion)}</span>
  </div>
  ${fila("Monto", escaparHtml(formatearMontoQ(datos.monto)))}
  ${fila("Fecha", escaparHtml(formatearFechaBoleta(datos.fechaBoleta)))}
  ${fila("Crédito", texto(datos.numeroSifco))}
  ${fila("Cliente", texto(datos.cliente))}
  ${fila("Banco", "NEXA")}
  ${fila("Medio", "Transferencia ACH")}
  <p class="pie">Comprobante generado por Club Cashin a partir del estado de cuenta de Nexa. No es un documento emitido por el banco.</p>
</div>
</body></html>`;
}

let logoCache: string | null | undefined;
/** Logo de Nexa como data URI (assets/nexa-logo.png). Sin archivo: null y el HTML cae al texto. */
export function logoNexaDataUri(): string | null {
  if (logoCache !== undefined) return logoCache;
  try {
    const png = readFileSync(new URL("../../assets/nexa-logo.png", import.meta.url));
    logoCache = `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    logoCache = null;
  }
  return logoCache;
}

/**
 * Key del PNG en R2_BUCKET (el bucket de las boletas del front, servido
 * público; la URL pública va a `boletas.url_boleta`). Aleatoria, como el uuid
 * de las boletas del front: con el pago_id cualquiera podría bajar los
 * comprobantes ajenos probando números. Sin datos del pago ni del cliente: el
 * vínculo es la fila de `boletas`. Cada llamada da una key nueva.
 */
export const keyBoletaNexa = () => `boletas-nexa/${randomUUID()}.png`;

// ========================================
// Orquestación (con dependencias inyectables)
// ========================================

export type BoletaNexaDeps = {
  /** Pagos Nexa vivos sin boleta, del más viejo al más nuevo. */
  pendientes: (limite: number) => Promise<number[]>;
  /** Datos del pago si sigue siendo elegible (Nexa, no anulado, sin boleta); si no, null. */
  datos: (pagoId: number) => Promise<DatosBoletaNexa | null>;
  abrirRender: () => Promise<{ render: (html: string) => Promise<Buffer>; cerrar: () => Promise<void> }>;
  subir: (key: string, png: Buffer) => Promise<void>;
  /** Borra del bucket un PNG subido que no quedó registrado. */
  borrar: (key: string) => Promise<void>;
  /** Inserta la fila en `boletas` si el pago sigue elegible; false si no la insertó. */
  registrar: (pagoId: number, urlBoleta: string) => Promise<boolean>;
  urlPublica: (key: string) => string | null;
};

// ========================================
// Implementación real (BD, Chromium, R2)
// ========================================

const filas = <T>(result: { rows: unknown[] }) => result.rows as T[];

/**
 * Solo pagos cuyo evento Nexa quedó aplicado: `complete` lo deja en
 * billing_pending y la facturación lo lleva a billing_running/billed/
 * billing_failed/billing_unknown (`applied` es el estado previo a facturar).
 * Nunca failed, manual_review ni processing: ahí la plata pudo volver al
 * cliente y no se le hace comprobante.
 */
export const ESTADOS_EVENTO_NEXA_APLICADO = [
  "applied", "billing_pending", "billing_running", "billed", "billing_failed", "billing_unknown",
] as const;
const eventoAplicado = sql`EXISTS (
  SELECT 1 FROM cartera.nexa_payment_events e
  WHERE e.id = p.nexa_payment_event_id
    AND e.status IN (${sql.join(ESTADOS_EVENTO_NEXA_APLICADO.map((estado) => sql`${estado}`), sql`, `)}))`;

export const boletaNexaDeps: BoletaNexaDeps = {
  pendientes: async (limite) => filas<{ pago_id: number }>(await db.execute(sql`
    SELECT p.pago_id
    FROM cartera.pagos_credito p
    WHERE p.nexa_payment_event_id IS NOT NULL
      AND p."paymentFalse" = false
      AND ${eventoAplicado}
      AND NOT EXISTS (SELECT 1 FROM cartera.boletas b WHERE b.pago_id = p.pago_id)
    ORDER BY p.pago_id
    LIMIT ${limite}
  `)).map((f) => Number(f.pago_id)),
  datos: async (pagoId) => {
    // Texto en SQL: node-postgres convierte DATE a un Date local (correría el día) y numeric pierde formato.
    const [fila] = filas<{
      numero_autorizacion: string | null;
      monto: string | null;
      fecha_boleta: string | null;
      numero_sifco: string | null;
      cliente: string | null;
    }>(await db.execute(sql`
      SELECT p.numeroautorizacion AS numero_autorizacion,
             p.monto_boleta::text AS monto,
             to_char(p.fecha_boleta, 'YYYY-MM-DD') AS fecha_boleta,
             c.numero_credito_sifco AS numero_sifco,
             u.nombre AS cliente
      FROM cartera.pagos_credito p
      LEFT JOIN cartera.creditos c ON c.credito_id = p.credito_id
      LEFT JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
      WHERE p.pago_id = ${pagoId}
        AND p.nexa_payment_event_id IS NOT NULL
        AND p."paymentFalse" = false
        AND ${eventoAplicado}
        AND NOT EXISTS (SELECT 1 FROM cartera.boletas b WHERE b.pago_id = p.pago_id)
    `));
    if (!fila) return null;
    return {
      pagoId,
      numeroAutorizacion: fila.numero_autorizacion,
      monto: fila.monto,
      fechaBoleta: fila.fecha_boleta,
      numeroSifco: fila.numero_sifco,
      cliente: fila.cliente,
    };
  },
  abrirRender: async () => {
    const browser = await launchBrowser();
    return {
      render: async (html) => {
        const page = await browser.newPage();
        try {
          await page.setViewport({ width: 700, height: 900, deviceScaleFactor: 2 });
          await page.setContent(html, { waitUntil: "load" });
          const tarjeta = await page.$("#boleta");
          if (!tarjeta) throw new Error("no se encontró la tarjeta de la boleta");
          return Buffer.from(await tarjeta.screenshot({ type: "png" }));
        } finally {
          await page.close().catch(() => undefined);
        }
      },
      cerrar: () => browser.close(),
    };
  },
  subir: async (key, png) => {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: png,
      ContentType: "image/png",
    }));
  },
  borrar: async (key) => {
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  },
  registrar: async (pagoId, urlBoleta) => db.transaction(async (tx) => {
    // Dos disparos a la vez (o disparo + barrido) se serializan por pago: el
    // segundo ve la fila del primero y no inserta otra.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOLETA_NEXA_ADVISORY_LOCK_NAMESPACE}, ${pagoId})`);
    const insertadas = await tx.execute(sql`
      INSERT INTO cartera.boletas (pago_id, url_boleta)
      SELECT p.pago_id, ${urlBoleta}
      FROM cartera.pagos_credito p
      WHERE p.pago_id = ${pagoId}
        AND p.nexa_payment_event_id IS NOT NULL
        AND p."paymentFalse" = false
        AND ${eventoAplicado}
        AND NOT EXISTS (SELECT 1 FROM cartera.boletas b WHERE b.pago_id = p.pago_id)
      RETURNING id
    `);
    return insertadas.rows.length > 0;
  }),
  // Igual que prepararURLsBoletas (registerPayment.ts): URL_PUBLIC_R2 + key.
  urlPublica: (key) => (process.env.URL_PUBLIC_R2 ? `${process.env.URL_PUBLIC_R2}${key}` : null),
};
