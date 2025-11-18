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

  // ✅ Column widths - REMOVIMOS columna de capital
  // No., Mes, Seguro, GPS, Otros, Total a cancelar
  [7, 12, 14, 12, 14, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // Optional logo
  if (opts?.logoBase64) {
    const imgId = wb.addImage({ base64: opts.logoBase64.data, extension: opts.logoBase64.ext });
    ws.addImage(imgId, "A1:B2");
  }

  // Titles
  ws.mergeCells("C1:F1"); // ✅ Ajustado a 6 columnas
  ws.getCell("C1").value = "DETALLE DE COSTOS";
  ws.getCell("C1").font = { bold: true, size: 18, color: { argb: PEACH.title } };
  ws.getCell("C1").alignment = { vertical: "middle" };

  ws.mergeCells("C2:F2"); // ✅ Ajustado a 6 columnas
  ws.getCell("C2").value = "PRÉSTAMO";
  ws.getCell("C2").font = { bold: true, size: 14, color: { argb: PEACH.title } };
  ws.getCell("C2").alignment = { vertical: "middle" };

  // Left card: client/credit info
  const info: [string, string][] = [
    ["Cliente", data.header.usuario],
    ["Préstamo No.", data.header.numero_credito_sifco],
    ["Moneda", data.header.moneda],
    ["Tipo de crédito", data.header.tipo_credito],
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

  // ✅ Right card: Capital + Total a pagar + Con extras
  const saldoBase = toNum(data.header.saldo_total);
  const extrasTotal = toNum(data.header.extras_total);
  
  // Calcular total de costos de la tabla
  let totalCostos = 0;
  for (const it of data.cuotas_atrasadas.items) {
    const seguro = toNum((it as any).seguro ?? (data as any).header?.seguro_10_cuotas ?? 0);
    const gps = toNum((it as any).gps ?? (data as any).header?.gps ?? 0);
    const otros = toNum(it.otros ?? 0);
    totalCostos += seguro + gps + otros;
  }
  
  const totalAPagar = saldoBase + totalCostos;
  const totalConExtras = totalAPagar + extrasTotal;

  ws.mergeCells("F4:F4");
  ws.getCell("F4").value = "Capital";
  ws.getCell("F4").font = { bold: true, color: { argb: PEACH.slate } };
  ws.getCell("F4").alignment = { horizontal: "center" };

  ws.getCell("F5").value = saldoBase;
  ws.getCell("F5").numFmt = '"Q"#,##0.00';
  ws.getCell("F5").font = { bold: true, size: 14, color: { argb: PEACH.accent } };
  ws.getCell("F5").alignment = { horizontal: "center" };

  ws.mergeCells("F7:F7");
  ws.getCell("F7").value = "Total a pagar";
  ws.getCell("F7").font = { bold: true, color: { argb: PEACH.slate } };
  ws.getCell("F7").alignment = { horizontal: "center" };

  ws.getCell("F8").value = totalAPagar;
  ws.getCell("F8").numFmt = '"Q"#,##0.00';
  ws.getCell("F8").font = { bold: true, size: 14, color: { argb: "FFDC2626" } }; // rojo
  ws.getCell("F8").alignment = { horizontal: "center" };

  if (extrasTotal !== 0) {
    ws.mergeCells("F9:F9");
    ws.getCell("F9").value = "Con extras";
    ws.getCell("F9").font = { bold: true, color: { argb: PEACH.slate } };
    ws.getCell("F9").alignment = { horizontal: "center" };

    ws.getCell("F10").value = totalConExtras;
    ws.getCell("F10").numFmt = '"Q"#,##0.00';
    ws.getCell("F10").font = { bold: true, size: 14, color: { argb: "FF059669" } }; // verde
    ws.getCell("F10").alignment = { horizontal: "center" };
  }

  // ✅ Header row for the cost table - SIN columna de capital
  let row = 11;
  const head = ws.getRow(row);
  head.values = [
    "No.",
    "Mes",
    "Seguro",
    "GPS",
    "Otros",
    "Total a cancelar",
  ];
  styleHeaderRow(head);

  // Body rows
  if (data.cuotas_atrasadas.items.length === 0) {
    row++;
    ws.mergeCells(`A${row}:F${row}`); // ✅ 6 columnas
    ws.getCell(`A${row}`).value = "Sin cuotas atrasadas";
    ws.getCell(`A${row}`).alignment = { horizontal: "center" };
    ws.getCell(`A${row}`).font = { italic: true, color: { argb: PEACH.slate } };
  } else {
    let totalSeguro = 0;
    let totalGPS = 0;
    let totalOtros = 0;
    let totalCancelar = 0;

    for (const it of data.cuotas_atrasadas.items) {
      row++;

      const seguro = toNum((it as any).seguro ?? (data as any).header?.seguro_10_cuotas ?? 0);
      const gps = toNum((it as any).gps ?? (data as any).header?.gps ?? 0);
      const otros = toNum(it.otros ?? 0);
      
      // ✅ Total a cancelar = solo seguro + gps + otros
      const totalFila = seguro + gps + otros;

      totalSeguro += seguro;
      totalGPS += gps;
      totalOtros += otros;
      totalCancelar += totalFila;

      const rr = ws.getRow(row);
      rr.values = [
        it.no,
        it.mes,
        seguro,
        gps,
        otros,
        totalFila, // ✅ Solo costos
      ];

      // Currency format for numeric columns
      [3, 4, 5, 6].forEach((i) => (rr.getCell(i).numFmt = '"Q"#,##0.00'));
      rr.getCell(6).font = { bold: true, color: { argb: PEACH.accent } };

      // Zebra striping
      if (row % 2 === 0) {
        for (let c = 1; c <= 6; c++) {
          rr.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PEACH.zebra } };
        }
      }
      setThinBottomBorder(rr);
    }

    // ✅ Totals row
    row++;
    const totalRow = ws.getRow(row);
    totalRow.getCell(1).value = "TOTALES:";
    totalRow.getCell(1).font = { bold: true, color: { argb: PEACH.title } };
    totalRow.getCell(1).alignment = { horizontal: "right" };
    ws.mergeCells(`A${row}:B${row}`);
    
    totalRow.getCell(3).value = totalSeguro;
    totalRow.getCell(4).value = totalGPS;
    totalRow.getCell(5).value = totalOtros;
    totalRow.getCell(6).value = totalCancelar;
    
    [3, 4, 5, 6].forEach((i) => {
      totalRow.getCell(i).numFmt = '"Q"#,##0.00';
      totalRow.getCell(i).font = { bold: true, color: { argb: PEACH.accent } };
      totalRow.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE4D6" } };
    });
  }

  // ===== Montos adicionales (sección peach) =====
  row += 2;
  ws.mergeCells(`A${row}:F${row}`); // ✅ 6 columnas
  ws.getCell(`A${row}`).value = "Montos adicionales";
  ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: PEACH.title } };

  row++;
  const eHead = ws.getRow(row);
  eHead.values = ["#", "Concepto", "Monto", "Fecha", "", ""];
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
    ws.mergeCells(`A${row}:E${row}`); // ✅ Ajustado
    ws.getCell(`A${row}`).value = "Total extras:";
    ws.getCell(`A${row}`).alignment = { horizontal: "right" };
    ws.getCell(`A${row}`).font = { bold: true, color: { argb: PEACH.slate } };

    ws.getCell(`F${row}`).value = extrasTotal;
    ws.getCell(`F${row}`).numFmt = '"Q"#,##0.00';
    ws.getCell(`F${row}`).font = { bold: true, color: { argb: PEACH.accent } };
  } else {
    row++;
    ws.mergeCells(`A${row}:F${row}`); // ✅ 6 columnas
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
  const saldoBase = Number(data.header.saldo_total || 0);
  const extrasTotal = Number(data.header.extras_total || 0);

  // ✅ Totales de la tabla (solo costos: seguro + gps + otros)
  const totales = data.cuotas_atrasadas.items.reduce(
    (acc, r) => {
      const seguro = Number((r as any).seguro ?? (data as any).header?.seguro_10_cuotas ?? 0);
      const gps = Number((r as any).gps ?? (data as any).header?.gps ?? 0);
      const otros = Number(r.otros ?? 0);
      
      // ✅ Total a cancelar de esta fila = solo seguro + gps + otros
      const totalFila = seguro + gps + otros;

      return {
        seguro: acc.seguro + seguro,
        gps: acc.gps + gps,
        otros: acc.otros + otros,
        total_cancelar: acc.total_cancelar + totalFila,
      };
    },
    {
      seguro: 0,
      gps: 0,
      otros: 0,
      total_cancelar: 0,
    }
  );

  // ✅ Total a pagar = Capital + Total de costos
  const totalAPagar = saldoBase + totales.total_cancelar;
  const totalConExtras = totalAPagar + extrasTotal;

  // ✅ Filas de la tabla
  const rows = data.cuotas_atrasadas.items.map((r) => {
    const seguro = Number((r as any).seguro ?? (data as any).header?.seguro_10_cuotas ?? 0);
    const gps = Number((r as any).gps ?? (data as any).header?.gps ?? 0);
    const otros = Number(r.otros ?? 0);
    
    // ✅ Total de esta fila = solo seguro + gps + otros
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

  // ✅ Fila de totales
  const totalesRow = `
    <tr class="totales-row">
      <td colspan="2" style="text-align:right;font-weight:700;background:#FFE4D6;color:#D86B3A;">TOTALES:</td>
      <td style="font-weight:700;background:#FFE4D6;">${gtq(totales.seguro)}</td>
      <td style="font-weight:700;background:#FFE4D6;">${gtq(totales.gps)}</td>
      <td style="font-weight:700;background:#FFE4D6;">${gtq(totales.otros)}</td>
      <td class="total" style="font-weight:800;background:#FFE4D6;font-size:14px;">${gtq(totales.total_cancelar)}</td>
    </tr>
  `;

  const empty = `<tr><td colspan="6" class="tbl-note">Sin cuotas atrasadas</td></tr>`;

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
        <div class="extras-total">Total extras: <strong>${gtq(extrasTotal)}</strong></div>
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
      <small>Capital</small>
      <div class="num">${gtq(saldoBase)}</div>
      <div style="border-top:2px solid var(--line);margin:8px 0;"></div>
      <small>Total a pagar</small>
      <div class="num" style="color:#dc2626;">${gtq(totalAPagar)}</div>
      ${
        extrasTotal !== 0
          ? `<div style="border-top:2px solid var(--line);margin:8px 0;"></div>
             <small>Con extras</small>
             <div class="num" style="color:#059669;">${gtq(totalConExtras)}</div>`
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
      <th>Seguro</th>
      <th>GPS</th>
      <th>Otros</th>
      <th>Total a cancelar</th>
    </tr>
  </thead>
  <tbody>
    ${rows || empty}
    ${data.cuotas_atrasadas.items.length ? totalesRow : ""}
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