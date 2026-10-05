import axios from "axios";

/**
 * Identidad visual compartida de los Excel de CashIn.
 *
 * Vivía duplicada: `CINV` dentro de `buildInversionistaWorkbook`
 * (generalFunctions.ts) y `CASHIN_COLOR` en `excelCashInReport.ts`, con 9 de 10
 * valores hex idénticos y dos `fetchImageBase64` gemelos. Este módulo es la
 * única definición; a propósito no importa nada pesado (ni exceljs ni
 * puppeteer) para que cualquiera de los dos lo pueda usar.
 */
export const CASHIN_COLOR = {
  purple: "FF4E57EA",
  purpleLight: "FFF0F0FF",
  navy: "FF0F1B4C",
  blue: "FF0485C2",
  text: "FF0F172A",
  slate: "FF334155",
  white: "FFFFFFFF",
  line: "FFE0E7EF",
  zebra: "FFF9FBFF",
  total: "FFF0F9FF",
  headBg: "FFF3F3F3",
  gray: "FF8C98B5",
  /** Resalte para filas con interés "partido" (cálculo dividido por compras). */
  partido: "FFFEF3C7",
} as const;

/**
 * Trae una imagen como base64. Nunca lanza: si falla, el reporte sale sin logo.
 * El timeout evita que un R2 lento cuelgue la generación del archivo.
 */
export async function fetchImageBase64(
  url?: string,
  timeoutMs = 8000
): Promise<{ data: string; ext: "png" | "jpeg" } | null> {
  if (!url) return null;
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: timeoutMs,
    });
    const ct = String(res.headers["content-type"] || "");
    const ext: "png" | "jpeg" = ct.includes("png") ? "png" : "jpeg";
    return { data: Buffer.from(res.data).toString("base64"), ext };
  } catch {
    return null;
  }
}
