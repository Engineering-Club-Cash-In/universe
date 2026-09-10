import ExcelJS from "exceljs";
import { CASHIN_COLOR, fetchImageBase64 } from "./excelBrand";
import { aInstante, partesGT, SOLO_FECHA, ZONA_GT } from "./diaGuatemala";

/**
 * Helper compartido para armar Excel con la identidad visual CashIn.
 *
 * Es la versión genérica del estilo que estrenó el Excel de liquidación de
 * inversionistas (`buildInversionistaWorkbook` en generalFunctions.ts, PR #1532):
 * cabecera blanca con el isologo traído de R2, títulos en navy, acento morado
 * #4E57EA, tipografía Inter, encabezado de tabla gris con filo morado, zebra en
 * las filas y pie "Generado por Club Cashin.com".
 *
 * Vive aparte de generalFunctions.ts a propósito: ese módulo arrastra puppeteer
 * y el controlador de inversionistas, y los reportes de mora no necesitan nada
 * de eso.
 */

// La paleta y el descargador del logo son compartidos con el Excel de
// inversionistas (ver excelBrand.ts). Se re-exporta para no romper importadores.
export { CASHIN_COLOR };

const FONT_NAME = "Inter";
/**
 * Tipografía uniforme (Excel no embebe fuentes; Inter es la que usa el reporte
 * de inversionistas como equivalente a Plus Jakarta Sans). Se aplica en la misma
 * pasada en que se pinta cada celda: antes había un segundo `eachRow/eachCell`
 * que recorría la hoja entera solo para poner el nombre de la fuente.
 */
const fuente = (f: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({
  name: FONT_NAME,
  size: 10,
  ...f,
});
const MONEY_FMT = `"Q"#,##0.00`;
const DATE_FMT = "dd/mm/yyyy";
const DATETIME_FMT = "dd/mm/yyyy hh:mm";

export type TipoColumnaReporte = "text" | "number" | "money" | "date" | "datetime";

export interface ColumnaReporte {
  /** Título que se pinta en la fila de encabezado. */
  header: string;
  /** Llave dentro de cada fila de datos. */
  key: string;
  /** Ancho sugerido; se ensancha solo si el encabezado no cabe. */
  width?: number;
  /** Formato/alineación de la columna. Por defecto "text". */
  type?: TipoColumnaReporte;
  /** Si true, la fila de totales suma esta columna. */
  total?: boolean;
}

export interface OpcionesReporteCashIn {
  /** Nombre de la pestaña. */
  sheetName: string;
  /** Título grande del reporte, ej. "Créditos con mora". */
  titulo: string;
  /** Línea secundaria opcional (cliente, filtros, número de crédito…). */
  subtitulo?: string;
  columnas: ColumnaReporte[];
  filas: Record<string, any>[];
  /** URL del logo; por defecto el isologo de R2 (EMAIL_ASSETS_BASE_URL). */
  logoUrl?: string;
  /** Agrega la fila de totales para las columnas marcadas con `total`. */
  conTotales?: boolean;
}

function logoPorDefecto(): string {
  const base =
    process.env.EMAIL_ASSETS_BASE_URL ||
    (import.meta as any).env?.EMAIL_ASSETS_BASE_URL;
  if (base) return `${base}/isologo-cashin.png`;
  return process.env.LOGO_URL || (import.meta as any).env?.LOGO_URL || "";
}

function toNumber(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/[Qq,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Devuelve un Date cuyos componentes UTC son la hora de GUATEMALA del instante.
 *
 * Excel no tiene zonas horarias: una celda de fecha es un número de serie con
 * la hora "de pared". ExcelJS arma ese serial con `getTime()`, es decir con los
 * componentes UTC del Date (verificado leyendo el XML: un Date de 05:59Z sale
 * como serial .2493 = 05:59). Guardando aquí el reloj de Guatemala en la parte
 * UTC, la celda imprime 23:59 del día anterior —lo que realmente pasó— y sigue
 * siendo una fecha de verdad para Excel (ordena, filtra, se le puede dar
 * formato), no un texto.
 *
 * `soloDia` (columnas `type: "date"`) trunca la hora a 00:00: una celda con
 * fracción de día NO la encuentran `=COUNTIF(…,"=08/09/2026")`, las tablas
 * dinámicas ni los SUMIFS por fecha, aunque la máscara dd/mm/yyyy la esconda.
 * Las columnas `datetime` sí conservan la hora, que es su razón de ser.
 */
function toDateGT(v: any, soloDia = false): Date | string | null {
  // Un "2026-09-09" pelado no es un instante, es un día: convertirlo movería la
  // fecha. Se escribe tal cual, a medianoche.
  if (typeof v === "string" && SOLO_FECHA.test(v.trim())) {
    return new Date(`${v.trim()}T00:00:00Z`);
  }

  const instante = aInstante(v);
  if (!instante) {
    // Si no parsea, devolvemos el original tal cual para no perder el dato.
    return v == null || v === "" ? null : String(v);
  }
  const p = partesGT(instante);
  if (soloDia) return new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`);
  return new Date(
    `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`
  );
}

/** Caracteres que ExcelJS rechaza en cualquier posición del nombre. */
const SHEET_NAME_PROHIBIDOS = /[*?:\\/\[\]]/g;
/** Comillas simples y espacios en los extremos: la comilla la rechaza ExcelJS. */
const SHEET_NAME_BORDES = /^[\s']+|[\s']+$/g;
/** Tope de ExcelJS, en unidades UTF-16 (es lo que mide con `.length`). */
const SHEET_NAME_MAX = 31;

/**
 * Recorta a `max` unidades UTF-16 sin partir un par subrogado por la mitad.
 *
 * Se mide en unidades UTF-16 y no en code points porque ese es el tope que
 * aplica ExcelJS (`name.length > 31`); contar code points podría dejar pasar un
 * nombre que él vuelve a truncar por su cuenta, y ese truncado sí parte pares.
 */
function recortarSinPartirSubrogado(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max);
  const ultimo = corte.charCodeAt(max - 1);
  // Un high surrogate al final se quedó sin su pareja: se cae con él.
  return ultimo >= 0xd800 && ultimo <= 0xdbff ? corte.slice(0, -1) : corte;
}

/**
 * Nombre de pestaña aceptable para Excel.
 *
 * ExcelJS rechaza `* ? : \ / [ ]`, la comilla simple en los extremos, el nombre
 * vacío y el literal reservado "History"; arriba de 31 caracteres trunca él
 * mismo. El historial de mora arma el nombre con el número SIFCO y el nombre
 * del cliente, que son texto libre: un "/" tumbaba la exportación con un 500.
 *
 * El orden es lo que hace la función correcta por construcción:
 * prohibidos → recorte → limpieza de bordes → guards. La limpieza de bordes va
 * DESPUÉS del recorte porque el recorte puede dejar de última una comilla que
 * era interna (ExcelJS: 500), y los guards van al final porque el resultado de
 * recortar y limpiar puede ser vacío o volverse "History".
 */
export function sanitizarSheetName(nombre?: string | null): string {
  const sinProhibidos = String(nombre ?? "").replace(SHEET_NAME_PROHIBIDOS, "-");
  // Se limpian los bordes también ANTES de recortar para no gastar los 31
  // caracteres en espacios o comillas de adorno del principio.
  const recortado = recortarSinPartirSubrogado(
    sinProhibidos.replace(SHEET_NAME_BORDES, ""),
    SHEET_NAME_MAX
  );
  // Segunda pasada: solo quita comillas y espacios (ambos BMP), así que no
  // puede volver a partir un par subrogado ni pasarse del tope.
  const limpio = recortado.replace(SHEET_NAME_BORDES, "");
  if (!limpio) return "Reporte";
  if (limpio.toLowerCase() === "history") return "Historial";
  return limpio;
}

/** Convierte índice de columna (1-based) a letra de Excel: 1→A, 27→AA. */
function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/**
 * Arma un workbook con el look CashIn. No decide qué columnas ni qué datos
 * lleva el reporte: eso lo define quien llama.
 */
export async function buildReporteCashInWorkbook(
  opts: OpcionesReporteCashIn
): Promise<Buffer> {
  const { sheetName, titulo, subtitulo, columnas, filas } = opts;
  const totalCols = Math.max(columnas.length, 1);

  // Se dispara YA y se espera recién al insertarlo: nada de lo que se arma
  // mientras tanto depende del logo, y la bajada puede tardar hasta 8 s.
  const logoPendiente = fetchImageBase64(opts.logoUrl ?? logoPorDefecto()).catch(
    () => null
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "Club Cashin.com";
  wb.created = new Date();

  const ws = wb.addWorksheet(sanitizarSheetName(sheetName), {
    properties: { defaultRowHeight: 16 },
  });

  // ── anchos: respetamos el sugerido pero sin cortar el encabezado
  columnas.forEach((c, i) => {
    const minimo = c.header.length + 4;
    ws.getColumn(i + 1).width = Math.max(c.width ?? 14, minimo);
  });

  // ── filas 1-2: cabecera blanca con logo + títulos
  ws.getRow(1).height = 42;
  ws.getRow(2).height = 22;
  ws.getRow(3).height = 18;

  const logoCols = Math.min(3, totalCols);
  const tituloCol = logoCols + 1;
  const hayEspacioParaTitulo = tituloCol <= totalCols;

  const tituloCell = ws.getCell(1, hayEspacioParaTitulo ? tituloCol : 1);
  tituloCell.value = titulo.toUpperCase();
  tituloCell.font = fuente({ bold: true, size: 16, color: { argb: CASHIN_COLOR.navy } });
  tituloCell.alignment = { horizontal: "center", vertical: "bottom" };
  if (hayEspacioParaTitulo) ws.mergeCells(1, tituloCol, 1, totalCols);

  if (subtitulo) {
    const subCell = ws.getCell(2, hayEspacioParaTitulo ? tituloCol : 1);
    subCell.value = subtitulo;
    subCell.font = fuente({ bold: true, size: 11, color: { argb: CASHIN_COLOR.purple } });
    subCell.alignment = { horizontal: "center", vertical: "middle" };
    if (hayEspacioParaTitulo) ws.mergeCells(2, tituloCol, 2, totalCols);
  }

  // ── fila 3: fecha de generación
  const fechaCell = ws.getCell(3, 1);
  fechaCell.value = `Generado el ${new Date().toLocaleDateString("es-GT", {
    timeZone: ZONA_GT,
    year: "numeric",
    month: "long",
    day: "numeric",
  })}`;
  fechaCell.font = fuente({ size: 9, color: { argb: CASHIN_COLOR.gray } });
  fechaCell.alignment = { horizontal: "right", vertical: "middle" };
  ws.mergeCells(3, 1, 3, totalCols);

  // ── fila 5: encabezado de tabla (la 4 queda de aire)
  const headerRowIdx = 5;
  const head = ws.getRow(headerRowIdx);
  head.height = 30;
  columnas.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = fuente({ bold: true, color: { argb: CASHIN_COLOR.text } });
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: CASHIN_COLOR.headBg },
    };
    cell.alignment = {
      horizontal:
        c.type === "money" || c.type === "number" ? "right" : "center",
      vertical: "middle",
      wrapText: true,
    };
    cell.border = {
      top: { style: "medium", color: { argb: CASHIN_COLOR.purple } },
      bottom: { style: "thin", color: { argb: CASHIN_COLOR.line } },
    };
  });

  // ── filas de datos
  const firstDataRow = headerRowIdx + 1;
  let row = headerRowIdx;

  filas.forEach((data, idx) => {
    row++;
    const rr = ws.getRow(row);
    columnas.forEach((c, i) => {
      const cell = rr.getCell(i + 1);
      const raw = data[c.key];
      cell.font = fuente();
      switch (c.type) {
        case "money":
          // Igual que `number`: un monto NULO deja la celda vacía. Escribir 0
          // lo volvía "Q0.00", indistinguible de un cero real, y encima entraba
          // en la fila de TOTAL.
          cell.value = raw == null || raw === "" ? null : toNumber(raw);
          cell.numFmt = MONEY_FMT;
          cell.alignment = { horizontal: "right", vertical: "middle" };
          break;
        case "number":
          cell.value = raw == null || raw === "" ? null : toNumber(raw);
          cell.alignment = { horizontal: "right", vertical: "middle" };
          break;
        case "date":
        case "datetime": {
          const d = toDateGT(raw, c.type === "date");
          cell.value = d as any;
          if (d instanceof Date) {
            cell.numFmt = c.type === "datetime" ? DATETIME_FMT : DATE_FMT;
          }
          cell.alignment = { horizontal: "center", vertical: "middle" };
          break;
        }
        default:
          cell.value =
            raw == null ? "" : typeof raw === "boolean" ? (raw ? "Sí" : "No") : raw;
          cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      }
      cell.border = { bottom: { style: "thin", color: { argb: CASHIN_COLOR.line } } };
      if (idx % 2 === 1) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: CASHIN_COLOR.zebra },
        };
      }
    });
  });

  const lastDataRow = row;

  if (filas.length === 0) {
    row++;
    ws.mergeCells(row, 1, row, totalCols);
    const vacio = ws.getCell(row, 1);
    vacio.value = "Sin registros para los filtros seleccionados";
    vacio.alignment = { horizontal: "center", vertical: "middle" };
    vacio.font = fuente({ italic: true, color: { argb: CASHIN_COLOR.gray } });
  }

  // ── fila de totales
  const colsConTotal = columnas
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.total);

  if (opts.conTotales && colsConTotal.length > 0 && filas.length > 0) {
    row++;
    const totalRow = ws.getRow(row);
    totalRow.getCell(1).value = "TOTAL";
    for (const { c, i } of colsConTotal) {
      const letra = colLetter(i + 1);
      const cell = totalRow.getCell(i + 1);
      cell.value = { formula: `SUM(${letra}${firstDataRow}:${letra}${lastDataRow})` };
      if (c.type === "money") cell.numFmt = MONEY_FMT;
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
    for (let ci = 1; ci <= totalCols; ci++) {
      const cell = totalRow.getCell(ci);
      cell.font = fuente({ bold: true, color: { argb: CASHIN_COLOR.white } });
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: CASHIN_COLOR.purple },
      };
      cell.border = {
        top: { style: "medium", color: { argb: CASHIN_COLOR.purple } },
        bottom: { style: "medium", color: { argb: CASHIN_COLOR.purple } },
      };
    }
  }

  // ── pie
  row += 2;
  ws.mergeCells(row, 1, row, totalCols);
  const pie = ws.getCell(row, 1);
  pie.value = `Generado por Club Cashin.com · ${new Date().toLocaleDateString(
    "es-GT",
    { timeZone: ZONA_GT }
  )} · Fechas en hora de Guatemala (GMT-6)`;
  pie.font = fuente({ color: { argb: CASHIN_COLOR.gray }, size: 9 });
  pie.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: CASHIN_COLOR.headBg },
  };

  // ── logo: se pidió al entrar a la función y recién ahora se espera. Si la red
  // falla el reporte igual sale, sin logo.
  try {
    const logo = await logoPendiente;
    if (logo) {
      ws.mergeCells(1, 1, 2, logoCols);
      const imgId = wb.addImage({ base64: logo.data, extension: logo.ext });
      ws.addImage(imgId, {
        tl: { col: 0.3, row: 0.2 } as any,
        ext: { width: 200, height: 54 },
      });
    }
  } catch (e) {
    console.error("No se pudo incrustar el logo en el Excel:", e);
  }

  // Encabezado congelado: al hacer scroll no se pierden los títulos.
  ws.views = [{ state: "frozen", ySplit: headerRowIdx }];

  const arr = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return Buffer.from(arr);
}
