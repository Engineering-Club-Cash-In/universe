import "../utils/baseFalsaParaPruebas";
import { describe, expect, it } from "bun:test";
import { contarCuotasQueVencenHoy, hoyGuatemala } from "./latefee";

// 30-sep-2026 al mediodía en Guatemala.
const hoy = hoyGuatemala(new Date("2026-09-30T18:00:00Z"));
const cuota = (fecha_vencimiento: string, hasPaidPayment = false) => ({
  fecha_vencimiento,
  pagado: false,
  hasPaidPayment,
});

describe("contarCuotasQueVencenHoy: mismo criterio que el cron", () => {
  it("cuota que vence hoy, sin pagar → cuenta", () => {
    expect(contarCuotasQueVencenHoy([cuota("2026-09-30")], hoy, "ACTIVO")).toBe(1);
  });
  it("con un pago ya validado → no cuenta", () => {
    expect(contarCuotasQueVencenHoy([cuota("2026-09-30", true)], hoy, "ACTIVO")).toBe(0);
  });
  it("crédito EN_CONVENIO → no cuenta", () => {
    expect(contarCuotasQueVencenHoy([cuota("2026-09-30")], hoy, "EN_CONVENIO")).toBe(0);
  });
  it("venció ayer o vence mañana → no cuenta", () => {
    expect(contarCuotasQueVencenHoy([cuota("2026-09-29"), cuota("2026-10-01")], hoy, "ACTIVO")).toBe(0);
  });
});
