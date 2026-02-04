// build_cost_detail_workbook_peach.ts
import ExcelJS from "exceljs";
import Big from "big.js";
import { GetCreditDTO } from "../interface";

/** Safe number parser for strings like "Q1,915.15" or numbers */
function toNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[Qq,\s,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Peach/Orange theme palette */
const PEACH = {
  title:   "FFD86B3A", // main title
  header:  "FFE19B71", // table header
  accent:  "FFD86B3A", // strong numbers
  zebra:   "FFFFF2EC", // light row
  border:  "FFE9C4B1",
  white:   "FFFFFFFF",
  text:    "FF0F172A",
  slate:   "FF58413A",
};

/** Style header row */
function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: PEACH.white } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PEACH.header } };
    cell.border = {
      top:    { style: "thin", color: { argb: PEACH.border } },
      left:   { style: "thin", color: { argb: PEACH.border } },
      bottom: { style: "thin", color: { argb: PEACH.border } },
      right:  { style: "thin", color: { argb: PEACH.border } },
    };
  });
}

/** Thin bottom border for body rows */
function setThinBottomBorder(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.border = {
      ...(cell.border ?? {}),
      bottom: { style: "thin", color: { argb: PEACH.border } },
    };
  });
}

function gtq(v: string | number | null | undefined): string {
  const n = toNum(v);
  return "Q" + n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Build "DETALLE DE COSTOS - PRÉSTAMO" (peach theme).
 * Unified table: Capital row + Garantía mobiliaria row + cuotas + TOTALES
 * Columns: No. | Mes | Seguro | GPS | Otros | Total a cancelar
 */
export async function buildCostDetailWorkbookPeach(
  data: GetCreditDTO,
  opts?: { logoBase64?: { data: string; ext: "png" | "jpeg" } | null }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Club Cash In";
  wb.created = new Date();

  const ws = wb.addWorksheet("Detalle de costos", {
    properties: { defaultRowHeight: 18 },
    views: [{ state: "frozen", ySplit: 11 }],
  });

  // Column widths: No., Mes, Seguro, GPS, Otros, Total a cancelar
  [7, 12, 14, 12, 14, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // Optional logo
  if (opts?.logoBase64) {
    const imgId = wb.addImage({ base64: opts.logoBase64.data, extension: opts.logoBase64.ext });
    ws.addImage(imgId, "A1:B2");
  }

  // Titles
  ws.mergeCells("C1:F1");
  ws.getCell("C1").value = "DETALLE DE COSTOS";
  ws.getCell("C1").font = { bold: true, size: 18, color: { argb: PEACH.title } };
  ws.getCell("C1").alignment = { vertical: "middle" };

  ws.mergeCells("C2:F2");
  ws.getCell("C2").value = "PRÉSTAMO";
  ws.getCell("C2").font = { bold: true, size: 14, color: { argb: PEACH.title } };
  ws.getCell("C2").alignment = { vertical: "middle" };

  // Left card: only Cliente, Préstamo No., Moneda
  const info: [string, string][] = [
    ["Cliente", data.header.usuario],
    ["Préstamo No.", data.header.numero_credito_sifco],
    ["Moneda", data.header.moneda],
  ];

  let r = 4;
  for (const [k, v] of info) {
    ws.mergeCells(`A${r}:B${r}`);
    ws.getCell(`A${r}`).value = k;
    ws.getCell(`A${r}`).font = { bold: true, color: { argb: PEACH.slate } };
    ws.mergeCells(`C${r}:E${r}`);
    ws.getCell(`C${r}`).value = v;
    r++;
  }

  // Closure data for garantía mobiliaria
  const closureData = data.closure;
  let garantiaMobiliaria = 0;
  if (closureData?.kind === "CANCELACION") {
    garantiaMobiliaria = toNum(closureData.garantia_mobiliaria);
  }

  const saldoBase = toNum(data.header.saldo_total);

  // Compute totals from cuotas
  let totalSeguro = 0;
  let totalGPS = 0;
  let totalOtros = 0;

  for (const it of data.cuotas_atrasadas.items) {
    totalSeguro += toNum((it as any).seguro ?? (data as any).header?.seguro_10_cuotas ?? 0);
    totalGPS += toNum((it as any).gps ?? (data as any).header?.gps ?? 0);
    totalOtros += toNum(it.otros ?? 0);
  }

  const totalCostos = totalSeguro + totalGPS + totalOtros;
  const totalConExtras = saldoBase + garantiaMobiliaria + totalCostos;

  // Right card: only "Total a cancelar"
  ws.getCell("F4").value = "Total a cancelar";
  ws.getCell("F4").font = { bold: true, color: { argb: PEACH.slate } };
  ws.getCell("F4").alignment = { horizontal: "center" };

  ws.getCell("F5").value = totalConExtras;
  ws.getCell("F5").numFmt = '"Q"#,##0.00';
  ws.getCell("F5").font = { bold: true, size: 14, color: { argb: PEACH.accent } };
  ws.getCell("F5").alignment = { horizontal: "center" };

  // Header row
  let row = 11;
  const head = ws.getRow(row);
  head.values = ["No.", "Mes", "Seguro", "GPS", "Otros", "Total a cancelar"];
  styleHeaderRow(head);

  // Capital row
  row++;
  const capitalRow = ws.getRow(row);
  ws.mergeCells(`A${row}:E${row}`);
  capitalRow.getCell(1).value = "Capital";
  capitalRow.getCell(1).font = { bold: true, color: { argb: PEACH.text } };
  capitalRow.getCell(1).alignment = { horizontal: "left" };
  capitalRow.getCell(6).value = saldoBase;
  capitalRow.getCell(6).numFmt = '"Q"#,##0.00';
  capitalRow.getCell(6).font = { bold: true, color: { argb: PEACH.accent } };
  capitalRow.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF0E6" } };
  setThinBottomBorder(capitalRow);

  // Garantía mobiliaria row
  if (garantiaMobiliaria !== 0) {
    row++;
    const gmRow = ws.getRow(row);
    ws.mergeCells(`A${row}:D${row}`);
    gmRow.getCell(1).value = "Garantía mobiliaria";
    gmRow.getCell(1).font = { bold: true, color: { argb: PEACH.text } };
    gmRow.getCell(1).alignment = { horizontal: "left" };
    gmRow.getCell(5).value = garantiaMobiliaria;
    gmRow.getCell(5).numFmt = '"Q"#,##0.00';
    gmRow.getCell(6).value = garantiaMobiliaria;
    gmRow.getCell(6).numFmt = '"Q"#,##0.00';
    gmRow.getCell(6).font = { bold: true, color: { argb: PEACH.accent } };
    gmRow.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF0E6" } };
    setThinBottomBorder(gmRow);
  }

  // Cuota rows
  if (data.cuotas_atrasadas.items.length === 0) {
    row++;
    ws.mergeCells(`A${row}:F${row}`);
    ws.getCell(`A${row}`).value = "Sin cuotas atrasadas";
    ws.getCell(`A${row}`).alignment = { horizontal: "center" };
    ws.getCell(`A${row}`).font = { italic: true, color: { argb: PEACH.slate } };
  } else {
    for (const it of data.cuotas_atrasadas.items) {
      row++;

      const seguro = toNum((it as any).seguro ?? (data as any).header?.seguro_10_cuotas ?? 0);
      const gps = toNum((it as any).gps ?? (data as any).header?.gps ?? 0);
      const otros = toNum(it.otros ?? 0);
      const totalFila = seguro + gps + otros;

      const rr = ws.getRow(row);
      rr.values = [it.no, it.mes, seguro, gps, otros, totalFila];

      [3, 4, 5, 6].forEach((i) => (rr.getCell(i).numFmt = '"Q"#,##0.00'));
      rr.getCell(6).font = { bold: true, color: { argb: PEACH.accent } };

      if (row % 2 === 0) {
        for (let c = 1; c <= 6; c++) {
          rr.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PEACH.zebra } };
        }
      }
      setThinBottomBorder(rr);
    }
  }

  // TOTALES row
  row++;
  const totalRow = ws.getRow(row);
  totalRow.getCell(1).value = "TOTALES:";
  totalRow.getCell(1).font = { bold: true, color: { argb: PEACH.title } };
  totalRow.getCell(1).alignment = { horizontal: "right" };
  ws.mergeCells(`A${row}:B${row}`);

  totalRow.getCell(3).value = totalSeguro;
  totalRow.getCell(4).value = totalGPS;
  totalRow.getCell(5).value = totalOtros + garantiaMobiliaria;
  totalRow.getCell(6).value = totalConExtras;

  [3, 4, 5, 6].forEach((i) => {
    totalRow.getCell(i).numFmt = '"Q"#,##0.00';
    totalRow.getCell(i).font = { bold: true, color: { argb: PEACH.accent } };
    totalRow.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE4D6" } };
  });

  const arr = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return Buffer.from(arr);
}

/** PDF: DETALLE DE COSTOS (durazno) — Unified table with Capital + Garantía mobiliaria */
export function renderCostDetailHTMLPeach(data: GetCreditDTO, logoUrl: string) {
  const saldoBase = Number(data.header.saldo_total || 0);

  // Closure data for garantía mobiliaria
  const closureData = data.closure;
  let garantiaMobiliaria = 0;
  if (closureData?.kind === "CANCELACION") {
    garantiaMobiliaria = Number(closureData.garantia_mobiliaria || 0);
  }

  // Totales de la tabla (solo costos: seguro + gps + otros)
  const totales = data.cuotas_atrasadas.items.reduce(
    (acc, r) => {
      const seguro = Number((r as any).seguro ?? (data as any).header?.seguro_10_cuotas ?? 0);
      const gps = Number((r as any).gps ?? (data as any).header?.gps ?? 0);
      const otros = Number(r.otros ?? 0);
      const totalFila = seguro + gps + otros;

      return {
        seguro: acc.seguro + seguro,
        gps: acc.gps + gps,
        otros: acc.otros + otros,
        total_cancelar: acc.total_cancelar + totalFila,
      };
    },
    { seguro: 0, gps: 0, otros: 0, total_cancelar: 0 }
  );

  const totalConExtras = saldoBase + garantiaMobiliaria + totales.total_cancelar;

  // Filas de cuotas
  const rows = data.cuotas_atrasadas.items.map((r) => {
    const seguro = Number((r as any).seguro ?? (data as any).header?.seguro_10_cuotas ?? 0);
    const gps = Number((r as any).gps ?? (data as any).header?.gps ?? 0);
    const otros = Number(r.otros ?? 0);
    const totalFila = seguro + gps + otros;

    return `
      <tr>
        <td>${r.no}</td>
        <td>${r.mes}</td>
        <td>${gtq(seguro)}</td>
        <td>${gtq(gps)}</td>
        <td>${gtq(otros)}</td>
        <td class="total">${gtq(totalFila)}</td>
      </tr>`;
  }).join("");

  // Capital row
  const capitalRow = `
    <tr style="background:#FFF0E6;">
      <td colspan="5" style="font-weight:700;color:#D86B3A;">Capital</td>
      <td class="total" style="font-weight:800;">${gtq(saldoBase)}</td>
    </tr>`;

  // Garantía mobiliaria row
  const garantiaRow = garantiaMobiliaria !== 0
    ? `
    <tr style="background:#FFF0E6;">
      <td colspan="4" style="font-weight:700;color:#D86B3A;">Garantía mobiliaria</td>
      <td>${gtq(garantiaMobiliaria)}</td>
      <td class="total" style="font-weight:800;">${gtq(garantiaMobiliaria)}</td>
    </tr>`
    : "";

  // Fila de totales
  const totalesRow = `
    <tr class="totales-row">
      <td colspan="2" style="text-align:right;font-weight:700;background:#FFE4D6;color:#D86B3A;">TOTALES:</td>
      <td style="font-weight:700;background:#FFE4D6;">${gtq(totales.seguro)}</td>
      <td style="font-weight:700;background:#FFE4D6;">${gtq(totales.gps)}</td>
      <td style="font-weight:700;background:#FFE4D6;">${gtq(totales.otros + garantiaMobiliaria)}</td>
      <td class="total" style="font-weight:800;background:#FFE4D6;font-size:14px;">${gtq(totalConExtras)}</td>
    </tr>
  `;

  const empty = `<tr><td colspan="6" class="tbl-note">Sin cuotas atrasadas</td></tr>`;

  return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Detalle de Costos</title>
<style>
  :root{
    --peach-title:#D86B3A;
    --peach-head:#E19B71;
    --text:#0F172A;
    --slate:#58413A;
    --line:#E9C4B1;
    --zebra:#FFF2EC;
    --white:#FFFFFF;
  }
  *{ box-sizing:border-box; font-family:"Inter", Arial, sans-serif; }
  body{ color:var(--text); margin:0; padding:20px; }

  .header{ display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
  .brand{ display:flex; align-items:center; gap:12px; }
  .brand img{ height:40px; }

  .summary{ display:grid; grid-template-columns: 1fr 240px; gap:18px; margin:10px 0 18px; }
  .box{ border:1.6px solid var(--line); border-radius:8px; padding:14px; background:var(--zebra); }
  .left dl{ margin:0; display:grid; grid-template-columns:160px 1fr; row-gap:8px; column-gap:8px; }
  dl dt{ color:var(--slate); font-weight:600; } dl dd{ margin:0; }

  .saldo{ display:flex; align-items:center; justify-content:center; text-align:center; }
  .saldo .num{ font-size:22px; color:var(--peach-title); font-weight:800; }
  .saldo small{ display:block; color:#64748b; font-weight:600; margin-bottom:4px; }

  table{ width:100%; border-collapse:collapse; margin:10px 0; }
  thead th{ background:var(--peach-head); color:var(--white); font-weight:700; padding:8px; font-size:12px; text-align:center; }
  tbody td{ padding:8px; border:1px solid var(--line); font-size:12px; text-align:right; }
  tbody td:nth-child(1), tbody td:nth-child(2){ text-align:center; }
  tbody tr:nth-child(even) td{ background:var(--zebra); }
  td.total{ font-weight:800; color:var(--peach-title); }
  .tbl-note{ text-align:center; color:#7c8591; padding:10px 0; }

  .foot{ display:flex; justify-content:space-between; margin-top:10px; font-size:11px; color:#64748b; }
</style>
</head>
<body>

<div class="header">
  <div class="brand">
    ${logoUrl ? `<img src="${logoUrl}" alt="logo" />` : ""}
    <div>
      <div style="font-size:12px;color:#64748b;">DETALLE DE COSTOS</div>
      <div style="font-size:14px;font-weight:700;color:var(--peach-title);">PRÉSTAMO</div>
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
    </dl>
  </div>

  <div class="box saldo">
    <div>
      <small>Total a cancelar</small>
      <div class="num">${gtq(totalConExtras)}</div>
    </div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>No.</th>
      <th>Mes</th>
      <th>Seguro</th>
      <th>GPS</th>
      <th>Otros</th>
      <th>Total a cancelar</th>
    </tr>
  </thead>
  <tbody>
    ${capitalRow}
    ${garantiaRow}
    ${rows || empty}
    ${data.cuotas_atrasadas.items.length ? totalesRow : ""}
  </tbody>
</table>

<div class="foot">
  <div>Generado por Club Cashin.com</div>
  <div>${new Date().toLocaleDateString("es-GT")}</div>
</div>

</body>
</html>`;
}
