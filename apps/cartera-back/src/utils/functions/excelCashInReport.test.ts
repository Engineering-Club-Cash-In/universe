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

/** Un subrogado sin su pareja: la marca de haber partido un carácter al recortar. */
const subrogadoSuelto =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

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

  it("la comilla que el recorte deja al final se limpia (antes: 500 de ExcelJS)", () => {
    // La comilla cae justo en el índice 30: era interna cuando se limpiaban los
    // bordes, y quedaba de última recién después del recorte. ExcelJS rechaza
    // un nombre que termina en comilla simple.
    const alBorde = `Historial ${"0".repeat(20)}'resto`;
    expect(sanitizarSheetName(alBorde)).toBe(`Historial ${"0".repeat(20)}`);
    // Invariante, no un caso puntual: ningún nombre sale con comilla en los extremos.
    for (let i = 0; i < 40; i++) {
      const salida = sanitizarSheetName(`${"a".repeat(i)}'${"b".repeat(40)}`);
      expect(salida.startsWith("'")).toBe(false);
      expect(salida.endsWith("'")).toBe(false);
    }
  });

  it("si el recorte lo deja en puras comillas, cae al fallback y no a cadena vacía", () => {
    // El guard de vacío tiene que correr sobre el resultado final: una cadena
    // vacía también la rechaza ExcelJS ("The name can't be empty").
    expect(sanitizarSheetName("'".repeat(40))).toBe("Reporte");
    expect(sanitizarSheetName(`${"'".repeat(31)} `)).toBe("Reporte");
  });

  it("atrapa 'History' aunque aparezca recién después de limpiar los bordes", () => {
    // ExcelJS reserva el literal: el guard corre al final, sobre el resultado ya
    // transformado, no sobre la entrada cruda.
    expect(sanitizarSheetName("'History'")).toBe("Historial");
    expect(sanitizarSheetName("  History  ")).toBe("Historial");
    expect(sanitizarSheetName("'HISTORY'")).toBe("Historial");
  });

  it("recorta por code points: no parte un par subrogado a la mitad", () => {
    // El nombre sale del número SIFCO y del nombre del cliente: texto libre.
    const soloEmojis = sanitizarSheetName("\u{1F44D}".repeat(20));
    expect(soloEmojis.length).toBeLessThanOrEqual(31);
    expect(subrogadoSuelto.test(soloEmojis)).toBe(false);
    expect(soloEmojis).toBe("\u{1F44D}".repeat(15));

    // El par arranca justo en el índice 30, así que el corte crudo lo partía.
    const alBorde = sanitizarSheetName(`${"x".repeat(30)}\u{1F44D}y`);
    expect(subrogadoSuelto.test(alBorde)).toBe(false);
    expect(alBorde).toBe("x".repeat(30));
  });

  it("nunca pasa de 31 unidades: ExcelJS no llega a truncar por su cuenta", () => {
    // Si ExcelJS trunca él mismo, su chequeo de comillas ya corrió sobre el
    // nombre largo y puede dejar la pestaña terminada en comilla igual.
    for (const entrada of [
      "x".repeat(60),
      "\u{1F44D}".repeat(20),
      `Historial ${"0".repeat(20)}'resto`,
      `${"á".repeat(40)}`,
    ]) {
      expect(sanitizarSheetName(entrada).length).toBeLessThanOrEqual(31);
    }
  });

  it("el workbook se genera con un nombre que trae comilla y emoji (antes: 500)", async () => {
    const ws = await construirYLeer({
      sheetName: `Historial ${"0".repeat(20)}'resto`,
      columnas: [{ header: "ID", key: "id", type: "number" }],
      filas: [{ id: 1 }],
    });
    expect(ws.name).toBe(`Historial ${"0".repeat(20)}`);

    const wsEmoji = await construirYLeer({
      sheetName: "\u{1F44D}".repeat(20),
      columnas: [{ header: "ID", key: "id", type: "number" }],
      filas: [{ id: 1 }],
    });
    // Con el subrogado suelto el nombre volvía del archivo con U+FFFD.
    expect(wsEmoji.name).toBe("\u{1F44D}".repeat(15));
    expect(wsEmoji.name).not.toContain("�");
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
