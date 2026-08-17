import { describe, expect, it, mock } from "bun:test";

mock.module("../database", () => ({
  db: {},
  client: {},
}));

const latefeeModule = await import("./latefee");
const { isOverdueInstallmentForMora } = latefeeModule;

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
  const decidir = () => {
    const fn = Reflect.get(latefeeModule, "decidirLimpiezaMoraTrasAplicar");
    expect(fn).toBeFunction();
    return fn as (params: {
      cuotasVencidasRestantes: number;
      tieneMoraActiva: boolean;
      statusCredit: string | null;
    }) => { desactivarMora: boolean; bajarStatusAActivo: boolean };
  };

  it("desactiva la mora y baja a ACTIVO cuando el crédito MOROSO queda al día", () => {
    expect(
      decidir()({
        cuotasVencidasRestantes: 0,
        tieneMoraActiva: true,
        statusCredit: "MOROSO",
      }),
    ).toEqual({ desactivarMora: true, bajarStatusAActivo: true });
  });

  it("desactiva la mora sin tocar el status si el crédito no está MOROSO", () => {
    expect(
      decidir()({
        cuotasVencidasRestantes: 0,
        tieneMoraActiva: true,
        statusCredit: "ACTIVO",
      }),
    ).toEqual({ desactivarMora: true, bajarStatusAActivo: false });
  });

  it("no des-castiga un crédito INCOBRABLE aunque le apague la mora", () => {
    expect(
      decidir()({
        cuotasVencidasRestantes: 0,
        tieneMoraActiva: true,
        statusCredit: "INCOBRABLE",
      }),
    ).toEqual({ desactivarMora: true, bajarStatusAActivo: false });
  });

  it("no toca nada si aún quedan cuotas vencidas sin validar", () => {
    expect(
      decidir()({
        cuotasVencidasRestantes: 1,
        tieneMoraActiva: true,
        statusCredit: "MOROSO",
      }),
    ).toEqual({ desactivarMora: false, bajarStatusAActivo: false });
  });

  it("no toca nada si el crédito no tiene mora activa (espejo del cron)", () => {
    expect(
      decidir()({
        cuotasVencidasRestantes: 0,
        tieneMoraActiva: false,
        statusCredit: "MOROSO",
      }),
    ).toEqual({ desactivarMora: false, bajarStatusAActivo: false });
  });

  it("desactiva sin bajar status cuando el status es null", () => {
    expect(
      decidir()({
        cuotasVencidasRestantes: 0,
        tieneMoraActiva: true,
        statusCredit: null,
      }),
    ).toEqual({ desactivarMora: true, bajarStatusAActivo: false });
  });
});
