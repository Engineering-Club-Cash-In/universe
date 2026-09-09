import { describe, expect, it } from "bun:test";
import ExcelJS from "exceljs";
import {
  buildReporteCashInWorkbook,
  sanitizarSheetName,
  type ColumnaReporte,
} from "./excelCashInReport";

// ─────────────────────────────────────────────────────────────────────────────
// Excel genérico de los reportes de mora. Se construye el archivo de verdad y se
// vuelve a leer con ExcelJS: la evidencia es la celda, no la intención.
//
// `logoUrl: ""` corta la bajada del isologo (fetchImageBase64 devuelve null sin
// tocar la red), así que los tests no dependen de R2.
// ─────────────────────────────────────────────────────────────────────────────

const HEADER_ROW = 5;
const FIRST_DATA_ROW = 6;

async function construirYLeer(opts: {
  sheetName?: string;
  columnas: ColumnaReporte[];
  filas: Record<string, any>[];
  conTotales?: boolean;
}) {
  const buf = await buildReporteCashInWorkbook({
    sheetName: opts.sheetName ?? "Prueba",
    titulo: "Reporte de prueba",
    columnas: opts.columnas,
    filas: opts.filas,
    conTotales: opts.conTotales,
    logoUrl: "",
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  return wb.worksheets[0];
}

describe("columnas type: date — sin hora pegada", () => {
  it("una fecha con hora queda a las 00:00 (si no, COUNTIF por fecha da 0)", async () => {
    const ws = await construirYLeer({
      columnas: [
        { header: "Fecha", key: "f", type: "date" },
        { header: "Fecha y hora", key: "f", type: "datetime" },
      ],
      // 2026-09-09 05:59 UTC = 2026-09-08 23:59 en Guatemala.
      filas: [{ f: "2026-09-09 05:59:05.245566" }],
    });

    const soloDia = ws.getCell(FIRST_DATA_ROW, 1).value as Date;
    expect(soloDia instanceof Date).toBe(true);
    expect(soloDia.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    // El serial de Excel no puede tener parte fraccionaria: eso es lo que rompía
    // =COUNTIF(...,"=08/09/2026"), las tablas dinámicas y los SUMIFS por fecha.
    expect(soloDia.getTime() % 86_400_000).toBe(0);

    // La columna datetime SÍ conserva la hora de Guatemala: es su razón de ser.
    const conHora = ws.getCell(FIRST_DATA_ROW, 2).value as Date;
    expect(conHora.toISOString()).toBe("2026-09-08T23:59:05.000Z");
  });

  it("un 'YYYY-MM-DD' pelado sigue escribiéndose tal cual", async () => {
    const ws = await construirYLeer({
      columnas: [{ header: "Fecha", key: "f", type: "date" }],
      filas: [{ f: "2026-09-09" }],
    });
    expect((ws.getCell(FIRST_DATA_ROW, 1).value as Date).toISOString()).toBe(
      "2026-09-09T00:00:00.000Z"
    );
  });
});

describe("columnas type: money — un nulo NO es un cero", () => {
  it("deja la celda vacía y no la suma en el TOTAL", async () => {
    const ws = await construirYLeer({
      columnas: [
        { header: "Monto", key: "m", type: "money", total: true },
        { header: "Cantidad", key: "m", type: "number" },
      ],
      filas: [{ m: "100.50" }, { m: null }, { m: 0 }],
      conTotales: true,
    });

    expect(ws.getCell(FIRST_DATA_ROW, 1).value).toBe(100.5);
    // Antes salía 0 → "Q0.00", indistinguible del cero real de la fila 3.
    expect(ws.getCell(FIRST_DATA_ROW + 1, 1).value).toBeNull();
    expect(ws.getCell(FIRST_DATA_ROW + 2, 1).value).toBe(0);
    // Misma distinción que ya hacía la columna `number` de al lado.
    expect(ws.getCell(FIRST_DATA_ROW + 1, 2).value).toBeNull();

    // La fila de TOTAL suma el rango: con la celda vacía, SUM ignora el nulo.
    const total = ws.getCell(FIRST_DATA_ROW + 3, 1).value as any;
    expect(total.formula).toBe(`SUM(A${FIRST_DATA_ROW}:A${FIRST_DATA_ROW + 2})`);
  });
});

describe("sanitizarSheetName", () => {
  it("reemplaza los caracteres que ExcelJS prohíbe", () => {
    expect(sanitizarSheetName("Historial 010/214/1240")).toBe("Historial 010-214-1240");
    expect(sanitizarSheetName("a*b?c:d\\e/f[g]h")).toBe("a-b-c-d-e-f-g-h");
  });

  it("cubre el nombre vacío y el literal reservado 'History'", () => {
    expect(sanitizarSheetName("")).toBe("Reporte");
    expect(sanitizarSheetName("   ")).toBe("Reporte");
    expect(sanitizarSheetName(null)).toBe("Reporte");
    expect(sanitizarSheetName("History")).toBe("Historial");
    expect(sanitizarSheetName("history")).toBe("Historial");
  });

  it("topa en 31 caracteres", () => {
    expect(sanitizarSheetName("x".repeat(60)).length).toBe(31);
  });

  it("el workbook se genera aunque el número SIFCO traiga '/' (antes: 500)", async () => {
    const ws = await construirYLeer({
      sheetName: "Historial 01010/214124060",
      columnas: [{ header: "ID", key: "id", type: "number" }],
      filas: [{ id: 1 }],
    });
    expect(ws.name).toBe("Historial 01010-214124060");
    expect(ws.getCell(FIRST_DATA_ROW, 1).value).toBe(1);
  });
});

describe("tipografía", () => {
  it("se aplica en la misma pasada en que se pinta la celda", async () => {
    const ws = await construirYLeer({
      columnas: [{ header: "Texto", key: "t" }],
      filas: [{ t: "hola" }],
    });
    expect(ws.getCell(HEADER_ROW, 1).font?.name).toBe("Inter");
    expect(ws.getCell(FIRST_DATA_ROW, 1).font?.name).toBe("Inter");
  });
});
