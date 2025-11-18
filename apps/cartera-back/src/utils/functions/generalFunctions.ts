import { generarHTMLReporte } from "../../controllers/investor";
import { GetCreditDTO, InversionistaReporte } from "../interface";
import puppeteer from "puppeteer";
import ExcelJS from "exceljs";
import axios from "axios";
import Big from "big.js";
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
  // ✅ Asegurar que sean números
  const saldoBase = Number(data.header.saldo_total || 0);
  const extrasTotal = Number(data.header.extras_total || 0);
  const saldoConExtras = Number(data.header.saldo_total_con_extras || 0);

  // ✅ Calcular totales de cada columna
  const totales = data.cuotas_atrasadas.items.reduce(
    (acc, r) => ({
      interes: acc.interes + Number(r.interes || 0),
      servicios: acc.servicios + Number(r.servicios || 0),
      mora: acc.mora + Number(r.mora || 0),
      otros: acc.otros + Number(r.otros || 0),
      capital_pendiente: acc.capital_pendiente + Number(r.capital_pendiente || 0),
      total_cancelar: acc.total_cancelar + Number(r.total_cancelar || 0),
    }),
    {
      interes: 0,
      servicios: 0,
      mora: 0,
      otros: 0,
      capital_pendiente: 0,
      total_cancelar: 0,
    }
  );

  // ✅ Total a pagar = Capital + Total de la tabla (asegurando números)
  const totalAPagar = Number(saldoBase) + Number(totales.total_cancelar);
  
  // ✅ Con extras
  const totalConExtras = Number(totalAPagar) + Number(extrasTotal);

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

  // ✅ Fila de totales
  const totalesRow = `
    <tr class="totales-row">
      <td colspan="2" style="text-align:right;font-weight:700;background:#e0f2fe;color:#0F1B4C;">TOTALES:</td>
      <td style="font-weight:700;background:#e0f2fe;">${gtq(totales.interes)}</td>
      <td style="font-weight:700;background:#e0f2fe;">${gtq(totales.servicios)}</td>
      <td style="font-weight:700;background:#e0f2fe;">${gtq(totales.mora)}</td>
      <td style="font-weight:700;background:#e0f2fe;">${gtq(totales.otros)}</td>
      <td style="font-weight:700;background:#e0f2fe;">${gtq(totales.capital_pendiente)}</td>
      <td class="total" style="font-weight:800;background:#e0f2fe;font-size:14px;">${gtq(totales.total_cancelar)}</td>
    </tr>
  `;

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
  .saldo small { display:block; color:#64748b; font-weight:600; margin-bottom:4px; }

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
    <div style="text-align:center;">
      <small>Capital</small>
      <div class="num">${gtq(saldoBase)}</div>
      <div style="border-top:2px solid #cbd5e1;margin:8px 0;"></div>
      <small>Total a pagar</small>
      <div class="num" style="color:#dc2626;">${gtq(totalAPagar)}</div>
      ${
        extrasTotal !== 0
          ? `<div style="border-top:2px solid #cbd5e1;margin:8px 0;"></div>
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
    ${totalesRow}
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

  // ✅ tarjeta derecha: Capital + Total a pagar + Con extras
  const saldoBase = toNum(data.header.saldo_total);
  const extrasTotal = toNum(data.header.extras_total);
  
  // Calcular total de la tabla
  let totalTabla = 0;
  for (const it of data.cuotas_atrasadas.items) {
    totalTabla += toNum(it.total_cancelar ?? 0);
  }
  
  const totalAPagar = saldoBase + totalTabla;
  const totalConExtras = totalAPagar + extrasTotal;

  ws.getCell("E4").value = "Capital";
  ws.getCell("E4").font = { bold: true, color: { argb: COLOR.slate } };
  ws.getCell("E4").alignment = { horizontal: "center" };
  ws.mergeCells("F4:H4");
  ws.getCell("F4").value = saldoBase;
  ws.getCell("F4").numFmt = '"Q"#,##0.00';
  ws.getCell("F4").font = { bold: true, size: 14, color: { argb: COLOR.blue } };
  ws.getCell("F4").alignment = { horizontal: "center" };

  ws.getCell("E5").value = "Total a pagar";
  ws.getCell("E5").font = { bold: true, color: { argb: COLOR.slate } };
  ws.getCell("E5").alignment = { horizontal: "center" };
  ws.mergeCells("F5:H5");
  ws.getCell("F5").value = totalAPagar;
  ws.getCell("F5").numFmt = '"Q"#,##0.00';
  ws.getCell("F5").font = { bold: true, size: 14, color: { argb: "FFDC2626" } }; // rojo
  ws.getCell("F5").alignment = { horizontal: "center" };

  if (extrasTotal !== 0) {
    ws.getCell("E7").value = "Con extras";
    ws.getCell("E7").font = { bold: true, color: { argb: COLOR.slate } };
    ws.getCell("E7").alignment = { horizontal: "center" };
    ws.mergeCells("F7:H7");
    ws.getCell("F7").value = totalConExtras;
    ws.getCell("F7").numFmt = '"Q"#,##0.00';
    ws.getCell("F7").font = {
      bold: true,
      size: 14,
      color: { argb: "FF059669" }, // verde
    };
    ws.getCell("F7").alignment = { horizontal: "center" };
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
    // ✅ Calcular totales
    let totales = {
      interes: 0,
      servicios: 0,
      mora: 0,
      otros: 0,
      capital_pendiente: 0,
      total_cancelar: 0,
    };

    for (const it of data.cuotas_atrasadas.items) {
      row++;
      
      const interes = toNum(it.interes);
      const servicios = toNum(it.servicios);
      const mora = toNum(it.mora);
      const otros = toNum(it.otros);
      const capital = toNum(it.capital_pendiente);
      const total = toNum(it.total_cancelar);

      totales.interes += interes;
      totales.servicios += servicios;
      totales.mora += mora;
      totales.otros += otros;
      totales.capital_pendiente += capital;
      totales.total_cancelar += total;

      const rr = ws.getRow(row);
      rr.values = [
        it.no,
        it.mes,
        interes,
        servicios,
        mora,
        otros,
        capital,
        total,
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

    // ✅ Fila de totales
    row++;
    const totalRow = ws.getRow(row);
    totalRow.getCell(1).value = "TOTALES:";
    totalRow.getCell(1).font = { bold: true, color: { argb: COLOR.navy } };
    totalRow.getCell(1).alignment = { horizontal: "right" };
    ws.mergeCells(`A${row}:B${row}`);

    totalRow.getCell(3).value = totales.interes;
    totalRow.getCell(4).value = totales.servicios;
    totalRow.getCell(5).value = totales.mora;
    totalRow.getCell(6).value = totales.otros;
    totalRow.getCell(7).value = totales.capital_pendiente;
    totalRow.getCell(8).value = totales.total_cancelar;

    [3, 4, 5, 6, 7, 8].forEach((i) => {
      totalRow.getCell(i).numFmt = '"Q"#,##0.00';
      totalRow.getCell(i).font = { bold: true, color: { argb: COLOR.blue } };
      totalRow.getCell(i).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0F2FE" }, // azul claro
      };
    });
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

    ws.getCell(`H${row}`).value = extrasTotal;
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
  return Buffer.from(arr);
}
/**
 * Convierte un string o número en Big, limpiando %, Q, comas y guiones
 * @param value valor original
 * @param fallback valor por defecto si está vacío o inválido
 */
export function toBigExcel(value: any, fallback: string | number = "0"): Big {
  if (value == null) return new Big(fallback);

  let str = String(value).trim();

  if (!str || str === "-" || str.toLowerCase() === "nan") {
    return new Big(fallback);
  }

  // quitar prefijo Q si lo hubiera
  str = str.replace(/^Q/i, "");
  // quitar %
  str = str.replace(/%/g, "");
  // quitar separadores de miles
  str = str.replace(/,/g, "");

  // si al final no es numérico, usa fallback
  if (!str || isNaN(Number(str))) {
    return new Big(fallback);
  }

  return new Big(str);
}