import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Contrato SOBRE EL FUENTE: insertPayment es enorme y su base es global, así que la paridad con la plomería de
// `nexaPaymentEventId` (que ya llega a TODA fila que escribe una boleta) se fija leyendo el código. Es la red contra
// el fallo nº1 del plan: una fila sin marcar deja la condonación "huérfana" con el pago vivo.
const src = readFileSync(new URL("./registerPayment.ts", import.meta.url), "utf8");

function region(desde: string, hasta: string) {
  const i = src.indexOf(desde);
  if (i < 0) throw new Error(`Ancla inicial no encontrada: ${desde}`);
  const j = src.indexOf(hasta, i + desde.length);
  if (j < 0) throw new Error(`Ancla final no encontrada: ${hasta}`);
  return src.slice(i, j);
}
const insertPaymentSrc = region("export const insertPayment = async (", "export async function getPagosDelMesActual");
const paramsSrc = region("interface InsertarPagoParams {", "export async function insertarPago({");
const insertarPagoSrc = region("export async function insertarPago({", "export async function aplicarPagoAlCredito");
const cuenta = (texto: string, re: RegExp) => (texto.match(re) ?? []).length;

describe("insertPayment marca cada fila con boletaTardiaIntentoId", () => {
  test("paridad línea a línea con nexaPaymentEventId (desestructura + 5 insertarPago + pagoData + 2 inserts + capital)", () => {
    const nexa = cuenta(insertPaymentSrc, /^\s+nexaPaymentEventId,$/gm);
    const boleta = cuenta(insertPaymentSrc, /^\s+boletaTardiaIntentoId(,|: boletaTardiaIntentoId \?\? null,)$/gm);
    expect(nexa).toBeGreaterThanOrEqual(10);
    expect(boleta).toBe(nexa);
  });

  test("las opciones de insertPayment aceptan boletaTardiaIntentoId?: string", () => {
    expect(insertPaymentSrc).toContain("boletaTardiaIntentoId?: string;");
  });

  test("insertarPago lo recibe (interfaz), lo desestructura y lo escribe en la columna", () => {
    expect(paramsSrc).toContain("boletaTardiaIntentoId?: string;"); // interfaz InsertarPagoParams
    expect(insertarPagoSrc).toMatch(/^\s+boletaTardiaIntentoId,$/m); // desestructura
    expect(insertarPagoSrc).toMatch(/\.values\(\{[\s\S]*boletaTardiaIntentoId,[\s\S]*\}\)\s*\.returning\(\)/); // insert
  });

  test("pin de sitios de escritura: si alguien agrega un INSERT/UPDATE de pagos_credito, que revise si va marcado", () => {
    // Hoy: 3 inserts y 7 updates en insertPayment (ver la tabla de auditoría del plan). Si cambian, ¿la fila nueva
    // la escribe ESTA boleta? Entonces lleva boletaTardiaIntentoId; después actualizar este pin.
    expect(cuenta(insertPaymentSrc, /\.insert\(pagos_credito\)/g)).toBe(3);
    expect(cuenta(insertPaymentSrc, /\.update\(pagos_credito\)/g)).toBe(7);
  });

  test("cada llamada a insertarPago lleva ambos campos (5 llamadas)", () => {
    const llamadas = insertPaymentSrc.split("await insertarPago({").slice(1);
    expect(llamadas.length).toBe(5);
    for (const l of llamadas) {
      const cuerpo = l.slice(0, l.indexOf("\n        })") > 0 ? l.indexOf("});") : 2000);
      expect(cuerpo).toMatch(/nexaPaymentEventId,/);
      expect(cuerpo).toMatch(/boletaTardiaIntentoId,/);
    }
  });

  test("F3: la fila nace siempre paymentFalse=false (nunca hereda una anulada, con o sin intento)", () => {
    expect(insertPaymentSrc).toMatch(/paymentFalse: false, \/\/ `existingPago` siempre es viva/);
    expect(insertPaymentSrc).not.toContain("existingPago.pago.paymentFalse");
  });

  test("F4: pagoData escribe null explícito para borrar una marca vieja en el UPDATE de cierre", () => {
    expect(insertPaymentSrc).toContain("boletaTardiaIntentoId: boletaTardiaIntentoId ?? null,");
  });
});
