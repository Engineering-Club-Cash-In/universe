import { describe, expect, it, mock } from "bun:test";
import { lockPoolMock } from "../utils/testMocks";

mock.module("../database", () => ({
  db: {},
  client: {},
  lockPool: lockPoolMock,
}));

const { isOverdueInstallmentForMora, decidirLimpiezaMoraTrasAplicar } =
  await import("./latefee");

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

  it("no cuenta como vencida la cuota que vence exactamente hoy", () => {
    const result = isOverdueInstallmentForMora(
      {
        fecha_vencimiento: new Date("2026-08-15T06:00:00.000Z"),
        pagado: false,
        hasPaidPayment: false,
        statusCredit: "ACTIVO",
      },
      new Date("2026-08-15T06:00:00.000Z"),
    );

    expect(result).toBe(false);
  });

  // Caso crédito 8685 (CRM-0f8a04b7): una boleta registrada pero aún pendiente
  // de validación por contabilidad NO protege la cuota. La mora que el cron
  // crea esa noche es correcta bajo la regla "solo cuenta lo validado"; el fix
  // va en la validación (desactivar al aplicar), no en este criterio.
  it("sigue contando como vencida una cuota con boleta registrada pero sin validar", () => {
    const result = isOverdueInstallmentForMora(
      {
        fecha_vencimiento: new Date("2026-07-15T06:00:00.000Z"),
        pagado: false,
        hasPaidPayment: false, // el EXISTS exige validated/no_required
        statusCredit: "ACTIVO",
      },
      new Date("2026-08-15T06:00:00.000Z"),
    );

    expect(result).toBe(true);
  });
});

describe("decidirLimpiezaMoraTrasAplicar", () => {
  it("desactiva la mora y baja a ACTIVO cuando el crédito MOROSO queda al día", () => {
    expect(
      decidirLimpiezaMoraTrasAplicar({
        cuotasVencidasRestantes: 0,
        capitalCredito: "114160.35",
        statusCredit: "MOROSO",
      }),
    ).toEqual({
      desactivarMora: true,
      bajarStatusAActivo: true,
      sinCapital: false,
    });
  });

  it("desactiva la mora sin tocar el status si el crédito no está MOROSO", () => {
    expect(
      decidirLimpiezaMoraTrasAplicar({
        cuotasVencidasRestantes: 0,
        capitalCredito: "114160.35",
        statusCredit: "ACTIVO",
      }),
    ).toEqual({
      desactivarMora: true,
      bajarStatusAActivo: false,
      sinCapital: false,
    });
  });

  it("no des-castiga un crédito INCOBRABLE aunque le apague la mora", () => {
    expect(
      decidirLimpiezaMoraTrasAplicar({
        cuotasVencidasRestantes: 0,
        capitalCredito: "114160.35",
        statusCredit: "INCOBRABLE",
      }),
    ).toEqual({
      desactivarMora: true,
      bajarStatusAActivo: false,
      sinCapital: false,
    });
  });

  it("no toca nada si aún quedan cuotas vencidas sin validar", () => {
    expect(
      decidirLimpiezaMoraTrasAplicar({
        cuotasVencidasRestantes: 1,
        capitalCredito: "114160.35",
        statusCredit: "MOROSO",
      }),
    ).toEqual({
      desactivarMora: false,
      bajarStatusAActivo: false,
      sinCapital: false,
    });
  });

  it("desactiva aunque queden vencidas si el capital llegó a 0 (espejo sinCapital del cron)", () => {
    expect(
      decidirLimpiezaMoraTrasAplicar({
        cuotasVencidasRestantes: 2,
        capitalCredito: "0.00",
        statusCredit: "MOROSO",
      }),
    ).toEqual({
      desactivarMora: true,
      bajarStatusAActivo: true,
      sinCapital: true,
    });
  });

  it("capital desconocido (null) no cuenta como sinCapital", () => {
    expect(
      decidirLimpiezaMoraTrasAplicar({
        cuotasVencidasRestantes: 1,
        capitalCredito: null,
        statusCredit: "MOROSO",
      }),
    ).toEqual({
      desactivarMora: false,
      bajarStatusAActivo: false,
      sinCapital: false,
    });
  });

  it("desactiva sin bajar status cuando el status es null", () => {
    expect(
      decidirLimpiezaMoraTrasAplicar({
        cuotasVencidasRestantes: 0,
        capitalCredito: "500.00",
        statusCredit: null,
      }),
    ).toEqual({
      desactivarMora: true,
      bajarStatusAActivo: false,
      sinCapital: false,
    });
  });
});
