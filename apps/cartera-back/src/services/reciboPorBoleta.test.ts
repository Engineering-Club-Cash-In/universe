import { describe, expect, test } from "bun:test";
import { conTurnoDeRecibo, enviarPorBoleta } from "./reciboPorBoleta";

function deps(boletas: Record<number, { comprobante: number; completa: boolean }>) {
  const enviados: number[] = [];
  return {
    enviados,
    d: {
      boletaDe: async (pagoId: number) => boletas[pagoId]!,
      enviar: async (pagoId: number) => {
        enviados.push(pagoId);
        return { success: true, message: "ok" };
      },
    },
  };
}

describe("un recibo por boleta", () => {
  test("las filas de una misma boleta mandan un solo recibo y comparten el resultado", async () => {
    const { d, enviados } = deps({
      17: { comprobante: 17, completa: true },
      18: { comprobante: 17, completa: true },
      30: { comprobante: 30, completa: true },
    });
    const r = await enviarPorBoleta({ pagoIds: [17, 18, 30] }, d);
    expect(enviados).toEqual([17, 30]);
    expect(r.map((x) => x.success)).toEqual([true, true, true]);
  });

  test("con conta validando fila por fila, solo la última fila de la boleta manda el recibo", async () => {
    const primera = deps({ 17: { comprobante: 17, completa: false } });
    await enviarPorBoleta({ pagoIds: [17], soloBoletasCompletas: true }, primera.d);
    expect(primera.enviados).toEqual([]);
    const ultima = deps({ 18: { comprobante: 17, completa: true } });
    await enviarPorBoleta({ pagoIds: [18], soloBoletasCompletas: true }, ultima.d);
    expect(ultima.enviados).toEqual([18]);
  });
});

test("no genera más de 2 recibos (Chromium) a la vez", async () => {
  let activos = 0;
  let maximo = 0;
  const trabajo = () =>
    conTurnoDeRecibo(async () => {
      activos += 1;
      maximo = Math.max(maximo, activos);
      await new Promise((r) => setTimeout(r, 10));
      activos -= 1;
    });
  await Promise.all(Array.from({ length: 6 }, trabajo));
  expect(maximo).toBe(2);
});
