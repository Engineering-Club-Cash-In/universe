/**
 * Exportación XLSX/PDF de la bandeja de supervisión Págalo.
 *
 * El dataset vive en el CRM, así que acá se pagina contra su endpoint hasta
 * juntar el universo filtrado completo — no solo la página que se está viendo,
 * que es justamente lo que el reporte viene a resolver.
 */

import ExcelJS from "exceljs";
import {
  getPagaloSupervision,
  type PagaloGrupoSupervision,
  type PagaloSupervisionParams,
} from "../services/crm.service";
import { launchBrowser } from "../utils/functions/browser";

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
}

export async function traerDatasetCompletoPagalo(
  filtros: PagaloSupervisionParams,
): Promise<DatasetExportPagalo> {
  const filas: PagaloGrupoSupervision[] = [];
  const idsVistos = new Set<string>();
  let offset = 0;
  let hayMas = true;
  let totalServidor = 0;

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
  };
}

const fechaGT = (valor: string) =>
  new Date(valor).toLocaleDateString("es-GT", { timeZone: "America/Guatemala" });

const fechaHoraGT = (valor: string) =>
  new Date(valor).toLocaleString("es-GT", { timeZone: "America/Guatemala" });

export async function buildPagaloSupervisionWorkbook(
  filas: PagaloGrupoSupervision[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Supervisión Págalo");

  ws.columns = [
    { header: "SIFCO", key: "sifco", width: 20 },
    { header: "Cliente", key: "cliente", width: 34 },
    { header: "Asesor", key: "asesor", width: 28 },
    { header: "Estado", key: "estado", width: 20 },
    { header: "Total", key: "total", width: 16 },
    { header: "Origen", key: "origen", width: 12 },
    { header: "Fecha de creación", key: "fecha", width: 22 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = "A1:G1";

  for (const grupo of filas) {
    ws.addRow({
      sifco: grupo.numeroCreditoSifco,
      cliente: grupo.clienteNombre ?? "—",
      asesor: grupo.asesoresNombres.join(", ") || "—",
      estado: grupo.status,
      // Numérico a propósito: como texto con "Q" la columna no suma en la hoja.
      total: Number(grupo.totalAmount),
      origen: grupo.origen,
      fecha: fechaHoraGT(grupo.createdAt),
    });
  }
  ws.getColumn("total").numFmt = "#,##0.00";

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const escaparHtml = (valor: string) =>
  valor
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function buildPagaloSupervisionHTML(
  filas: PagaloGrupoSupervision[],
  { total, truncado }: { total: number; truncado: boolean },
): string {
  // "reporte parcial" y no "límite alcanzado": ahora truncado también cubre el
  // caso en que la paginación perdió filas por un corrimiento, donde no se
  // alcanzó ningún límite.
  const titulo = truncado
    ? `Supervisión Págalo (${filas.length.toLocaleString("es-GT")} de ${total.toLocaleString("es-GT")} registros - reporte parcial)`
    : "Supervisión Págalo";

  const encabezados = ENCABEZADOS_EXPORT_PAGALO.map(
    (h) => `<th>${escaparHtml(h)}</th>`,
  ).join("");

  const cuerpo = filas
    .map((grupo) => {
      const celdas = [
        grupo.numeroCreditoSifco,
        grupo.clienteNombre ?? "—",
        grupo.asesoresNombres.join(", ") || "—",
        grupo.status,
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
  h1 { font-size: 13pt; margin: 0 0 10px; color: #6d28d9; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #7c3aed; color: #fff; text-align: left; padding: 5px 6px; font-size: 8pt; }
  td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; }
  td.num { text-align: right; white-space: nowrap; }
  tr:nth-child(even) td { background: #faf5ff; }
</style></head>
<body><h1>${escaparHtml(titulo)}</h1>
<table><thead><tr>${encabezados}</tr></thead><tbody>${cuerpo}</tbody></table>
</body></html>`;
}

export async function buildPagaloSupervisionPDF(
  filas: PagaloGrupoSupervision[],
  resumen: { total: number; truncado: boolean },
): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(buildPagaloSupervisionHTML(filas, resumen), {
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
