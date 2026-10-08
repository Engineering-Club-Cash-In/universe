import Big from "big.js";
import type {
  DesgloseEstadoCuentaCancelacion,
  EntradaEstadoCuentaCancelacion,
} from "./estadoCuentaCancelacionCalculo";

// ================================================================
// HTML (para Puppeteer) del estado de cuenta de solicitud de cancelación.
//
// Puro: no toca BD ni red. Las filas del historial llegan ya renderizadas por
// los helpers del estado de cuenta existente (`renderEstadoCuentaPaymentRow`),
// que NO se modifican. Todo texto libre (nombre, motivo, observaciones,
// conceptos) pasa por `escapeHtml` antes de interpolarse.
// ================================================================

export function escapeHtml(valor: unknown): string {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Q con separador de miles, conservando los decimales del monto (mínimo 2). */
export function formatQ(monto: string): string {
  const v = new Big(monto || "0");
  const negativo = v.lt(0);
  const abs = v.abs();
  const texto = abs.toFixed();
  const [entero, dec = ""] = texto.split(".");
  const decimales = dec.length >= 2 ? dec : abs.toFixed(2).split(".")[1];
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negativo ? "-" : ""}Q${miles}.${decimales}`;
}

/** Día de emisión en Guatemala, p. ej. «5 de octubre de 2026». */
export function formatFechaGuatemala(instante: Date): string {
  return instante.toLocaleDateString("es-GT", {
    timeZone: "America/Guatemala",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export interface HistorialPagosRenderizado {
  /** `<tr>` de encabezados (de `buildEstadoCuentaTableHeader`). */
  encabezadoHtml: string;
  /** Un `<tr>` por pago elegible (de `renderEstadoCuentaPaymentRow`). Vacío = sin pagos. */
  filasHtml: string[];
  /** Montos ABONADOS (sumas de las filas). */
  totales: {
    capital: string;
    interes: string;
    iva: string;
    servicios: string;
    mora: string;
    montoAplicado: string;
  };
}

export interface DatosHtmlEstadoCuentaCancelacion {
  documentoId: string;
  numeroCredito: string;
  clienteNombre: string;
  generadoAt: Date;
  fechaCorteGT: string;
  logoUrl: string;
  historial: HistorialPagosRenderizado;
  entrada: EntradaEstadoCuentaCancelacion;
  desglose: DesgloseEstadoCuentaCancelacion;
}

const filaDesglose = (etiqueta: string, monto: string, clase = "") =>
  `<tr class="${clase}"><td>${etiqueta}</td><td class="money">${formatQ(monto)}</td></tr>`;

/**
 * Lo que el cliente ve como «Otros»: todo lo que no es capital (cuotas
 * restantes, mora, traspaso, garantía, otros y montos adicionales). Así
 * Capital + Otros = Total para cancelar, el mismo monto que se guarda.
 */
export const otrosParaCliente = (x: Pick<DesgloseEstadoCuentaCancelacion, "montoCancelacion" | "capital">) =>
  new Big(x.montoCancelacion || "0").minus(new Big(x.capital || "0")).toFixed(2);

export function renderEstadoCuentaCancelacionHTML(d: DatosHtmlEstadoCuentaCancelacion): string {
  const { desglose: x, entrada, historial } = d;
  const fechaEmision = formatFechaGuatemala(d.generadoAt);

  const tablaHistorial = historial.filasHtml.length
    ? `<table class="historial">
        <thead>${historial.encabezadoHtml}</thead>
        <tbody>
          ${historial.filasHtml.join("")}
          <tr class="totals-row">
            <td colspan="4">TOTAL ABONADO</td>
            <td class="money">${formatQ(historial.totales.capital)}</td>
            <td class="money">${formatQ(historial.totales.interes)}</td>
            <td class="money">${formatQ(historial.totales.iva)}</td>
            <td class="money">${formatQ(historial.totales.servicios)}</td>
            <td class="money">${formatQ(historial.totales.mora)}</td>
            <td class="money">${formatQ(historial.totales.montoAplicado)}</td>
            <td colspan="3"></td>
          </tr>
        </tbody>
      </table>`
    : `<div class="sin-pagos">Sin pagos realizados</div>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px 25px; color: #333; }
    .header-bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 8px; padding-bottom: 12px; border-bottom: 3px solid #1F4E79; }
    .header-bar img { height: 150px; max-width: 60%; object-fit: contain; object-position: left center; }
    .header-bar .title-block { margin-left: auto; text-align: right; flex-shrink: 0; }
    .header-bar h1 { font-size: 18px; color: #1F4E79; }
    .header-bar p { font-size: 10px; color: #888; }
    .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 16px; background: #f0f5fa; border-radius: 6px; padding: 8px 14px; margin-bottom: 14px; font-size: 10.5px; }
    .info-grid strong { color: #1F4E79; }
    h2 { font-size: 12px; color: #1F4E79; margin: 12px 0 6px; text-transform: uppercase; letter-spacing: .5px; }
    table { width: 100%; border-collapse: collapse; }
    table.historial { font-size: 8px; }
    table.historial th { background: #1F4E79; color: #fff; padding: 6px 4px; text-align: center; font-weight: 600; font-size: 7.5px; white-space: nowrap; border: 1px solid #0D3B66; }
    table.historial td { padding: 4px 3px; text-align: center; border-bottom: 1px solid #e8e8e8; white-space: nowrap; }
    td.money { text-align: right; font-family: 'Consolas', monospace; }
    table.historial td.money { font-size: 7.5px; }
    td.total { font-weight: 600; color: #1F4E79; }
    tr.even td { background: #f8fafc; }
    .totals-row td { background: #1F4E79 !important; color: #fff; font-weight: 700; padding: 6px 4px; border: 1px solid #0D3B66; }
    .sin-pagos { border: 1px dashed #bbb; border-radius: 6px; padding: 14px; text-align: center; font-size: 12px; color: #666; }
    .cancelacion { display: flex; gap: 16px; align-items: flex-start; }
    .cancelacion table { font-size: 10px; flex: 1; }
    .cancelacion td { padding: 4px 8px; border-bottom: 1px solid #eee; }
    .cancelacion tr.grand td { background: #1F4E79; color: #fff; font-weight: 700; font-size: 12px; border: none; }
    .motivo { flex: 0 0 32%; background: #f8fafc; border-radius: 6px; padding: 8px 12px; font-size: 10px; }
    .motivo p { margin-bottom: 6px; white-space: pre-wrap; word-break: break-word; }
    .footer { margin-top: 16px; text-align: center; font-size: 8px; color: #aaa; border-top: 1px solid #eee; padding-top: 8px; }
  </style>
</head>
<body>
  <div class="header-bar">
    <img src="${escapeHtml(d.logoUrl)}" alt="Cash-In" />
    <div class="title-block">
      <h1>Estado de Cuenta — Solicitud de Cancelación</h1>
      <p>Club Cash-In</p>
    </div>
  </div>

  <div class="info-grid">
    <span><strong>Crédito:</strong> ${escapeHtml(d.numeroCredito)}</span>
    <span><strong>Cliente:</strong> ${escapeHtml(d.clienteNombre)}</span>
    <span><strong>Moneda:</strong> GTQ</span>
    <span><strong>Fecha de corte:</strong> ${escapeHtml(d.fechaCorteGT)}</span>
    <span><strong>Emitido:</strong> ${escapeHtml(fechaEmision)}</span>
  </div>

  <h2>Historial de pagos aplicados (montos abonados)</h2>
  ${tablaHistorial}

  <h2>Montos pendientes para cancelar</h2>
  <div class="cancelacion">
    <table>
      <tbody>
        ${filaDesglose("Capital", x.capital)}
        ${filaDesglose("Otros", otrosParaCliente(x))}
        ${filaDesglose("TOTAL PARA CANCELAR", x.montoCancelacion, "grand")}
      </tbody>
    </table>
    <div class="motivo">
      <p><strong>Motivo:</strong> ${escapeHtml(entrada.motivo)}</p>
      ${entrada.observaciones ? `<p><strong>Observaciones:</strong> ${escapeHtml(entrada.observaciones)}</p>` : ""}
    </div>
  </div>

  <div class="footer">
    Documento ${escapeHtml(d.documentoId)} generado por el sistema de Club Cash-In &mdash; ${escapeHtml(fechaEmision)}
  </div>
</body>
</html>`;
}
