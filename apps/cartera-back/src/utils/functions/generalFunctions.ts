import { generarHTMLReporte } from "../../controllers/investor";
import { GetCreditDTO, InversionistaReporte } from "../interface";
import puppeteer from "puppeteer";
import ExcelJS from "exceljs";
import axios from "axios";
import Big from "big.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { sql, type SQL } from "drizzle-orm";
// Tipos auxiliares

/**
 * Quita tildes/acentos de un string.
 * Ej: "José María" → "Jose Maria"
 */
export function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Fragmento SQL reutilizable para quitar acentos en PostgreSQL usando translate().
 * Uso: sql`${TRANSLATE_ACCENTS(column)} ILIKE ${searchTerm}`
 * Nota: el searchTerm debe pasar por removeAccents() antes.
 */
export const SQL_UNACCENT = `translate(lower(COLUMN), 'áéíóúàèìòùäëïöüâêîôûãõñÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÃÕÑ', 'aeiouaeiouaeiouaeiouaonAEIOUAEIOUAEIOUAEIOUAON')`;

/**
 * Construye un filtro SQL para búsqueda de nombres tolerante a:
 * - Acentos/tildes (Óscar = Oscar)
 * - Mayúsculas/minúsculas
 * - Espacios extra entre palabras
 * - Orden de palabras (cada token puede aparecer en cualquier posición)
 *
 * Ej: term "Oscar Alf" hace match con "Óscar Alfredo Méndez" porque divide
 * la búsqueda en tokens ["oscar", "alf"] y exige que TODOS aparezcan en la
 * columna (ya normalizada sin acentos y en minúsculas).
 *
 * @param column Columna o expresión SQL sobre la que buscar (ej: usuarios.nombre o sql`u.nombre`)
 * @param term Texto de búsqueda del usuario
 * @returns SQL con el filtro, o undefined si el término queda vacío
 */
export function buildNameSearchCondition(
  column: unknown,
  term: string | undefined | null
): SQL | undefined {
  if (!term) return undefined;
  const normalized = removeAccents(term).toLowerCase().trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  const tokens = normalized.split(" ").filter((t) => t.length > 0);
  if (tokens.length === 0) return undefined;

  const ACCENTS_FROM = "áéíóúàèìòùäëïöüâêîôûãõñÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÃÕÑ";
  const ACCENTS_TO = "aeiouaeiouaeiouaeiouaonAEIOUAEIOUAEIOUAEIOUAON";

  // Aplicamos translate ANTES de lower: así, aunque el locale del Postgres no
  // foldee mayúsculas acentuadas (ej. 'Ó' → 'ó'), translate ya las convirtió
  // a ASCII y lower() funciona sobre puro ASCII.
  const tokenConds = tokens.map(
    (t) =>
      sql`lower(translate(${column as any}, ${ACCENTS_FROM}, ${ACCENTS_TO})) LIKE ${"%" + t + "%"}`
  );

  return sql.join(tokenConds, sql` AND `);
}


export async function generarPDFBuffer(
  inversionista: InversionistaReporte,
  logoUrl: string = ""
): Promise<Buffer> {
  const html = generarHTMLReporte(inversionista, logoUrl);
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  
  const pdfData = await page.pdf({
    printBackground: true,
    width: "2500px",
    height: "980px",
    landscape: false,
    margin: { top: 20, bottom: 20, left: 8, right: 8 },
  });

  await browser.close();
  return Buffer.from(pdfData);
}

/**
 * Genera PDF del reporte de inversionista y lo sube a R2.
 * Retorna la URL pública del PDF.
 */
export async function generarYSubirPDFInversionista(
  inversionista: InversionistaReporte,
  filename: string,
  logoUrl: string = ""
): Promise<{ url: string; pdfBuffer: Buffer }> {
  const html = generarHTMLReporte(inversionista, logoUrl);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });

  const pdfBuffer = await page.pdf({
    printBackground: true,
    width: "2500px",
    height: "980px",
    landscape: false,
    margin: { top: 20, bottom: 20, left: 8, right: 8 },
  });

  await browser.close();

  const s3 = new S3Client({
    endpoint: process.env.BUCKET_REPORTS_URL,
    region: "auto",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET_REPORTS,
      Key: filename,
      Body: pdfBuffer,
      ContentType: "application/pdf",
    })
  );

  return {
    url: `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`,
    pdfBuffer: Buffer.from(pdfBuffer),
  };
}

function gtq(n: string | number) {
  return `Q${Number(n).toLocaleString("es-GT", { minimumFractionDigits: 2 })}`;
}

export function renderCancelationHTML(data: GetCreditDTO, logoUrl: string) {
  // ✅ Asegurar que sean números
  const saldoBase = Number(data.header.saldo_total || 0);
  const extrasTotal = Number(data.header.extras_total || 0);

  // ✅ Calcular totales de cada columna
  const totales = data.cuotas_atrasadas.items.reduce(
    (acc, r) => ({
      interes: acc.interes + Number(r.interes || 0),
      servicios: acc.servicios + Number(r.servicios || 0),
      mora: acc.mora + Number(r.mora || 0),
      otros: acc.otros + Number(r.otros || 0),
      total_cancelar: acc.total_cancelar + Number(r.total_cancelar || 0),
    }),
    {
      interes: 0,
      servicios: 0,
      mora: 0,
      otros: 0,
      total_cancelar: 0,
    }
  );

  // ✅ Total a pagar = Capital + Total de la tabla
  const totalAPagar = Number(saldoBase) + Number(totales.total_cancelar);

  // Rubros fijos de cancelación
  const closureData = data.closure;
  const rubrosFijos: Array<{ concepto: string; monto: number }> = [];
  if (closureData?.kind === "CANCELACION") {
    const t = Number(closureData.traspaso || 0);
    const g = Number(closureData.garantia_mobiliaria || 0);
    const o = Number(closureData.otros || 0);
    if (t > 0) rubrosFijos.push({ concepto: "Traspaso", monto: t });
    if (g > 0) rubrosFijos.push({ concepto: "Garantía mobiliaria", monto: g });
    if (o > 0) rubrosFijos.push({ concepto: "Otros", monto: o });
  }
  const totalRubrosFijos = rubrosFijos.reduce((s, r) => s + r.monto, 0);

  // ✅ Otros = rubros fijos + extras dinámicos
  const totalOtros = totalRubrosFijos + Number(extrasTotal);
  // ✅ Con extras + rubros fijos
  const totalConExtras = Number(totalAPagar) + totalOtros;

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
      <td style="font-weight:700;background:#e0f2fe;">${gtq(totales.otros + totalOtros)}</td>
      <td class="total" style="font-weight:800;background:#e0f2fe;font-size:14px;">${gtq(totalConExtras)}</td>
    </tr>
  `;



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
  <div style="text-align:right;font-size:11px;color:#64748b;">${new Date().toLocaleDateString("es-GT", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
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
    <div style="text-align:center;">
      <small>Total a cancelar</small>
      <div class="num" style="color:#dc2626;">${gtq(totalConExtras)}</div>
    </div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>No.</th>
      <th>Mes</th>
      <th>Intereses</th>
      <th>Servicios</th>
      <th>Mora</th>
      <th>Otros</th>
      <th>Total a cancelar</th>
    </tr>
  </thead>
  <tbody>
    <tr style="background:#f0f6ff;">
      <td colspan="6" style="font-weight:700;color:#0F1B4C;">Capital</td>
      <td class="total" style="font-weight:800;">${gtq(saldoBase)}</td>
    </tr>
    ${rows || `<tr><td colspan="7" style="text-align:center;color:#7c8591;">Sin cuotas atrasadas</td></tr>`}
    <tr style="background:#f0f6ff;">
      <td colspan="5" style="font-weight:700;color:#0F1B4C;">Otros</td>
      <td>${gtq(totalOtros)}</td>
      <td class="total" style="font-weight:800;">${gtq(totalOtros)}</td>
    </tr>
    ${totalesRow}
  </tbody>
</table>

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

function styleHeaderRow(row: ExcelJS.Row, cols = 7) {
  for (let i = 1; i <= cols; i++) {
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
  // anchos buscando similitud al PDF (6 columnas)
  [8, 18, 14, 14, 12, 12, 18].forEach(
    (w, i) => (ws.getColumn(i + 1).width = w)
  );

  // ── fila 1-2: logo + títulos
  const logo = await fetchImageBase64(opts?.logoUrl);
  if (logo) {
    const imgId = wb.addImage({ base64: logo.data, extension: logo.ext });
    ws.addImage(imgId, 'A1:B2');
  }

  ws.mergeCells("C1:G1");
  ws.getCell("C1").value = "DETALLE DE CANCELACIÓN";
  ws.getCell("C1").font = {
    bold: true,
    size: 12,
    color: { argb: COLOR.slate },
  };
  ws.getCell("C1").alignment = { vertical: "middle" };

  ws.mergeCells("C2:G2");
  ws.getCell("C2").value = "PRÉSTAMO";
  ws.getCell("C2").font = { bold: true, size: 14, color: { argb: COLOR.navy } };
  ws.getCell("C2").alignment = { vertical: "middle" };

  // ── tarjetas (sin merges grandes; solo pintamos el bloque)
  paintCard(ws, "A3:D9");
  paintCard(ws, "E3:G9");

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

  // ✅ tarjeta derecha: Capital + Total a cancelar
  const saldoBase = toNum(data.header.saldo_total);
  const extrasTotal = toNum(data.header.extras_total);

  // Rubros fijos de cancelación
  const closureData = data.closure;
  const rubrosFijos: Array<{ concepto: string; monto: number }> = [];
  let totalRubrosFijos = 0;
  if (closureData?.kind === "CANCELACION") {
    const t = toNum(closureData.traspaso);
    const g = toNum(closureData.garantia_mobiliaria);
    const o = toNum(closureData.otros);
    if (t > 0) rubrosFijos.push({ concepto: "Traspaso", monto: t });
    if (g > 0) rubrosFijos.push({ concepto: "Garantía mobiliaria", monto: g });
    if (o > 0) rubrosFijos.push({ concepto: "Otros", monto: o });
    totalRubrosFijos = t + g + o;
  }

  // Calcular total de la tabla (ya incluye cuota actual)
  let totalTabla = 0;
  for (const it of data.cuotas_atrasadas.items) {
    totalTabla += toNum(it.total_cancelar ?? 0);
  }

  const totalOtros = totalRubrosFijos + extrasTotal;
  const totalAPagar = saldoBase + totalTabla;
  const totalConExtras = totalAPagar + totalOtros;

  ws.getCell("E5").value = "Total a cancelar";
  ws.getCell("E5").font = { bold: true, color: { argb: COLOR.slate } };
  ws.getCell("E5").alignment = { horizontal: "center" };
  ws.mergeCells("F5:G5");
  ws.getCell("F5").value = totalConExtras;
  ws.getCell("F5").numFmt = '"Q"#,##0.00';
  ws.getCell("F5").font = { bold: true, size: 14, color: { argb: "FFDC2626" } }; // rojo
  ws.getCell("F5").alignment = { horizontal: "center" };

  // ── tabla cuotas atrasadas
  let row = 11;
  const head = ws.getRow(row);
  head.values = [
    "No.",
    "Mes",
    "Intereses",
    "Servicios",
    "Mora",
    "Otros",
    "Total a cancelar",
  ];
  styleHeaderRow(head);

  // Fila de Capital
  row++;
  const capitalRow = ws.getRow(row);
  ws.mergeCells(`A${row}:F${row}`);
  capitalRow.getCell(1).value = "Capital";
  capitalRow.getCell(1).font = { bold: true, color: { argb: COLOR.navy } };
  capitalRow.getCell(7).value = saldoBase;
  capitalRow.getCell(7).numFmt = '"Q"#,##0.00';
  capitalRow.getCell(7).font = { bold: true, color: { argb: COLOR.blue } };
  for (let c = 1; c <= 7; c++) {
    capitalRow.getCell(c).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.cardBg },
    };
  }
  setThinBottomBorder(capitalRow);

  if (data.cuotas_atrasadas.items.length === 0) {
    row++;
    ws.mergeCells(`A${row}:G${row}`);
    ws.getCell(`A${row}`).value = "Sin cuotas";
    ws.getCell(`A${row}`).alignment = { horizontal: "center" };
    ws.getCell(`A${row}`).font = { italic: true, color: { argb: "FF7C8591" } };
  } else {
    // ✅ Calcular totales
    let totales = {
      interes: 0,
      servicios: 0,
      mora: 0,
      otros: 0,
      total_cancelar: 0,
    };

    for (const it of data.cuotas_atrasadas.items) {
      row++;

      const interes = toNum(it.interes);
      const servicios = toNum(it.servicios);
      const mora = toNum(it.mora);
      const otros = toNum(it.otros);
      const total = toNum(it.total_cancelar);

      totales.interes += interes;
      totales.servicios += servicios;
      totales.mora += mora;
      totales.otros += otros;
      totales.total_cancelar += total;

      const rr = ws.getRow(row);
      rr.values = [
        it.no,
        it.mes,
        interes,
        servicios,
        mora,
        otros,
        total,
      ];
      [3, 4, 5, 6, 7].forEach((i) => (rr.getCell(i).numFmt = '"Q"#,##0.00'));
      rr.getCell(7).font = { bold: true, color: { argb: COLOR.blue } };
      if (row % 2 === 0) {
        for (let c = 1; c <= 7; c++) {
          rr.getCell(c).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLOR.zebra },
          };
        }
      }
      setThinBottomBorder(rr);
    }

    // Fila de Otros
    row++;
    const otrosRow = ws.getRow(row);
    ws.mergeCells(`A${row}:E${row}`);
    otrosRow.getCell(1).value = "Otros";
    otrosRow.getCell(1).font = { bold: true, color: { argb: COLOR.navy } };
    otrosRow.getCell(6).value = totalOtros;
    otrosRow.getCell(6).numFmt = '"Q"#,##0.00';
    otrosRow.getCell(7).value = totalOtros;
    otrosRow.getCell(7).numFmt = '"Q"#,##0.00';
    otrosRow.getCell(7).font = { bold: true, color: { argb: COLOR.blue } };
    for (let c = 1; c <= 7; c++) {
      otrosRow.getCell(c).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.cardBg },
      };
    }
    setThinBottomBorder(otrosRow);

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
    totalRow.getCell(6).value = totales.otros + totalOtros;
    totalRow.getCell(7).value = totalConExtras;

    [3, 4, 5, 6, 7].forEach((i) => {
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

  // buffer XLSX
  const arr = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return Buffer.from(arr);
}
/** ───────── Excel inversionista ───────── */

export async function buildInversionistaWorkbook(
  inv: InversionistaReporte,
  opts?: { logoUrl?: string; showCreditId?: boolean }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Club Cashin.com";
  wb.created = new Date();

  const ws = wb.addWorksheet("Reporte", {
    properties: { defaultRowHeight: 18 },
  });
  const showId = opts?.showCreditId ?? false;
  const offset = showId ? 1 : 0;
  const totalCols = 15 + offset;

  // Calcular ancho dinámico para la columna Codigo si se muestra
  let dynamicCodigoWidth = 14; 
  if (showId) {
    inv.creditos.forEach(cr => {
      const len = (cr.numero_credito_sifco || "").length;
      if (len > dynamicCodigoWidth) dynamicCodigoWidth = len;
    });
    dynamicCodigoWidth += 4; // Un pequeño margen extra
  }

  // anchos de columna (15 o 16 cols)
  const baseWidths = [10, 22, 14, 12, 16, 20, 16, 12, 12, 14, 20, 16, 22, 10, 14];
  if (showId) baseWidths.unshift(dynamicCodigoWidth);

  baseWidths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  const CINV = {
    navy:  "FF0F1B4C",
    blue:  "FF0485C2",
    text:  "FF0F172A",
    slate: "FF334155",
    white: "FFFFFFFF",
    line:  "FFE0E7EF",
    zebra: "FFF9FBFF",
    total: "FFF0F9FF",
    gray:  "FF8C98B5",
    // Resalte para filas con interés "partido" (cálculo dividido por compras)
    partido: "FFFEF3C7",
  };

  const esDolares = inv.moneda === "dolares";
  const sym = esDolares ? "$" : "Q";
  const numFmt = `"${sym}"#,##0.00`;
  const pctFmt = `0.00"%"`;

  function toN(v: any) { return Number(v || 0); }

  // ── fila 1-2: logo + título
  ws.getRow(1).height = 45;
  ws.getRow(2).height = 35;

  const logo = await fetchImageBase64(opts?.logoUrl);
  if (logo) {
    const imgId = wb.addImage({ base64: logo.data, extension: logo.ext });
    ws.addImage(imgId, "A1:C2");
  }

  ws.mergeCells(1, 4 + offset, 1, 15 + offset);
  ws.getCell(1, 4 + offset).value = "REPORTE DE INVERSIONES";
  ws.getCell(1, 4 + offset).font = { bold: true, size: 14, color: { argb: CINV.navy } };
  ws.getCell(1, 4 + offset).alignment = { vertical: "middle" };

  ws.mergeCells(2, 4 + offset, 2, 15 + offset);
  ws.getCell(2, 4 + offset).value = inv.nombre_inversionista;
  ws.getCell(2, 4 + offset).font = { bold: true, size: 12, color: { argb: CINV.blue } };
  ws.getCell(2, 4 + offset).alignment = { vertical: "middle" };

  // ── fila 3: totales resumen (4 bloques)
  const sub = inv.subtotal;
  const capitalActivo = inv.creditos.reduce((s, c) => s + toN(c.monto_aportado), 0);
  const resumen: [string, number][] = [
    ["Capital activo",       capitalActivo],
    ["Abono capital",        toN(sub.total_abono_capital)],
    ["Interés recibido",     toN(sub.total_abono_general_interes)],
    ["Gran total a recibir", toN(sub.total_cuota_con_reinversion)],
  ];
  const resumenCols = [1, 4 + offset, 8 + offset, 12 + offset];
  for (let i = 0; i < resumen.length; i++) {
    const col = resumenCols[i];
    const labelCell = ws.getCell(3, col);
    labelCell.value = resumen[i][0];
    labelCell.font = { bold: true, color: { argb: CINV.slate }, size: 9 };
    labelCell.alignment = { horizontal: "center" };
    ws.mergeCells(3, col, 3, col + 2);

    const valCell = ws.getCell(4, col);
    valCell.value = resumen[i][1];
    valCell.numFmt = numFmt;
    valCell.font = { bold: true, size: 12, color: { argb: CINV.navy } };
    valCell.alignment = { horizontal: "center" };
    ws.mergeCells(4, col, 4, col + 2);
  }

  // ── tablas de datos
  const esCombinada = inv.reinversion === "reinversion_combinada";
  const labelMapR: Record<string, string> = {
    reinversion_capital:   "Reinversión Capital",
    reinversion_interes:   "Reinversión Interés",
    reinversion_total:     "Interés Compuesto",
    reinversion_excedente: "Reinversión Excedente",
    reinversion_variable:  "Reinversión Variable",
    sin_reinversion:       "Tradicional",
  };

  const grupos = esCombinada
    ? ["reinversion_capital", "reinversion_interes", "reinversion_total", "reinversion_excedente", "reinversion_variable", "sin_reinversion"]
    : ["all"];

  let row = 5;
  const groupTotalRows: number[] = [];

  let headerRowSet = false;
  let firstHeaderRow = 6;

  for (const grupo of grupos) {
    let credGrupo = inv.creditos;
    if (esCombinada) {
      credGrupo = inv.creditos.filter((c) => {
        const t = c.tipo_reinversion || "sin_reinversion";
        return t === grupo;
      });
      if (credGrupo.length === 0) continue;

      row += 2;
      const titleRow = ws.getRow(row);
      titleRow.getCell(2).value = labelMapR[grupo ?? ""] ?? "Sin tipo definido";
      titleRow.getCell(2).font = { bold: true, size: 11, color: { argb: CINV.white } };
      titleRow.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINV.blue } };
      row += 1; // header va una fila debajo del título
    } else {
      row += 1; // en modo normal el header es directo en fila 6
    }

    const headRowIdx = row;
    if (!headerRowSet) {
      firstHeaderRow = headRowIdx;
      headerRowSet = true;
    }

    const head = ws.getRow(headRowIdx);
    head.values = [
      ...(showId ? ["Codigo"] : []),
      "Meses en crédito", "Nombre", "Capital",
      "% Interés", "% Inversionista", "Tasa interés inversor",
      "Interés Inversor", "IVA", "ISR",
      "Abono capital", "% Inv. Interés Neto", "Capital restante",
      "Cuota de mes", "Plazo", "NIT",
    ];

    for (let i = 1; i <= totalCols; i++) {
      const c = head.getCell(i);
      c.font = { bold: true, color: { argb: CINV.white } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: esCombinada ? CINV.navy : CINV.blue } };
      c.alignment = { horizontal: i === (13 + offset) || i === (15 + offset) ? "right" : "center", wrapText: true };
      c.border = { bottom: { style: "thin", color: { argb: CINV.line } } };
    }
    head.height = 28;

    let rowIdx = 0;
    const firstDataRow = row + 1;
    let hasData = false;

    for (const cr of credGrupo) {
      // Calcular el ajuste de compras dinámicamente en memoria para este crédito/inversionista
      // una sola vez por crédito (evitando N+1 consultas en BD por cada pago)
      let montoBaseCalculo = toN(cr.monto_aportado);
      const primerPago = cr.pagos?.[0];
      if (primerPago) {
        try {
          const { db } = await import("../../database/index");
          const { historico_liquidaciones_espejo } = await import("../../database/db/schema");
          const { and, eq, desc } = await import("drizzle-orm");
          const { calcularAjusteCompras } = await import("../comprasAjuste");

          // Buscamos el último histórico
          const [lastHistorico] = await db
            .select({
              monto_aportado: historico_liquidaciones_espejo.monto_aportado,
              fecha: historico_liquidaciones_espejo.fecha,
            })
            .from(historico_liquidaciones_espejo)
            .where(
              and(
                eq(historico_liquidaciones_espejo.credito_id, cr.credito_id),
                eq(historico_liquidaciones_espejo.inversionista_id, inv.inversionista_id)
              )
            )
            .orderBy(desc(historico_liquidaciones_espejo.fecha))
            .limit(1);

          const fechaParaAjuste = primerPago.fecha_pago ? new Date(primerPago.fecha_pago) : new Date();
          const periodoMes = fechaParaAjuste.getMonth();
          const periodoAnio = fechaParaAjuste.getFullYear();
          // Siempre calcular ajuste — cubre compras pendientes aunque espejo == historico
          const { montoRestarCalculo } = await calcularAjusteCompras(
            cr.credito_id,
            inv.inversionista_id,
            lastHistorico ? new Date(lastHistorico.fecha) : null,
            periodoMes,
            periodoAnio,
          );

          if (montoRestarCalculo.gt(0)) {
            // Si el reporte es en dólares, convertimos montoRestarCalculo (que en BD está en quetzales)
            // a dólares usando formatToUSD para mantener consistencia de monedas.
            let restaAjustada = Number(montoRestarCalculo);
            if (esDolares) {
              const { formatToUSD } = await import("./currencyConverter");
              restaAjustada = formatToUSD(montoRestarCalculo.toString(), inv.inversionista_id);
            }

            montoBaseCalculo = Number(new Big(cr.monto_aportado).minus(restaAjustada).toFixed(2));
          }
        } catch (e) {
          console.error("Error calculando ajuste dinámico para el Excel:", e);
        }
      }

      for (const pago of cr.pagos ?? []) {
        row++;
        rowIdx++;
        hasData = true;
        const rr = ws.getRow(row);

        // Para pagos NO_LIQUIDADO el monto_aportado del espejo todavía no
        // tiene el abono restado, así que Capital = monto_aportado y
        // Capital restante = monto_aportado - abono. Para pagos LIQUIDADO
        // el monto_aportado ya viene post-abono, así que se suma para
        // reconstruir el capital inicial y el restante es el aportado tal cual.
        const esNoLiquidado = pago.estado_liquidacion === "NO_LIQUIDADO";

        // Explicación de la lógica de Capital y Capital Restante:
        // - Si el pago es NO_LIQUIDADO: el abono a capital del mes aún NO se ha restado del espejo en la BD.
        //   Por lo tanto, 'Capital' (inicial) es el montoBaseCalculo actual, y 'Capital Restante' es el saldo inicial menos el abono que se le pagará.
        // - Si el pago es LIQUIDADO: el abono a capital ya se restó físicamente en la BD.
        //   Para mostrar el 'Capital' inicial con el que empezó el mes, se lo sumamos de vuelta (montoBaseCalculo + abono). 
        //   El 'Capital Restante' actual post-abono ya es exactamente el valor de montoBaseCalculo.
        const capital = esNoLiquidado
          ? montoBaseCalculo
          : montoBaseCalculo + toN(pago.abono_capital);
        const capitalRestante = esNoLiquidado
          ? montoBaseCalculo - toN(pago.abono_capital)
          : montoBaseCalculo;
        const tasaFmt = toN(pago.tasaInteresInvesor) / 100;
        const cuotaMes = `${pago.mes || "-"}${pago.cuota ? ` (Cuota #${pago.cuota})` : ""}`;

        rr.values = [
          ...(showId ? [cr.numero_credito_sifco] : []),
          pago.cuota ?? cr.meses_en_credito ?? "",
          cr.nombre_usuario ?? "",
          capital,
          String(cr.porcentaje_interes ?? "") + " %",
          String(pago.porcentaje_inversor ?? "") + " %",
          tasaFmt,
          toN(pago.abono_interes),
          toN(pago.abono_iva),
          toN(pago.isr),
          toN(pago.abono_capital),
          toN(pago.abonoGeneralInteres),
          capitalRestante,
          cuotaMes,
          cr.plazo ?? "",
          cr.nit_usuario ?? "",
        ];

        rr.getCell(3 + offset).numFmt  = numFmt;
        rr.getCell(6 + offset).numFmt  = pctFmt;
        [7, 8, 9, 10, 11, 12].forEach(i => (rr.getCell(i + offset).numFmt = numFmt));

        rr.getCell(7 + offset).font  = { color: { argb: CINV.navy } };
        rr.getCell(10 + offset).font = { color: { argb: CINV.navy } };
        rr.getCell(13 + offset).alignment = { horizontal: "right" };
        rr.getCell(15 + offset).alignment = { horizontal: "right" };

        // Resaltar en amarillo las filas cuyo interés se calculó partido por
        // compras del mes; prevalece sobre el zebra.
        if (pago.interes_partido) {
          for (let c = 1; c <= totalCols; c++) {
            rr.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINV.partido } };
          }
        } else if (rowIdx % 2 === 0) {
          for (let c = 1; c <= totalCols; c++) {
            rr.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINV.zebra } };
          }
        }
        rr.eachCell(cell => {
          cell.border = { bottom: { style: "thin", color: { argb: CINV.line } } };
        });
      }
    }

    if (!hasData) {
      row++;
      ws.mergeCells(row, 1, row, totalCols);
      ws.getCell(row, 1).value = "Sin pagos registrados";
      ws.getCell(row, 1).alignment = { horizontal: "center" };
    }

    const lastDataRow = row;

    // ── fila de totales con fórmulas SUM
    row++;
    const totalRow = ws.getRow(row);
    const r1 = firstDataRow;
    const r2 = lastDataRow;

    if (esCombinada) {
      totalRow.getCell(2).value = `Total ${labelMapR[grupo ?? ""] ?? "Sin tipo"}`;
      if (hasData) {
        groupTotalRows.push(row);
      }
    } else {
      totalRow.getCell(1).value = "Total";
    }

    if (hasData) {
      const colC = showId ? "D" : "C";
      totalRow.getCell(3 + offset).value  = { formula: `SUM(${colC}${r1}:${colC}${r2})` };
      totalRow.getCell(3 + offset).numFmt = numFmt;

      // Definición de las columnas que se suman y sus letras correspondientes
      const sumCols: [number, string, string][] = [
        [7,  "G", "H"], // Interés Inversor
        [8,  "H", "I"], // IVA
        [9,  "I", "J"], // ISR
        [10, "J", "K"], // Abono capital
        [11, "K", "L"], // % Inv. Neto
        [12, "L", "M"], // Capital restante
      ];

      for (const [ci, colLetterDefault, colLetterShifted] of sumCols) {
        const targetCi = ci + offset;
        const targetColLetter = showId ? colLetterShifted : colLetterDefault;
        totalRow.getCell(targetCi).value  = { formula: `SUM(${targetColLetter}${r1}:${targetColLetter}${r2})` };
        totalRow.getCell(targetCi).numFmt = numFmt;
      }
    }

    for (let c = 1; c <= totalCols; c++) {
      const cell = totalRow.getCell(c);
      cell.font = { bold: true, color: { argb: CINV.navy } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINV.total } };
      cell.border = {
        top:    { style: "medium", color: { argb: CINV.blue } },
        bottom: { style: "thin",   color: { argb: CINV.line } },
      };
    }
  }

  if (esCombinada && groupTotalRows.length > 1) {
    row += 2;
    const granTotalRow = ws.getRow(row);
    granTotalRow.getCell(2).value = "Gran Total";
    
    const colC = showId ? "D" : "C";
    const formulaC = groupTotalRows.map(r => `${colC}${r}`).join("+");
    granTotalRow.getCell(3 + offset).value = { formula: formulaC };
    granTotalRow.getCell(3 + offset).numFmt = numFmt;
    
    const sumCols: [number, string, string][] = [
      [7,  "G", "H"], // Interés Inversor
      [8,  "H", "I"], // IVA
      [9,  "I", "J"], // ISR
      [10, "J", "K"], // Abono capital
      [11, "K", "L"], // % Inv. Neto
      [12, "L", "M"], // Capital restante
    ];
    
    for (const [ci, colLetterDefault, colLetterShifted] of sumCols) {
      const targetCi = ci + offset;
      const targetColLetter = showId ? colLetterShifted : colLetterDefault;
      const formula = groupTotalRows.map(r => `${targetColLetter}${r}`).join("+");
      granTotalRow.getCell(targetCi).value = { formula };
      granTotalRow.getCell(targetCi).numFmt = numFmt;
    }
    
    for (let c = 1; c <= totalCols; c++) {
      const cell = granTotalRow.getCell(c);
      cell.font = { bold: true, color: { argb: CINV.white } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINV.navy } };
      cell.border = {
        top:    { style: "double", color: { argb: CINV.blue } },
        bottom: { style: "medium", color: { argb: CINV.navy } },
      };
    }
  }

  // ── sección reinversión (2 filas abajo de la tabla)
  row += 2;
  const titleRow = ws.getRow(row);
  titleRow.getCell(1).value = "Totales de Reinversión";
  titleRow.getCell(1).font = { bold: true, size: 12, color: { argb: CINV.navy } };
  
  row += 2;
  const reinv: [string, number][] = [];

  if (esCombinada) {
    let reinvCap_cap = new Big(0);
    let reinvTot_cap = new Big(0);
    let reinvTot_int = new Big(0);
    let reinvInt_int = new Big(0);
    // Pools de excedente/variable: cuota completa (cap + interés neto) de sus créditos.
    // El monto reinvertido se calcula después con el monto_reinversion (igual que el backend).
    let poolExcedente = new Big(0);
    let poolVariable  = new Big(0);

    for (const cr of inv.creditos) {
      const tipo = cr.tipo_reinversion || "sin_reinversion";
      for (const pago of cr.pagos ?? []) {
        const cap = new Big(pago.abono_capital || 0);
        const int = new Big(pago.abono_interes || 0);
        const iva = new Big(pago.abono_iva || 0);
        const isr = new Big(pago.isr || 0);

        const abonoGeneralInteres = inv.emite_factura
          ? int.plus(iva)
          : int.minus(isr);

        if (tipo === "reinversion_capital") {
          reinvCap_cap = reinvCap_cap.plus(cap);
        } else if (tipo === "reinversion_total") {
          reinvTot_cap = reinvTot_cap.plus(cap);
          // `abonoGeneralInteres` YA es el interés neto (NO factura: int - isr; factura: int + iva).
          // No re-aplicar el 7% de ISR aquí: causaba doble descuento (483.47 → 449.63).
          reinvTot_int = reinvTot_int.plus(abonoGeneralInteres);
        } else if (tipo === "reinversion_interes") {
          // `abonoGeneralInteres` YA es el interés neto; no re-descontar ISR.
          reinvInt_int = reinvInt_int.plus(abonoGeneralInteres);
        } else if (tipo === "reinversion_excedente") {
          poolExcedente = poolExcedente.plus(cap.plus(abonoGeneralInteres));
        } else if (tipo === "reinversion_variable") {
          poolVariable = poolVariable.plus(cap.plus(abonoGeneralInteres));
        }
      }
    }

    // Excedente: el inversionista RECIBE el monto fijo; el sobrante del pool se reinvierte.
    // Variable: el monto fijo es lo que se REINVIERTE del pool.
    const montoReinv = new Big(toN(inv.monto_reinversion));
    const reinvExcedente = poolExcedente.gt(0)
      ? poolExcedente.minus(montoReinv.gt(poolExcedente) ? poolExcedente : montoReinv)
      : new Big(0);
    const reinvVariable = poolVariable.gt(0)
      ? (montoReinv.gt(poolVariable) ? poolVariable : montoReinv)
      : new Big(0);

    if (reinvCap_cap.gt(0)) {
      reinv.push(["Reinversión Capital (Abono Capital)", reinvCap_cap.toNumber()]);
    }
    if (reinvTot_cap.gt(0)) {
      reinv.push(["Interés Compuesto (Abono Capital)", reinvTot_cap.toNumber()]);
    }
    if (reinvTot_int.gt(0)) {
      reinv.push(["Interés Compuesto (Interés Neto)", reinvTot_int.toNumber()]);
    }
    if (reinvInt_int.gt(0)) {
      reinv.push(["Reinversión Interés (Interés Neto)", reinvInt_int.toNumber()]);
    }
    if (reinvExcedente.gt(0)) {
      reinv.push(["Reinversión Excedente (Sobrante)", reinvExcedente.toNumber()]);
    }
    if (reinvVariable.gt(0)) {
      reinv.push(["Reinversión Variable", reinvVariable.toNumber()]);
    }
    reinv.push(["Total Reinversión", toN(sub.total_reinversion)]);
  } else {
    reinv.push(["Reinversión Capital", toN(sub.total_reinversion_capital)]);
    reinv.push(["Reinversión Interés", toN(sub.total_reinversion_interes)]);
    reinv.push(["Total Reinversión", toN(sub.total_reinversion)]);
  }

  let col = 1;
  for (const [label, val] of reinv) {
    ws.getCell(row, col).value = label;
    ws.getCell(row, col).font = { bold: true, color: { argb: CINV.text }, size: 9 };
    ws.mergeCells(row, col, row, col + 2);
    col += 3;

    ws.getCell(row + 1, col - 3).value = val;
    ws.getCell(row + 1, col - 3).numFmt = numFmt;
    ws.getCell(row + 1, col - 3).font = { bold: true, size: 11, color: { argb: CINV.blue } };
    ws.mergeCells(row + 1, col - 3, row + 1, col - 1);
  }

  // ── pie
  row += 3;
  ws.mergeCells(row, 1, row, totalCols);
  ws.getCell(row, 1).value = `Generado por Club Cashin.com · ${new Date().toLocaleDateString("es-GT")}`;
  ws.getCell(row, 1).font = { color: { argb: CINV.gray }, size: 9 };

  ws.views = [{ state: "frozen", ySplit: firstHeaderRow }];

  const arr = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return Buffer.from(arr);
}

export async function generarYSubirExcelInversionista(
  inversionista: InversionistaReporte,
  filename: string,
  logoUrl: string = "",
  showCreditId: boolean = false
): Promise<{ url: string; excelBuffer: Buffer }> {
  const excelBuffer = await buildInversionistaWorkbook(inversionista, { logoUrl, showCreditId });

  const s3 = new S3Client({
    endpoint: process.env.BUCKET_REPORTS_URL,
    region: "auto",
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID     as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });

  await s3.send(
    new PutObjectCommand({
      Bucket:      process.env.BUCKET_REPORTS,
      Key:         filename,
      Body:        excelBuffer,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );

  return {
    url: `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`,
    excelBuffer,
  };
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


export const convertirAHoraGuatemala = (fechaString: string): Date => {
  const fecha = new Date(fechaString);
  // Guatemala está en UTC-6
  return new Date(fecha.toLocaleString('en-US', { timeZone: 'America/Guatemala' }));
};