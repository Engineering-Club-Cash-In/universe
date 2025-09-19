import { generarHTMLReporte } from "../../controllers/investor";
import { GetCreditDTO, InversionistaReporte } from "../interface";
import puppeteer from "puppeteer";
import ExcelJS from "exceljs";
import axios from "axios";
// Tipos auxiliares


export async function generarPDFBuffer(
  inversionista: InversionistaReporte,
  logoUrl: string = ""
): Promise<Buffer> {
  const html = generarHTMLReporte(inversionista, logoUrl);
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdfData = await page.pdf({
    format: "A4",
    landscape: true,
    printBackground: true,
    margin: { top: 20, bottom: 20, left: 12, right: 12 },
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
                      <td>${e.fecha_registro ? String(e.fecha_registro).slice(0, 10) : "-"}</td>
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

/** ───────── helpers num/estilo ───────── */
function toNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  // quita "Q", comas y espacios
  const cleaned = String(v).replace(/[Qq,\s,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

const COLOR = {
  navy: "FF0F1B4C",
  blue: "FF0F56D9",
  text: "FF0F172A",
  slate: "FF334155",
  cardBg: "FFF0F6FF",
  headRow: "FF0F1B4C",
  white: "FFFFFFFF",
  line: "FFE5E7EB",
  zebra: "FFF9FBFF",
};

function styleHeaderRow(row: ExcelJS.Row) {
  for (let i = 1; i <= 8; i++) {
    const c = row.getCell(i);
    c.font = { bold: true, color: { argb: COLOR.white } };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.headRow },
    };
    c.alignment = { horizontal: "center" };
  }
}

function setThinBottomBorder(row: ExcelJS.Row, argb = COLOR.line) {
  row.eachCell((cell) => {
    cell.border = {
      ...(cell.border ?? {}),
      bottom: { style: "thin", color: { argb } },
    };
  });
}

/** pinta “tarjeta” sin merges (evita Cannot merge already merged cells) */
function paintCard(ws: ExcelJS.Worksheet, range: string) {
  const [a, b] = range.split(":");
  const start = ws.getCell(a);
  const end = ws.getCell(b);
  for (let r = Number(start.row); r <= Number(end.row); r++) {
    for (let c = Number(start.col); c <= Number(end.col); c++) {
      const cell = ws.getCell(r, c);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.cardBg },
      };
      cell.border = {
        top: { style: "thin", color: { argb: COLOR.line } },
        left: { style: "thin", color: { argb: COLOR.line } },
        bottom: { style: "thin", color: { argb: COLOR.line } },
        right: { style: "thin", color: { argb: COLOR.line } },
      };
    }
  }
}

/** trae imagen como base64 (evita tipos de Buffer) */
async function fetchImageBase64(
  url?: string
): Promise<{ data: string; ext: "png" | "jpeg" } | null> {
  if (!url) return null;
  try {
    const res = await axios.get(url, { responseType: "arraybuffer" });
    // infiere extensión simple
    const ct = String(res.headers["content-type"] || "");
    const ext: "png" | "jpeg" = ct.includes("png") ? "png" : "jpeg";
    const b64 = Buffer.from(res.data).toString("base64");
    return { data: b64, ext };
  } catch {
    return null;
  }
}

/** ───────── builder principal ───────── */
export async function buildCancelationWorkbook(
  data: GetCreditDTO,
  opts?: { logoUrl?: string }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Club Cashin.com";
  wb.created = new Date();

  const ws = wb.addWorksheet("Cancelación", {
    properties: { defaultRowHeight: 18 },
  });
  // anchos buscando similitud al PDF
  [8, 18, 14, 14, 14, 12, 24, 18].forEach(
    (w, i) => (ws.getColumn(i + 1).width = w)
  );

  // ── fila 1-2: logo + títulos
  const logo = await fetchImageBase64(opts?.logoUrl);
  if (logo) {
    const imgId = wb.addImage({ base64: logo.data, extension: logo.ext });
    // ocupa A1:B2 (no es merge real; addImage posiciona sobre ese rango)
    ws.addImage(imgId, 'A1:B2');
  }

  ws.mergeCells("C1:H1");
  ws.getCell("C1").value = "DETALLE DE CANCELACIÓN";
  ws.getCell("C1").font = {
    bold: true,
    size: 12,
    color: { argb: COLOR.slate },
  };
  ws.getCell("C1").alignment = { vertical: "middle" };

  ws.mergeCells("C2:H2");
  ws.getCell("C2").value = "PRÉSTAMO";
  ws.getCell("C2").font = { bold: true, size: 14, color: { argb: COLOR.navy } };
  ws.getCell("C2").alignment = { vertical: "middle" };

  // ── tarjetas (sin merges grandes; solo pintamos el bloque)
  paintCard(ws, "A3:D9");
  paintCard(ws, "E3:H9");

  // tarjeta izquierda: info
  const info: [string, string][] = [
    ["Cliente", data.header.usuario],
    ["Préstamo No.", data.header.numero_credito_sifco],
    ["Moneda", data.header.moneda],
    ["Tipo de crédito", data.header.tipo_credito],
    ["Observaciones", data.header.observaciones || "-"],
  ];
  let r = 4;
  for (const [k, v] of info) {
    ws.getCell(`A${r}`).value = k;
    ws.getCell(`A${r}`).font = { bold: true, color: { argb: COLOR.slate } };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value = v;
    r++;
  }

  // tarjeta derecha: saldos
  ws.getCell("E5").value = "Saldo total";
  ws.getCell("E5").font = { bold: true, color: { argb: COLOR.slate } };
  ws.mergeCells("F5:H5");
  ws.getCell("F5").value = toNum(data.header.saldo_total);
  ws.getCell("F5").numFmt = '"Q"#,##0.00';
  ws.getCell("F5").font = { bold: true, size: 14, color: { argb: COLOR.blue } };

  if (toNum(data.header.extras_total) !== 0) {
    ws.getCell("E7").value = "Con extras";
    ws.getCell("E7").font = { bold: true, color: { argb: COLOR.slate } };
    ws.mergeCells("F7:H7");
    ws.getCell("F7").value = toNum(data.header.saldo_total_con_extras);
    ws.getCell("F7").numFmt = '"Q"#,##0.00';
    ws.getCell("F7").font = {
      bold: true,
      size: 14,
      color: { argb: COLOR.blue },
    };
  }

  // ── tabla cuotas atrasadas
  let row = 11;
  const head = ws.getRow(row);
  head.values = [
    "No.",
    "Mes",
    "Interés",
    "Servicios",
    "Mora",
    "OTROS",
    "Capital pendiente de pago",
    "Total a cancelar",
  ];
  styleHeaderRow(head);

  if (data.cuotas_atrasadas.items.length === 0) {
    row++;
    ws.mergeCells(`A${row}:H${row}`);
    ws.getCell(`A${row}`).value = "Sin cuotas atrasadas";
    ws.getCell(`A${row}`).alignment = { horizontal: "center" };
    ws.getCell(`A${row}`).font = { italic: true, color: { argb: "FF7C8591" } };
  } else {
    for (const it of data.cuotas_atrasadas.items) {
      row++;
      const rr = ws.getRow(row);
      rr.values = [
        it.no,
        it.mes,
        toNum(it.interes),
        toNum(it.servicios),
        toNum(it.mora),
        toNum(it.otros),
        toNum(it.capital_pendiente),
        toNum(it.total_cancelar),
      ];
      [3, 4, 5, 6, 7, 8].forEach((i) => (rr.getCell(i).numFmt = '"Q"#,##0.00'));
      rr.getCell(8).font = { bold: true, color: { argb: COLOR.blue } };
      if (row % 2 === 0) {
        for (let c = 1; c <= 8; c++) {
          rr.getCell(c).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLOR.zebra },
          };
        }
      }
      setThinBottomBorder(rr);
    }
  }

  // congelar encabezado hasta la fila de header de tabla
  ws.views = [{ state: "frozen", ySplit: 11 }];

  // ── sección extras
  row += 2;
  ws.mergeCells(`A${row}:H${row}`);
  ws.getCell(`A${row}`).value = "Montos adicionales";
  ws.getCell(`A${row}`).font = {
    bold: true,
    size: 12,
    color: { argb: COLOR.navy },
  };

  row++;
  const eHead = ws.getRow(row);
  eHead.values = ["#", "Concepto", "Monto", "Fecha", "", "", "", ""];
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
    ws.mergeCells(`A${row}:G${row}`);
    ws.getCell(`A${row}`).value = "Total extras:";
    ws.getCell(`A${row}`).alignment = { horizontal: "right" };
    ws.getCell(`A${row}`).font = { bold: true, color: { argb: COLOR.navy } };

    ws.getCell(`H${row}`).value = toNum(data.header.extras_total);
    ws.getCell(`H${row}`).numFmt = '"Q"#,##0.00';
    ws.getCell(`H${row}`).font = { bold: true, color: { argb: COLOR.blue } };
  } else {
    row++;
    ws.mergeCells(`A${row}:H${row}`);
    ws.getCell(`A${row}`).value = "Sin extras registrados";
    ws.getCell(`A${row}`).alignment = { horizontal: "center" };
    ws.getCell(`A${row}`).font = { italic: true, color: { argb: "FF7C8591" } };
  }

  // buffer XLSX
  const arr = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return Buffer.from(arr); // Node Buffer
}
