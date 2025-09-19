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

/**
 * Build "DETALLE DE COSTOS - PRÉSTAMO" (peach theme).
 * Columns:
 *  No. | Mes | Seguro | GPS | Otros | Capital pendiente de pago | Total a cancelar
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

  // Column widths (similar layout to your screenshot)
  // No., Mes, Seguro, GPS, Otros, Capital pendiente, Total a cancelar
  [7, 12, 14, 12, 14, 26, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // Optional logo
  if (opts?.logoBase64) {
    const imgId = wb.addImage({ base64: opts.logoBase64.data, extension: opts.logoBase64.ext });
    ws.addImage(imgId, "A1:B2");
  }

  // Titles
  ws.mergeCells("C1:G1");
  ws.getCell("C1").value = "DETALLE DE COSTOS";
  ws.getCell("C1").font = { bold: true, size: 18, color: { argb: PEACH.title } };
  ws.getCell("C1").alignment = { vertical: "middle" };

  ws.mergeCells("C2:G2");
  ws.getCell("C2").value = "PRÉSTAMO";
  ws.getCell("C2").font = { bold: true, size: 14, color: { argb: PEACH.title } };
  ws.getCell("C2").alignment = { vertical: "middle" };

  // Left card: client/credit info
  const info: [string, string][] = [
    ["Cliente", data.header.usuario],
    ["Préstamo No.", data.header.numero_credito_sifco],
    ["Moneda", data.header.moneda],
    ["Tipo de crédito", data.header.tipo_credito],
    // Optional line like "DATOS DEL VEHÍCULO"
    ["DATOS DEL VEHÍCULO", ""],
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

  // Right card: balance
  ws.mergeCells("F4:G4");
  ws.getCell("F4").value = "Saldo total";
  ws.getCell("F4").font = { bold: true, color: { argb: PEACH.slate } };

  ws.mergeCells("F5:G5");
  ws.getCell("F5").value = toNum(data.header.saldo_total);
  ws.getCell("F5").numFmt = '"Q"#,##0.00';
  ws.getCell("F5").font = { bold: true, size: 14, color: { argb: PEACH.accent } };

  // 🔸 NUEVO: Con extras (siempre visible)
  ws.mergeCells("F7:G7");
  ws.getCell("F7").value = "Con extras";
  ws.getCell("F7").font = { bold: true, color: { argb: PEACH.slate } };

  ws.mergeCells("F8:G8");
  ws.getCell("F8").value = toNum(data.header.saldo_total_con_extras);
  ws.getCell("F8").numFmt = '"Q"#,##0.00';
  ws.getCell("F8").font = { bold: true, size: 14, color: { argb: PEACH.accent } };

  // Header row for the cost table
  let row = 11;
  const head = ws.getRow(row);
  head.values = [
    "No.",
    "Mes",
    "Seguro",
    "GPS",
    "Otros",
    "Capital pendiente de pago",
    "Total a cancelar",
  ];
  styleHeaderRow(head);

  // Body rows
  if (data.cuotas_atrasadas.items.length === 0) {
    row++;
    ws.mergeCells(`A${row}:G${row}`);
    ws.getCell(`A${row}`).value = "Sin cuotas atrasadas";
    ws.getCell(`A${row}`).alignment = { horizontal: "center" };
    ws.getCell(`A${row}`).font = { italic: true, color: { argb: PEACH.slate } };
  } else {
    let totalSeguro = 0;
    let totalGPS = 0;
    let totalOtros = 0;
    let totalCapital = 0;
    let totalCancelar = 0;

    for (const it of data.cuotas_atrasadas.items) {
      row++;

      // Pull per-row values; fallback to header fields if item doesn't include them
      const seguro   = new Big((it as any).seguro ?? (data as any).header?.seguro_10_cuotas ?? 0);
      const gps      = new Big((it as any).gps ?? (data as any).header?.gps ?? 0);
      const otros    = new Big(it.otros ?? 0);
      const capital  = new Big(it.capital_pendiente ?? 0);
      const total    = new Big(it.total_cancelar ?? 0);

      totalSeguro  += Number(seguro.toString());
      totalGPS     += Number(gps.toString());
      totalOtros   += Number(otros.toString());
      totalCapital += Number(capital.toString());
      totalCancelar+= Number(total.toString());

      const rr = ws.getRow(row);
      rr.values = [
        it.no,
        it.mes,
        Number(seguro.toString()),
        Number(gps.toString()),
        Number(otros.toString()),
        Number(capital.toString()),
        Number(total.toString()),
      ];

      // Currency format for numeric columns
      [3,4,5,6,7].forEach((i) => (rr.getCell(i).numFmt = '"Q"#,##0.00'));
      rr.getCell(7).font = { bold: true, color: { argb: PEACH.accent } };

      // Zebra striping
      if (row % 2 === 0) {
        for (let c = 1; c <= 7; c++) {
          rr.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PEACH.zebra } };
        }
      }
      setThinBottomBorder(rr);
    }

    // Totals row
    row++;
    const totalRow = ws.getRow(row);
    totalRow.getCell(1).value = "Total";
    totalRow.getCell(1).font = { bold: true, color: { argb: PEACH.slate } };
    // Merge label across first two cols
    ws.mergeCells(`A${row}:B${row}`);
    totalRow.getCell(3).value = totalSeguro;
    totalRow.getCell(4).value = totalGPS;
    totalRow.getCell(5).value = totalOtros;
    totalRow.getCell(6).value = totalCapital;
    totalRow.getCell(7).value = totalCancelar;
    [3,4,5,6,7].forEach((i) => {
      totalRow.getCell(i).numFmt = '"Q"#,##0.00';
      totalRow.getCell(i).font = { bold: true, color: { argb: PEACH.accent } };
    });
  }

  // ===== Montos adicionales (sección peach) =====
  row += 2;
  ws.mergeCells(`A${row}:G${row}`);
  ws.getCell(`A${row}`).value = "Montos adicionales";
  ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: PEACH.title } };

  row++;
  const eHead = ws.getRow(row);
  eHead.values = ["#", "Concepto", "Monto", "Fecha", "", "", ""];
  styleHeaderRow(eHead);

  if (data.extras.total_items > 0) {
    for (let i = 0; i < data.extras.items.length; i++) {
      const e = data.extras.items[i];
      row++;
      const rr = ws.getRow(row);
      rr.values = [
        i + 1,
        e.concepto,
        toNum(e.monto),
        e.fecha_registro ? String(e.fecha_registro).slice(0, 10) : "-",
      ];
      rr.getCell(3).numFmt = '"Q"#,##0.00';
      setThinBottomBorder(rr);
    }
    row++;
    ws.mergeCells(`A${row}:F${row}`);
    ws.getCell(`A${row}`).value = "Total extras:";
    ws.getCell(`A${row}`).alignment = { horizontal: "right" };
    ws.getCell(`A${row}`).font = { bold: true, color: { argb: PEACH.slate } };

    ws.getCell(`G${row}`).value = toNum(data.header.extras_total);
    ws.getCell(`G${row}`).numFmt = '"Q"#,##0.00';
    ws.getCell(`G${row}`).font = { bold: true, color: { argb: PEACH.accent } };
  } else {
    row++;
    ws.mergeCells(`A${row}:G${row}`);
    ws.getCell(`A${row}`).value = "Sin extras registrados";
    ws.getCell(`A${row}`).alignment = { horizontal: "center" };
    ws.getCell(`A${row}`).font = { italic: true, color: { argb: PEACH.slate } };
  }

  const arr = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return Buffer.from(arr);
}

function gtq(v: string | number | null | undefined): string {
  const n = toNum(v);
  return "Q" + n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** PDF: DETALLE DE COSTOS (durazno) — con “Con extras”, logo y Montos adicionales */
export function renderCostDetailHTMLPeach(data: GetCreditDTO, logoUrl: string) {
  // Totales de la tabla principal
  let sumSeguro = 0, sumGPS = 0, sumOtros = 0, sumCapital = 0, sumTotal = 0;

  // Filas de la tabla principal
  const rows = data.cuotas_atrasadas.items.map((r) => {
    const seguro  = (r as any).seguro ?? (data as any).header?.seguro_10_cuotas ?? 0;
    const gps     = (r as any).gps ?? (data as any).header?.gps ?? 0;
    const otros   = r.otros ?? 0;
    const capital = r.capital_pendiente ?? 0;
    const total   = r.total_cancelar ?? 0;

    sumSeguro  += toNum(seguro);
    sumGPS     += toNum(gps);
    sumOtros   += toNum(otros);
    sumCapital += toNum(capital);
    sumTotal   += toNum(total);

    return `
      <tr>
        <td>${r.no}</td>
        <td>${r.mes}</td>
        <td>${gtq(seguro)}</td>
        <td>${gtq(gps)}</td>
        <td>${gtq(otros)}</td>
        <td>${gtq(capital)}</td>
        <td class="total">${gtq(total)}</td>
      </tr>`;
  }).join("");

  const empty = `<tr><td colspan="7" class="tbl-note">Sin cuotas atrasadas</td></tr>`;

  // Sección de Montos adicionales
  const extrasBlock = data.extras.total_items > 0
    ? `
      <div class="extras">
        <h3>Montos adicionales</h3>
        <table>
          <thead>
            <tr><th>#</th><th>Concepto</th><th>Monto</th><th>Fecha</th></tr>
          </thead>
          <tbody>
            ${data.extras.items.map((e, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${e.concepto}</td>
                <td class="total">${gtq(e.monto)}</td>
                <td>${e.fecha_registro ? String(e.fecha_registro).slice(0, 10) : "-"}</td>
              </tr>`).join("")}
          </tbody>
        </table>
        <div class="extras-total">Total extras: <strong>${gtq(data.header.extras_total)}</strong></div>
      </div>`
    : "";

  return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Detalle de Costos</title>
<style>
  :root{
    --peach-title:#D86B3A;  /* títulos y acentos */
    --peach-head:#E19B71;   /* encabezado de tabla */
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
  .saldo small{ display:block; color:#64748b; font-weight:600; }

  table{ width:100%; border-collapse:collapse; margin:10px 0; }
  thead th{ background:var(--peach-head); color:var(--white); font-weight:700; padding:8px; font-size:12px; text-align:center; }
  tbody td{ padding:8px; border:1px solid var(--line); font-size:12px; text-align:right; }
  tbody td:nth-child(1), tbody td:nth-child(2){ text-align:center; }
  tbody tr:nth-child(even) td{ background:var(--zebra); }
  td.total{ font-weight:800; color:var(--peach-title); }
  .tbl-note{ text-align:center; color:#7c8591; padding:10px 0; }

  h3{ margin:16px 0 8px; color:var(--peach-title); }
  .extras-total{ margin-top:6px; text-align:right; color:var(--peach-title); }
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
      <dt>Tipo de crédito</dt><dd>${data.header.tipo_credito}</dd>
      <dt>DATOS DEL VEHÍCULO</dt><dd></dd>
    </dl>
  </div>

  <div class="box saldo">
    <div>
      <small>Saldo total</small>
      <div class="num">${gtq(data.header.saldo_total)}</div>

      <!-- Con extras (siempre visible, como pediste) -->
      <small style="display:block;margin-top:10px;">Con extras</small>
      <div class="num">${gtq(data.header.saldo_total_con_extras)}</div>
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
      <th>Capital pendiente de pago</th>
      <th>Total a cancelar</th>
    </tr>
  </thead>
  <tbody>
    ${rows || empty}
    ${data.cuotas_atrasadas.items.length ? `
      <tr>
        <td colspan="2" style="text-align:right; font-weight:700; color:var(--peach-title);">Total</td>
        <td style="font-weight:700; color:var(--peach-title);">${gtq(sumSeguro)}</td>
        <td style="font-weight:700; color:var(--peach-title);">${gtq(sumGPS)}</td>
        <td style="font-weight:700; color:var(--peach-title);">${gtq(sumOtros)}</td>
        <td style="font-weight:700; color:var(--peach-title);">${gtq(sumCapital)}</td>
        <td class="total">${gtq(sumTotal)}</td>
      </tr>` : ""}
  </tbody>
</table>

${extrasBlock}

<div class="foot">
  <div>Generado por Club Cashin.com</div>
  <div>${new Date().toLocaleDateString("es-GT")}</div>
</div>

</body>
</html>`;
}