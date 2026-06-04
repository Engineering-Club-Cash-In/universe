import { describe, expect, it, mock } from "bun:test";

mock.module("../database", () => ({
  db: {},
}));

const { isOverdueInstallmentForMora } = await import("./latefee");

describe("isOverdueInstallmentForMora", () => {
  it("no cuenta como vencida una cuota con pago asociado ya pagado", () => {
    const result = isOverdueInstallmentForMora(
      {
        fecha_vencimiento: new Date("2026-05-15T06:00:00.000Z"),
        pagado: false,
        hasPaidPayment: true,
        statusCredit: "MOROSO",
      },
      new Date("2026-05-26T06:00:00.000Z"),
    );

    expect(result).toBe(false);
  });

  it("cuenta como vencida una cuota pasada sin cuota pagada ni pago asociado pagado", () => {
    const result = isOverdueInstallmentForMora(
      {
        fecha_vencimiento: new Date("2026-05-15T06:00:00.000Z"),
        pagado: false,
        hasPaidPayment: false,
        statusCredit: "ACTIVO",
      },
      new Date("2026-05-26T06:00:00.000Z"),
    );

    expect(result).toBe(true);
  });

  it("no cuenta cuotas futuras como vencidas", () => {
    const result = isOverdueInstallmentForMora(
      {
        fecha_vencimiento: new Date("2026-06-15T06:00:00.000Z"),
        pagado: false,
        hasPaidPayment: false,
        statusCredit: "ACTIVO",
      },
      new Date("2026-05-26T06:00:00.000Z"),
    );

    expect(result).toBe(false);
  });
});
