import { generarHTMLReporte } from "../../controllers/investor";
import { InversionistaReporte } from "../interface";
import puppeteer from "puppeteer";
// Tipos auxiliares
export type ClosureInfo =
  | {
      kind: "CANCELACION";
      id: number;
      motivo: string;
      observaciones: string | null;
      fecha: Date | string | null;
      monto: string; // numeric de PG -> string
    }
  | {
      kind: "INCOBRABLE";
      id: number;
      motivo: string;
      observaciones: string | null;
      fecha: Date | string | null;
      monto: string; // numeric de PG -> string
    }
  | null;

export type CuotaExcelRow = {
  no: number;
  mes: string;
  interes: string;            // numeric -> string
  servicios: string;          // numeric -> string
  mora: string;               // numeric -> string
  otros: string;              // numeric -> string
  capital_pendiente: string;  // numeric -> string
  total_cancelar: string;     // numeric -> string
  fecha_vencimiento: string;  // YYYY-MM-DD
};

// DTO principal
export interface GetCreditDTO {
  header: {
    usuario: string;
    numero_credito_sifco: string;
    moneda: "Quetzal";
    tipo_credito: string;
    observaciones: string;
    saldo_total: string;             // numeric -> string
    extras_total: string;            // NUEVO
    saldo_total_con_extras: string;  // NUEVO
  };
  closure: ClosureInfo;
  cuotas_atrasadas: {
    total: number;
    items: CuotaExcelRow[];
  };
  extras: {
    total_items: number;
    items: Array<{
      id: number;
      concepto: string;
      monto: string;                 // numeric -> string
      fecha_registro: Date | string | null;
    }>;
  };
}

export async function generarPDFBuffer(
  inversionista: InversionistaReporte,
  logoUrl: string = ""
): Promise<Buffer> {
  const html = generarHTMLReporte(inversionista, logoUrl);
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdfData =await page.pdf({
  format: 'A4',
  landscape: true,
  printBackground: true,
  margin: { top: 20, bottom: 20, left: 12, right: 12 }
});

  await browser.close();
  return Buffer.from(pdfData);
}

function gtq(n: string | number) {
  return `Q${Number(n).toLocaleString("es-GT", { minimumFractionDigits: 2 })}`;
}

export function renderCancelationHTML(data: GetCreditDTO, logoUrl: string) {
  const saldoBase = data.header.saldo_total;
  const extrasTotal = data.header.extras_total;
  const saldoConExtras = data.header.saldo_total_con_extras;

  const rows = data.cuotas_atrasadas.items
    .map(
      (r) => `
      <tr>
        <td>${r.no}</td>
        <td>${r.mes}</td>
        <td>${gtq(r.interes)}</td>
        <td>${gtq(r.servicios)}</td>
        <td>${gtq(r.mora)}</td>
        <td>${gtq(r.otros)}</td>
        <td>${gtq(r.capital_pendiente)}</td>
        <td class="total">${gtq(r.total_cancelar)}</td>
      </tr>
    `
    )
    .join("");

  const extrasBlock =
    data.extras.total_items > 0
      ? `
        <div class="extras">
          <h3>Montos adicionales</h3>
          <table>
            <thead>
              <tr><th>#</th><th>Concepto</th><th>Monto</th><th>Fecha</th></tr>
            </thead>
            <tbody>
              ${data.extras.items
                .map(
                  (e, i) => `
                    <tr>
                      <td>${i + 1}</td>
                      <td>${e.concepto}</td>
                      <td class="total">${gtq(e.monto)}</td>
                      <td>${e.fecha_registro ? String(e.fecha_registro).slice(0,10) : "-"}</td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
          <div class="extras-total">
            Total extras: <strong>${gtq(extrasTotal)}</strong>
          </div>
        </div>
      `
      : "";

  return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Detalle de Cancelación</title>
<style>
  * { box-sizing: border-box; font-family: "Inter", Arial, sans-serif; }
  body { color:#0f172a; margin:0; padding:20px; }
  .header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .brand img { height:40px; }
  .title { text-align:center; margin:10px 0 12px; }
  .title h1 { margin:0; font-size:24px; letter-spacing:1px; color:#0F1B4C; }
  .title h2 { margin:2px 0 0; font-size:20px; color:#0F1B4C; font-weight:700; }

  .summary { display:grid; grid-template-columns: 1fr 240px; gap:18px; margin:10px 0 18px; }
  .box { border:1.8px solid #cfe1ff; border-radius:8px; padding:14px; background:#f8fbff; }
  .left dl { margin:0; display:grid; grid-template-columns:140px 1fr; row-gap:8px; column-gap:8px; }
  dl dt { color:#334155; font-weight:600; }
  dl dd { margin:0; color:#0f172a; }

  .saldo { display:flex; align-items:center; justify-content:center; height:100%; }
  .saldo .num { font-size:22px; color:#0F56D9; font-weight:800; }
  .saldo small { display:block; color:#64748b; font-weight:600; }

  table { width:100%; border-collapse:collapse; margin:10px 0; }
  thead th { background:#0F1B4C; color:#fff; font-weight:700; padding:8px; font-size:12px; }
  tbody td { padding:8px; border-bottom:1px solid #e5e7eb; font-size:12px; }
  tbody tr:nth-child(even) td { background:#f9fbff; }
  td.total { font-weight:800; color:#0F56D9; }

  .extras h3 { margin:16px 0 8px; color:#0F1B4C; }
  .extras-total { margin-top:6px; text-align:right; color:#0F1B4C; }

  .foot { display:flex; justify-content:space-between; margin-top:10px; font-size:11px; color:#64748b; }
</style>
</head>
<body>

<div class="header">
  <div class="brand">
    ${logoUrl ? `<img src="${logoUrl}" alt="logo" />` : ""}
    <div>
      <div style="font-size:12px;color:#64748b;">DETALLE DE CANCELACIÓN</div>
      <div style="font-size:14px;font-weight:700;color:#0F1B4C;">PRÉSTAMO</div>
    </div>
  </div>
  <div style="text-align:right;font-size:11px;color:#64748b;">${new Date().toLocaleString("es-GT")}</div>
</div>

<div class="summary">
  <div class="box left">
    <dl>
      <dt>Cliente</dt><dd>${data.header.usuario}</dd>
      <dt>Préstamo No.</dt><dd>${data.header.numero_credito_sifco}</dd>
      <dt>Moneda</dt><dd>${data.header.moneda}</dd>
      <dt>Tipo de crédito</dt><dd>${data.header.tipo_credito}</dd>
      <dt>Observaciones</dt><dd>${data.header.observaciones || "-"}</dd>
    </dl>
  </div>

  <div class="box saldo">
    <div>
      <small>Saldo total</small>
      <div class="num">${gtq(saldoBase)}</div>
      ${
        Number(extrasTotal) !== 0
          ? `<small style="display:block;margin-top:6px;">Con extras</small>
             <div class="num">${gtq(saldoConExtras)}</div>`
          : ""
      }
    </div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>No.</th>
      <th>Mes</th>
      <th>Interés</th>
      <th>Servicios</th>
      <th>Mora</th>
      <th>OTROS</th>
      <th>Capital pendiente de pago</th>
      <th>Total a cancelar</th>
    </tr>
  </thead>
  <tbody>
    ${rows || `<tr><td colspan="8" style="text-align:center;color:#7c8591;">Sin cuotas atrasadas</td></tr>`}
  </tbody>
</table>

${extrasBlock}

<div class="foot">
  <div>Generado por Club Cashin.com</div>
  <div>${new Date().toLocaleDateString("es-GT")}</div>
</div>

</body>
</html>
`;
}
