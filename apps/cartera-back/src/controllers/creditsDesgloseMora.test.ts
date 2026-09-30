import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// El detalle del crédito explica su mora con el MISMO cargador del cron.
const fuente = readFileSync(new URL("./credits.ts", import.meta.url), "utf8");

describe("getCreditoByNumero devuelve el desglose de la mora", () => {
  test("se arma con el cargador del cron y marca las cuotas en validación", () => {
    expect(fuente).toMatch(/cuotasParaPendienteDeCreditos\(\[creditoId\], db, hoyGT\)/);
    expect(fuente).toContain("numerosEnValidacion: new Set(cuotasEnValidacion.map((c) => c.numero_cuota))");
  });
  test("va en las dos respuestas (con y sin convenio)", () => {
    expect((fuente.match(/^\s+desgloseMora,$/gm) ?? []).length).toBe(2);
  });
  test("usa contarCuotasQueVencenHoy con hasPaidPayment en la query (criterio del cron)", () => {
    expect(fuente).toContain("contarCuotasQueVencenHoy(");
    expect(fuente).toContain("hasPaidPayment: hasPaidPaymentSql()");
    expect(fuente).toMatch(/numerosEnValidacion: [^\n]+\n\s+cuotasQueVencenHoy,/);
  });
  test("moraPagada/condonada incluyen las cuotas del desglose (y conservan las atrasadas)", () => {
    // Solo con `cuotasAtrasadas` (que excluye las cuotas con boleta sin
    // validar) lo abonado a una cuota en validación salía en el desglose pero
    // no en `moraPagada`. Solo con `cargadas`, un crédito EN_CONVENIO o
    // INCOBRABLE dejaba de mostrar lo ya pagado.
    const llamada = fuente.match(/moraAbonadaPorOrigen\(\s*([^\n]+)\n/)?.[1] ?? "";
    expect(llamada).toContain("cargadas.map((c) => c.cuota_id)");
    expect(llamada).toContain("cuotasAtrasadas.map((c) => c.cuota_id)");
    expect(fuente).toMatch(/construirDesgloseMora\(\{[\s\S]*?cuotas: cargadas\.map\(/);
  });
});
