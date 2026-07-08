import { describe, expect, it, mock } from "bun:test";

mock.module("../database", () => ({
  db: {},
  client: {},
}));

const { isOverdueInstallmentForMora, elegirAsesorParaBucket } = await import("./latefee");

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

// FASE 3 (COBROS-02) — reparto de asesor al entrar a un bucket
describe("elegirAsesorParaBucket", () => {
  it("pool vacío → null (el crédito conserva su asesor)", () => {
    expect(elegirAsesorParaBucket([], new Map(), 7)).toBeNull();
  });

  it("bucket con 1 solo asesor → asignación directa", () => {
    expect(elegirAsesorParaBucket([4], new Map(), 7)).toBe(4);
  });

  it("el asesor actual ya es elegible en el destino → se queda (sin churn)", () => {
    const carga = new Map([
      [3, 50],
      [9, 0],
    ]);
    // aunque el 9 tenga menos carga, el 3 ya lleva el crédito y es elegible
    expect(elegirAsesorParaBucket([3, 9], carga, 3)).toBe(3);
  });

  it("N asesores → gana el de MENOR carga (equitativo)", () => {
    const carga = new Map([
      [3, 10],
      [9, 4],
    ]);
    expect(elegirAsesorParaBucket([3, 9], carga, 7)).toBe(9);
  });

  it("empate de carga → gana el menor asesor_id (determinístico)", () => {
    const carga = new Map([
      [9, 5],
      [3, 5],
    ]);
    expect(elegirAsesorParaBucket([9, 3], carga, 7)).toBe(3);
  });

  it("sin mapa de carga → todos cuentan 0 y gana el menor asesor_id", () => {
    expect(elegirAsesorParaBucket([9, 3], undefined, null)).toBe(3);
  });

  it("asesor sin entrada en el mapa de carga cuenta como 0", () => {
    const carga = new Map([[3, 2]]); // el 9 no aparece → carga 0
    expect(elegirAsesorParaBucket([3, 9], carga, null)).toBe(9);
  });
});
