/**
 * Exportación XLSX/PDF de la bandeja de supervisión Págalo.
 *
 * El dataset vive en el CRM, así que acá se pagina contra su endpoint hasta
 * juntar el universo filtrado completo — no solo la página que se está viendo,
 * que es justamente lo que el reporte viene a resolver.
 */

import axios from "axios";
import ExcelJS from "exceljs";
import {
  getPagaloSupervision,
  type PagaloGrupoSupervision,
  type PagaloResumenKpis,
  type PagaloSupervisionParams,
} from "../services/crm.service";
import { launchBrowser } from "../utils/functions/browser";

const LOGO_URL =
  process.env.LOGO_URL ||
  "https://pub-8081c8d6e5e743f9adfc9e0db92e5a88.r2.dev/reports/logo-cashin.png";

/** Mismo patrón que generalFunctions.ts: trae el logo como base64 para poder
 * embeberlo en ExcelJS/HTML sin depender de que el visor cargue una URL externa. */
async function fetchLogoBase64(): Promise<{ data: string; ext: "png" | "jpeg" } | null> {
  try {
    const res = await axios.get(LOGO_URL, { responseType: "arraybuffer" });
    const ct = String(res.headers["content-type"] || "");
    const ext: "png" | "jpeg" = ct.includes("png") ? "png" : "jpeg";
    return { data: Buffer.from(res.data).toString("base64"), ext };
  } catch {
    return null;
  }
}

const qExport = (valor: unknown) =>
  `Q${Number(valor ?? 0).toLocaleString("es-GT", { minimumFractionDigits: 2 })}`;

// Mismo catálogo que ESTADO_GRUPO_INFO en carteraFront/pagaloSupervision.helpers.ts
// y en crm/apps/web/.../formato-pagalo.ts — copiado (no importado) porque no hay
// paquete compartido entre estos tres repos para diez strings estables.
const ETIQUETA_ESTADO_GRUPO: Record<string, string> = {
  DRAFT: "Borrador",
  LINKS_PENDING: "Creando links",
  PENDING_PAYMENT: "Esperando pago",
  PARTIALLY_PAID: "Pago parcial",
  READY_TO_APPLY: "Listo para aplicar",
  APPLYING: "Aplicando",
  COMPLETED: "Completado",
  APPLICATION_FAILED: "Falló al aplicar",
  REVIEW_REQUIRED: "Requiere revisión",
  CANCELLED: "Cancelado",
};
const etiquetaEstadoGrupo = (status: string) => ETIQUETA_ESTADO_GRUPO[status] ?? status;

/** Filas "etiqueta: valor" del resumen, mismo orden que las cards de la pantalla. */
function filasResumenKpis(resumen: PagaloResumenKpis | undefined): [string, string][] {
  if (!resumen) return [];
  return [
    ["Grupos", resumen.grupos.toLocaleString("es-GT")],
    ["Total capital", qExport(resumen.capitalTotal)],
    ["Total interés/mora", qExport(resumen.facturableTotal)],
    ["Total general", qExport(resumen.totalAmount)],
    ["Links generados", resumen.linksTotal.toLocaleString("es-GT")],
    ["Links pagados", resumen.linksPagados.toLocaleString("es-GT")],
  ];
}

/**
 * Bandeja de supervisión operativa, no un histórico de años: 5,000 es margen
 * amplio de sobra para el uso real.
 */
export const LIMITE_EXPORT_PAGALO = 5_000;
const PAGE_SIZE_EXPORT_PAGALO = 1_000;
const TIMEOUT_EXPORT_MS = 60_000;

const ENCABEZADOS_EXPORT_PAGALO = [
  "SIFCO",
  "Cliente",
  "Asesor",
  "Estado",
  "Total",
  "Origen",
  "Fecha de creación",
];

export interface DatasetExportPagalo {
  filas: PagaloGrupoSupervision[];
  total: number;
  truncado: boolean;
  resumenKpis: PagaloResumenKpis | undefined;
}

export async function traerDatasetCompletoPagalo(
  filtros: PagaloSupervisionParams,
): Promise<DatasetExportPagalo> {
  const filas: PagaloGrupoSupervision[] = [];
  const idsVistos = new Set<string>();
  let offset = 0;
  let hayMas = true;
  let totalServidor = 0;
  // El backend calcula resumenKpis sobre TODO el filtro (no por página): con
  // la primera respuesta alcanza.
  let resumenKpis: PagaloResumenKpis | undefined;

  while (hayMas && filas.length < LIMITE_EXPORT_PAGALO) {
    const respuesta = await getPagaloSupervision(
      { ...filtros, limit: PAGE_SIZE_EXPORT_PAGALO, offset },
      TIMEOUT_EXPORT_MS,
    );
    // El CRM responde 200 solo con el dataset completo (sus errores viajan como
    // 4xx/5xx y axios los lanza), pero este bucle itera la respuesta cruda de
    // otro servicio: sin esto, un 200 con otra forma rompe con "not iterable" y
    // el usuario recibe un 500 opaco en vez de un archivo.
    if (!Array.isArray(respuesta?.grupos)) {
      throw new Error("El CRM devolvió una respuesta sin el listado de grupos");
    }
    totalServidor = respuesta.total;
    if (!resumenKpis) resumenKpis = respuesta.resumenKpis;
    for (const grupo of respuesta.grupos) {
      if (idsVistos.has(grupo.id)) continue;
      idsVistos.add(grupo.id);
      filas.push(grupo);
    }
    hayMas =
      respuesta.grupos.length === PAGE_SIZE_EXPORT_PAGALO &&
      offset + PAGE_SIZE_EXPORT_PAGALO < respuesta.total;
    offset += PAGE_SIZE_EXPORT_PAGALO;
  }

  const recortadas = filas.slice(0, LIMITE_EXPORT_PAGALO);
  // Dos formas de quedar incompleto, y las dos tienen que avisar:
  //   1. El filtro excede el tope de seguridad.
  //   2. Con OFFSET/LIMIT, una escritura entre página y página corre las filas:
  //      la siguiente repite lo ya visto (el Set lo descarta) y algo que estaba
  //      más atrás nunca se pide. El bucle igual avanza el offset completo y
  //      corta al llegar al total informado, así que sin esto el archivo sale
  //      con menos filas de las que el servidor dijo tener y `truncado` era
  //      false: un reporte incompleto presentado como completo.
  const faltanFilas = totalServidor > 0 && recortadas.length < Math.min(totalServidor, LIMITE_EXPORT_PAGALO);

  return {
    filas: recortadas,
    total: totalServidor,
    truncado: totalServidor > LIMITE_EXPORT_PAGALO || faltanFilas,
    resumenKpis,
  };
}

const fechaGT = (valor: string) =>
  new Date(valor).toLocaleDateString("es-GT", { timeZone: "America/Guatemala" });

const fechaHoraGT = (valor: string) =>
  new Date(valor).toLocaleString("es-GT", { timeZone: "America/Guatemala" });

const COLOR_MORADO = "FF7C3AED";
const COLOR_MORADO_OSCURO = "FF6D28D9";
const COLOR_MORADO_CLARO = "FFF5F3FF";
const COLOR_MORADO_BORDE = "FFDDD6FE";
const COLOR_BLANCO = "FFFFFFFF";
const COLOR_GRIS_TEXTO = "FF6B7280";
const COLOR_GRIS_BORDE = "FFE5E7EB";
const COLOR_ZEBRA = "FFFAF5FF";
const NUM_COLUMNAS_PAGALO = 7;

const bordeFino = (argb: string) => ({
  top: { style: "thin" as const, color: { argb } },
  left: { style: "thin" as const, color: { argb } },
  bottom: { style: "thin" as const, color: { argb } },
  right: { style: "thin" as const, color: { argb } },
});
const BORDE_TABLA = bordeFino(COLOR_GRIS_BORDE);
const BORDE_KPI = bordeFino(COLOR_MORADO_BORDE);

export async function buildPagaloSupervisionWorkbook(
  filas: PagaloGrupoSupervision[],
  resumenKpis?: PagaloResumenKpis,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CashIn";
  wb.created = new Date();
  const ws = wb.addWorksheet("Supervisión Págalo", {
    properties: { defaultRowHeight: 18 },
    views: [{ showGridLines: false }],
  });
  // Solo ancho: NO usar `header` acá — ExcelJS lo escribiría automáticamente
  // en la fila 1, chocando con el logo/título que se ponen a mano más abajo.
  ws.columns = [
    { key: "sifco", width: 20 },
    { key: "cliente", width: 32 },
    { key: "asesor", width: 24 },
    { key: "estado", width: 18 },
    { key: "total", width: 16 },
    { key: "origen", width: 12 },
    { key: "fecha", width: 20 },
  ];

  // ── Encabezado: logo + título ────────────────────────────────────────
  const logo = await fetchLogoBase64();
  if (logo) {
    const imgId = wb.addImage({ base64: logo.data, extension: logo.ext });
    ws.addImage(imgId, "A1:A3");
  }
  ws.mergeCells(1, 2, 2, NUM_COLUMNAS_PAGALO);
  const celdaTitulo = ws.getCell(1, 2);
  celdaTitulo.value = "Supervisión Págalo";
  celdaTitulo.font = { bold: true, size: 18, color: { argb: COLOR_MORADO_OSCURO } };
  celdaTitulo.alignment = { vertical: "middle" };
  ws.mergeCells(3, 2, 3, NUM_COLUMNAS_PAGALO);
  const celdaFecha = ws.getCell(3, 2);
  celdaFecha.value = `Generado el ${fechaHoraGT(new Date().toISOString())}`;
  celdaFecha.font = { size: 9, italic: true, color: { argb: COLOR_GRIS_TEXTO } };
  ws.getRow(1).height = 26;
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 16;
  ws.getRow(4).height = 8;

  // ── KPIs: grid de "cards" de 2 filas x 3 columnas, cada una un rango de
  // celdas mergeado con fondo y borde propios ────────────────────────────
  const kpis = filasResumenKpis(resumenKpis);
  const filaKpisInicio = 5;
  const columnasPorCard = 2;
  const filasPorCard = 3;
  if (kpis.length > 0) {
    kpis.forEach(([label, valor], i) => {
      const colInicio = 1 + (i % 3) * columnasPorCard;
      const filaInicio = filaKpisInicio + Math.floor(i / 3) * filasPorCard;

      ws.mergeCells(filaInicio, colInicio, filaInicio, colInicio + columnasPorCard - 1);
      const celdaLabel = ws.getCell(filaInicio, colInicio);
      celdaLabel.value = label.toUpperCase();
      celdaLabel.font = { bold: true, size: 8, color: { argb: COLOR_MORADO_OSCURO } };
      celdaLabel.alignment = { vertical: "middle", horizontal: "left" };

      ws.mergeCells(filaInicio + 1, colInicio, filaInicio + 1, colInicio + columnasPorCard - 1);
      const celdaValor = ws.getCell(filaInicio + 1, colInicio);
      celdaValor.value = valor;
      celdaValor.font = { bold: true, size: 14, color: { argb: "FF111111" } };
      celdaValor.alignment = { vertical: "middle", horizontal: "left" };

      for (let f = filaInicio; f < filaInicio + filasPorCard - 1; f += 1) {
        for (let c = colInicio; c < colInicio + columnasPorCard; c += 1) {
          const celda = ws.getCell(f, c);
          celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_MORADO_CLARO } };
          celda.border = BORDE_KPI;
        }
      }
      ws.getRow(filaInicio).height = 16;
      ws.getRow(filaInicio + 1).height = 22;
    });
    ws.getRow(filaKpisInicio + filasPorCard - 1).height = 4;
  }
  const filasKpiOcupadas = kpis.length > 0 ? Math.ceil(kpis.length / 3) * filasPorCard : 0;
  let filaActual = filaKpisInicio + filasKpiOcupadas + 1;

  // ── Tabla ────────────────────────────────────────────────────────────
  const filaHeader = filaActual;
  ENCABEZADOS_EXPORT_PAGALO.forEach((header, i) => {
    const cell = ws.getCell(filaHeader, i + 1);
    cell.value = header;
    cell.font = { bold: true, size: 10, color: { argb: COLOR_BLANCO } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_MORADO } };
    cell.alignment = { vertical: "middle", horizontal: i === 4 ? "right" : "left" };
    cell.border = BORDE_TABLA;
  });
  ws.getRow(filaHeader).height = 22;
  ws.views = [{ showGridLines: false, state: "frozen", ySplit: filaHeader }];
  ws.autoFilter = {
    from: { row: filaHeader, column: 1 },
    to: { row: filaHeader, column: NUM_COLUMNAS_PAGALO },
  };

  filas.forEach((grupo, i) => {
    const fila = filaHeader + 1 + i;
    const valores = [
      grupo.numeroCreditoSifco,
      grupo.clienteNombre ?? "—",
      grupo.asesoresNombres.join(", ") || "—",
      etiquetaEstadoGrupo(grupo.status),
      // Numérico a propósito: como texto con "Q" la columna no suma en la hoja.
      Number(grupo.totalAmount),
      grupo.origen,
      fechaHoraGT(grupo.createdAt),
    ];
    valores.forEach((valor, colIdx) => {
      const cell = ws.getCell(fila, colIdx + 1);
      cell.value = valor;
      cell.border = BORDE_TABLA;
      cell.font = { size: 10 };
      cell.alignment = { vertical: "middle", horizontal: colIdx === 4 ? "right" : "left" };
      if (i % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_ZEBRA } };
      }
    });
    ws.getRow(fila).height = 18;
  });
  ws.getColumn(5).numFmt = "#,##0.00";

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const escaparHtml = (valor: string) =>
  valor
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export async function buildPagaloSupervisionHTML(
  filas: PagaloGrupoSupervision[],
  { total, truncado, resumenKpis }: { total: number; truncado: boolean; resumenKpis?: PagaloResumenKpis },
): Promise<string> {
  // "reporte parcial" y no "límite alcanzado": ahora truncado también cubre el
  // caso en que la paginación perdió filas por un corrimiento, donde no se
  // alcanzó ningún límite.
  const titulo = truncado
    ? `Supervisión Págalo (${filas.length.toLocaleString("es-GT")} de ${total.toLocaleString("es-GT")} registros - reporte parcial)`
    : "Supervisión Págalo";

  const logo = await fetchLogoBase64();
  const logoHtml = logo
    ? `<img src="data:image/${logo.ext};base64,${logo.data}" alt="CashIn" />`
    : "";

  const kpisHtml = filasResumenKpis(resumenKpis)
    .map(
      ([label, valor]) =>
        `<div class="kpi"><span class="kpi-label">${escaparHtml(label)}</span><span class="kpi-valor">${escaparHtml(valor)}</span></div>`,
    )
    .join("");

  const encabezados = ENCABEZADOS_EXPORT_PAGALO.map(
    (h) => `<th>${escaparHtml(h)}</th>`,
  ).join("");

  const cuerpo = filas
    .map((grupo) => {
      const celdas = [
        grupo.numeroCreditoSifco,
        grupo.clienteNombre ?? "—",
        grupo.asesoresNombres.join(", ") || "—",
        etiquetaEstadoGrupo(grupo.status),
        `Q${Number(grupo.totalAmount).toLocaleString("es-GT", { minimumFractionDigits: 2 })}`,
        grupo.origen,
        fechaGT(grupo.createdAt),
      ];
      return `<tr>${celdas
        .map((celda, i) => `<td class="${i === 4 ? "num" : ""}">${escaparHtml(String(celda))}</td>`)
        .join("")}</tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: system-ui, sans-serif; font-size: 8pt; color: #111; }
  .header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .header img { width: 28px; height: 28px; }
  h1 { font-size: 13pt; margin: 0; color: #6d28d9; }
  .kpis { display: flex; flex-wrap: wrap; gap: 14px; margin: 0 0 12px; }
  .kpi { display: flex; flex-direction: column; }
  .kpi-label { font-size: 7pt; color: #6b7280; text-transform: uppercase; }
  .kpi-valor { font-size: 10pt; font-weight: bold; color: #111; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #7c3aed; color: #fff; text-align: left; padding: 5px 6px; font-size: 8pt; }
  td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; }
  td.num { text-align: right; white-space: nowrap; }
  tr:nth-child(even) td { background: #faf5ff; }
</style></head>
<body>
<div class="header">${logoHtml}<h1>${escaparHtml(titulo)}</h1></div>
${kpisHtml ? `<div class="kpis">${kpisHtml}</div>` : ""}
<table><thead><tr>${encabezados}</tr></thead><tbody>${cuerpo}</tbody></table>
</body></html>`;
}

export async function buildPagaloSupervisionPDF(
  filas: PagaloGrupoSupervision[],
  resumen: { total: number; truncado: boolean; resumenKpis?: PagaloResumenKpis },
): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(await buildPagaloSupervisionHTML(filas, resumen), {
      waitUntil: "networkidle0",
    });
    const pdf = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export function nombreArchivoExport(
  extension: "xlsx" | "pdf",
  truncado: boolean,
): string {
  const sufijo = truncado ? "-parcial" : "";
  return `supervision-pagalo${sufijo}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}
