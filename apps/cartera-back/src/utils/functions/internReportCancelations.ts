// --- builder_detallado_verde.ts ---
import ExcelJS from "exceljs";
import Big from "big.js";
import { GetCreditDTO } from "../interface";
import axios from "axios";

/** Safe number parser for strings like "Q1,915.15" or numbers */
function toNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[Qq,\s,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Color palette (green-ish, as in the screenshot) */
const GREEN = {
  title:    "FF2F6B2F", // dark green title
  header:   "FF5B8C5B", // header row
  accent:   "FF2E7D32", // strong green (numbers)
  zebra:    "FFF2FFF2", // very light green row
  border:   "FFB7D3B7",
  white:    "FFFFFFFF",
  text:     "FF0F172A",
};

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: GREEN.white } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN.header } };
    cell.border = {
      top:    { style: "thin", color: { argb: GREEN.border } },
      left:   { style: "thin", color: { argb: GREEN.border } },
      bottom: { style: "thin", color: { argb: GREEN.border } },
      right:  { style: "thin", color: { argb: GREEN.border } },
    };
  });
}

function setThinBottomBorder(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.border = {
      ...(cell.border ?? {}),
      bottom: { style: "thin", color: { argb: GREEN.border } },
    };
  });
}

/**
 * Build detailed cancelation workbook (green theme).
 * Columns:
 *  No. | Mes | Interés | Seguro | GPS | Membresía | Mora | OTROS | Capital pendiente de pago | Total a cancelar
 */
export async function buildCancelationWorkbookDetailedGreen(
  data: GetCreditDTO,
  opts?: { logoBase64?: { data: string; ext: "png" | "jpeg" } | null }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Club Cash In";
  wb.created = new Date();

  const ws = wb.addWorksheet("Cancelación detallada", {
    properties: { defaultRowHeight: 18 },
    views: [{ state: "frozen", ySplit: 11 }],
  });

  // Column widths tuned to screenshot layout
  [7, 12, 12, 12, 12, 12, 12, 12, 24, 16].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // Optional logo at A1:B2
  if (opts?.logoBase64) {
    const imgId = wb.addImage({ base64: opts.logoBase64.data, extension: opts.logoBase64.ext });
    ws.addImage(imgId, "A1:B2");
  }

  // Titles
  ws.mergeCells("C1:J1");
  ws.getCell("C1").value = "DETALLE DE CANCELACIÓN";
  ws.getCell("C1").font = { bold: true, size: 16, color: { argb: GREEN.title } };
  ws.getCell("C1").alignment = { vertical: "middle" };

  ws.mergeCells("C2:J2");
  ws.getCell("C2").value = "PRÉSTAMO";
  ws.getCell("C2").font = { bold: true, size: 14, color: { argb: GREEN.title } };
  ws.getCell("C2").alignment = { vertical: "middle" };

  // Card: client/credit info (rows 4..8)
  const info: [string, string][] = [
    ["Cliente", data.header.usuario],
    ["Préstamo No.", data.header.numero_credito_sifco],
    ["Moneda", data.header.moneda],
    ["Tipo de crédito", data.header.tipo_credito],
    ["Observaciones", data.header.observaciones || "-"],
  ];

  let r = 4;
  for (const [k, v] of info) {
    ws.mergeCells(`A${r}:B${r}`);
    ws.getCell(`A${r}`).value = k;
    ws.getCell(`A${r}`).font = { bold: true, color: { argb: GREEN.title } };

    ws.mergeCells(`C${r}:G${r}`);
    ws.getCell(`C${r}`).value = v;
    r++;
  }

  // Card: saldo (right)
  ws.mergeCells("H4:J4");
  ws.getCell("H4").value = "Saldo total";
  ws.getCell("H4").font = { bold: true, color: { argb: GREEN.title } };

  ws.mergeCells("H5:J5");
  ws.getCell("H5").value = toNum(data.header.saldo_total);
  ws.getCell("H5").numFmt = '"Q"#,##0.00';
  ws.getCell("H5").font = { bold: true, size: 14, color: { argb: GREEN.accent } };

  if (toNum(data.header.extras_total) !== 0) {
    ws.mergeCells("H7:J7");
    ws.getCell("H7").value = "Con extras";
    ws.getCell("H7").font = { bold: true, color: { argb: GREEN.title } };

    ws.mergeCells("H8:J8");
    ws.getCell("H8").value = toNum(data.header.saldo_total_con_extras);
    ws.getCell("H8").numFmt = '"Q"#,##0.00';
    ws.getCell("H8").font = { bold: true, size: 14, color: { argb: GREEN.accent } };
  }

  // Header row for the detailed table
  let row = 11;
  const head = ws.getRow(row);
  head.values = [
    "No.",
    "Mes",
    "Interés",
    "Seguro",
    "GPS",
    "Membresía",
    "Mora",
    "OTROS",
    "Capital pendiente de pago",
    "Total a cancelar",
  ];
  styleHeaderRow(head);

  // Render rows (calculate per-row components explicitly)
  if (data.cuotas_atrasadas.items.length === 0) {
    row++;
    ws.mergeCells(`A${row}:J${row}`);
    ws.getCell(`A${row}`).value = "Sin cuotas atrasadas";
    ws.getCell(`A${row}`).alignment = { horizontal: "center" };
    ws.getCell(`A${row}`).font = { italic: true, color: { argb: GREEN.title } };
  } else {
    let totalSum = 0;

    for (const it of data.cuotas_atrasadas.items) {
      row++;

      // Per-row numeric parts (assumes per-installment amounts in DTO)
      const interes   = new Big(it.interes);
      const seguro    = new Big(data.header ? (data.header as any) : 0) && new Big((data as any).header) ? new Big(0) : new Big(0); // placeholder to avoid TS complain
      // Take seguro/gps/membresía directamente desde cada item si los agregas a tu DTO:
      // Como tu DTO actual trae `gps` y puso `servicios` (seguro+membresía+gps),
      // aquí derivamos explícitamente de r.credit.* en la construcción del DTO:
      const _seguro    = new Big((it as any).seguro ?? (data as any).header?.seguro_10_cuotas ?? 0);
      const _gps       = new Big((it as any).gps ?? 0);
      const _membresia = new Big((it as any).membresia ?? (data as any).header?.membresias_pago ?? 0);
      const mora       = new Big(it.mora);
      const otros      = new Big(it.otros);
      const capital    = new Big(it.capital_pendiente);

      // Correct total: interest + seguro + gps + membresía + mora + otros
      const total = interes.plus(_seguro).plus(_gps).plus(_membresia).plus(mora).plus(otros);
      totalSum += Number(total.toString());

      const rr = ws.getRow(row);
      rr.values = [
        it.no,
        it.mes,
        Number(interes.toString()),
        Number(_seguro.toString()),
        Number(_gps.toString()),
        Number(_membresia.toString()),
        Number(mora.toString()),
        Number(otros.toString()),
        Number(capital.toString()),
        Number(total.toString()),
      ];

      // Currency format columns 3..10
      for (let i = 3; i <= 10; i++) rr.getCell(i).numFmt = '"Q"#,##0.00';
      rr.getCell(10).font = { bold: true, color: { argb: GREEN.accent } };

      // Zebra striping
      if (row % 2 === 0) {
        for (let c = 1; c <= 10; c++) {
          rr.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN.zebra } };
        }
      }
      setThinBottomBorder(rr);
    }

    // Totals row
    row++;
    ws.mergeCells(`A${row}:I${row}`);
    ws.getCell(`A${row}`).value = "Total a cancelar (cuotas atrasadas):";
    ws.getCell(`A${row}`).alignment = { horizontal: "right" };
    ws.getCell(`A${row}`).font = { bold: true, color: { argb: GREEN.title } };

    ws.getCell(`J${row}`).value = totalSum;
    ws.getCell(`J${row}`).numFmt = '"Q"#,##0.00';
    ws.getCell(`J${row}`).font = { bold: true, color: { argb: GREEN.accent } };
  }

  // Extras section (keep it in case you want it in this report, still green-styled)
  row += 2;
  ws.mergeCells(`A${row}:J${row}`);
  ws.getCell(`A${row}`).value = "Montos adicionales";
  ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: GREEN.title } };

  row++;
  const eHead = ws.getRow(row);
  eHead.values = ["#", "Concepto", "Monto", "Fecha", "", "", "", "", "", ""];
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
    ws.mergeCells(`A${row}:I${row}`);
    ws.getCell(`A${row}`).value = "Total extras:";
    ws.getCell(`A${row}`).alignment = { horizontal: "right" };
    ws.getCell(`A${row}`).font = { bold: true, color: { argb: GREEN.title } };

    ws.getCell(`J${row}`).value = toNum(data.header.extras_total);
    ws.getCell(`J${row}`).numFmt = '"Q"#,##0.00';
    ws.getCell(`J${row}`).font = { bold: true, color: { argb: GREEN.accent } };
  } else {
    row++;
    ws.mergeCells(`A${row}:J${row}`);
    ws.getCell(`A${row}`).value = "Sin extras registrados";
    ws.getCell(`A${row}`).alignment = { horizontal: "center" };
    ws.getCell(`A${row}`).font = { italic: true, color: { argb: GREEN.title } };
  }

  const arr = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return Buffer.from(arr);
}


/** Fetch logo as base64 to embed into Excel (optional) */
export async function fetchImageBase64(url?: string): Promise<{ data: string; ext: "png" | "jpeg" } | null> {
  if (!url) return null;
  try {
    const res = await axios.get(url, { responseType: "arraybuffer" });
    const ct = String(res.headers["content-type"] || "");
    const ext: "png" | "jpeg" = ct.includes("png") ? "png" : "jpeg";
    const b64 = Buffer.from(res.data).toString("base64");
    return { data: `data:image/${ext};base64,${b64}`, ext };
  } catch {
    return null;
  }
}

// Sustituye tu render actual por este (mismo nombre si quieres reemplazar):
export function renderCancelationHTMLDetailedGreen(data: GetCreditDTO, logoUrl: string) {
  // rows con columnas desglosadas; usamos fallback por si tu DTO aún no trae seguro/gps/membresía en cada item
  const rows = data.cuotas_atrasadas.items
    .map((r) => {
      const seguro     = (r as any).seguro ?? (data as any).header?.seguro_10_cuotas ?? 0;
      const gps        = (r as any).gps ?? (data as any).header?.gps ?? 0;
      const membresia  = (r as any).membresia ?? (data as any).header?.membresias_pago ?? 0;

      return `
      <tr>
        <td>${r.no}</td>
        <td>${r.mes}</td>
        <td>${gtq(r.interes)}</td>
        <td>${gtq(seguro)}</td>
        <td>${gtq(gps)}</td>
        <td>${gtq(membresia)}</td>
        <td>${gtq(r.mora)}</td>
        <td>${gtq(r.otros)}</td>
        <td>${gtq(r.capital_pendiente)}</td>
        <td class="total">${gtq(r.total_cancelar)}</td>
      </tr>`;
    })
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
                      <td>${e.fecha_registro ? String(e.fecha_registro).slice(0, 10) : "-"}</td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
          <div class="extras-total">
            Total extras: <strong>${gtq(data.header.extras_total)}</strong>
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
  /* ======== Paleta verde (manteniendo el mismo layout) ======== */
  :root{
    --navy:#2F6B2F;        /* títulos */
    --green:#2E7D32;       /* acentos */
    --head:#5B8C5B;        /* thead */
    --text:#0F172A;
    --slate:#334155;
    --card:#F2FFF2;        /* fondos claros */
    --line:#B7D3B7;        /* bordes */
    --white:#FFFFFF;
    --zebra:#F7FFF7;
  }

  * { box-sizing: border-box; font-family: "Inter", Arial, sans-serif; }
  body { color:var(--text); margin:0; padding:20px; }

  .header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .brand img { height:40px; }
  .title { text-align:center; margin:10px 0 12px; }
  .title h1 { margin:0; font-size:24px; letter-spacing:1px; color:var(--navy); }
  .title h2 { margin:2px 0 0; font-size:20px; color:var(--navy); font-weight:700; }

  .summary { display:grid; grid-template-columns: 1fr 240px; gap:18px; margin:10px 0 18px; }
  .box { border:1.8px solid var(--line); border-radius:8px; padding:14px; background:var(--card); }
  .left dl { margin:0; display:grid; grid-template-columns:160px 1fr; row-gap:8px; column-gap:8px; }
  dl dt { color:var(--slate); font-weight:600; }
  dl dd { margin:0; color:var(--text); }

  .saldo { display:flex; align-items:center; justify-content:center; height:100%; }
  .saldo .num { font-size:22px; color:var(--green); font-weight:800; }
  .saldo small { display:block; color:#64748b; font-weight:600; }

  table { width:100%; border-collapse:collapse; margin:10px 0; }
  thead th { background:var(--head); color:var(--white); font-weight:700; padding:8px; font-size:12px; }
  tbody td { padding:8px; border:1px solid var(--line); font-size:12px; }
  tbody tr:nth-child(even) td { background:var(--zebra); }
  td.total { font-weight:800; color:var(--green); }

  .tbl-note { text-align:center; color:#7c8591; padding:10px 0; }

  .extras h3 { margin:16px 0 8px; color:var(--navy); }
  .extras-total { margin-top:6px; text-align:right; color:var(--navy); }

  .foot { display:flex; justify-content:space-between; margin-top:10px; font-size:11px; color:#64748b; }
</style>
</head>
<body>

<div class="header">
  <div class="brand">
    ${logoUrl ? `<img src="${logoUrl}" alt="logo" />` : ""}
    <div>
      <div style="font-size:12px;color:#64748b;">DETALLE DE CANCELACIÓN</div>
      <div style="font-size:14px;font-weight:700;color:var(--navy);">PRÉSTAMO</div>
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
      <div class="num">${gtq(data.header.saldo_total)}</div>
      ${
        Number(String(data.header.extras_total).replace(/[Qq,\s,]/g, "")) !== 0
          ? `<small style="display:block;margin-top:6px;">Con extras</small>
             <div class="num">${gtq(data.header.saldo_total_con_extras)}</div>`
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
      <th>Seguro</th>
      <th>GPS</th>
      <th>Membresía</th>
      <th>Mora</th>
      <th>OTROS</th>
      <th>Capital pendiente de pago</th>
      <th>Total a cancelar</th>
    </tr>
  </thead>
  <tbody>
    ${
      rows ||
      `<tr><td colspan="10" class="tbl-note">Sin cuotas atrasadas</td></tr>`
    }
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

function gtq(v: string | number | null | undefined): string {
  if (v == null) return "Q0.00";
  const n = typeof v === "number" ? v : Number(String(v).replace(/[Qq,\s,]/g, ""));
  if (!Number.isFinite(n)) return "Q0.00";
  return "Q" + n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}