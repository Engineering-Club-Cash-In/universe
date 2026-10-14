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

import { readFileSync } from "node:fs";

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
