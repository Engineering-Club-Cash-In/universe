import { describe, expect, test } from "bun:test";
import { fechaLarga, htmlReciboPago, medioDePago, type DatosReciboPago } from "./reciboPagoHtml";

const base: DatosReciboPago = {
  pagoId: 151515,
  montoBoleta: 600,
  montoAplicado: 600,
  mora: 0,
  otros: 0,
  fechaPago: "2026-08-02 10:15:00",
  origenPago: "transferencia",
  referencia: "TRX-0151515",
  clienteNombre: "Omar Cardoza Estrada",
  clienteNit: "41933052",
  numeroCreditoSifco: "01010214100000",
  numeroCuota: 12,
  plazo: 36,
  proximoPago: { fecha: "2026-09-02", monto: 600, numeroCuota: 13 },
  observaciones: null,
  generadoEl: "12 de agosto de 2026, 09:11 p. m.",
};

describe("htmlReciboPago", () => {
  test("lleva lo del diseño y nada del desglose de capital/interés", () => {
    const html = htmlReciboPago(base);
    expect(html).toContain("Recibo de pago");
    expect(html).toContain("No. 151515");
    expect(html).toContain("2 de agosto de 2026 · Transferencia");
    expect(html).toContain("12 de 36");
    expect(html).toContain("Monto aplicado");
    expect(html).toContain("2 de septiembre de 2026");
    expect(html).toContain("Cuota 13 de 36");
    expect(html).toContain("TRX-0151515");
    expect(html).not.toContain("Intereses");
    expect(html).not.toContain("El pago incluye");
  });

  test("mora y otros solo aparecen si tienen monto", () => {
    const html = htmlReciboPago({ ...base, mora: 40, otros: 0 });
    expect(html).toContain("El pago incluye");
    expect(html).toContain("Q40.00");
    expect(html).not.toContain("Otros cargos");
  });

  test("sin cuotas pendientes y textos escapados", () => {
    const html = htmlReciboPago({ ...base, proximoPago: null, clienteNombre: "<b>Ana</b>" });
    expect(html).toContain("Sin cuotas pendientes");
    expect(html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
  });
});

describe("helpers", () => {
  test("fechaLarga no corre el día por zona horaria", () => {
    expect(fechaLarga("2026-09-01")).toBe("1 de septiembre de 2026");
    expect(fechaLarga(null)).toBe("—");
  });
  test("medioDePago", () => {
    expect(medioDePago("boleta")).toBe("Depósito");
    expect(medioDePago(null)).toBe("—");
  });
});
