import { describe, expect, it } from "bun:test";
import {
  recomputeCreditAfterCapital,
  shouldIncobrableInstallmentBePaid,
} from "./registerPaymentPolicy";
import * as registerPaymentPolicy from "./registerPaymentPolicy";

describe("registerPaymentPolicy - integridad de cuotas abiertas", () => {
  it("detecta una cuota abierta que ya está cubierta por pagos validados vivos", () => {
    const detectarInconsistencia = Reflect.get(
      registerPaymentPolicy,
      "getCoveredOpenInstallment",
    );

    expect(detectarInconsistencia).toBeFunction();
    if (typeof detectarInconsistencia !== "function") return;

    expect(
      detectarInconsistencia({
        montoCuota: "100.00",
        cuotas: [
          {
            cuotaId: 20,
            numeroCuota: 3,
            pagos: [
              {
                pago_id: 30,
                validationStatus: "validated",
                paymentFalse: false,
                abono_capital: "80.00",
                abono_interes: "17.86",
                abono_iva_12: "2.14",
              },
            ],
          },
        ],
      }),
    ).toEqual({ cuotaId: 20, numeroCuota: 3 });
  });

  it("no bloquea varios pagos pending antes de validación", () => {
    expect(
      registerPaymentPolicy.getCoveredOpenInstallment({
        montoCuota: "100.00",
        cuotas: [
          {
            cuotaId: 20,
            numeroCuota: 3,
            pagos: [
              {
                validationStatus: "pending",
                paymentFalse: false,
                abono_capital: "60.00",
              },
              {
                validationStatus: "pending",
                paymentFalse: false,
                abono_capital: "40.00",
              },
            ],
          },
        ],
      }),
    ).toBeNull();
  });

  it("detecta cobertura repartida entre filas duplicadas de la misma cuota", () => {
    expect(
      registerPaymentPolicy.getCoveredOpenInstallment({
        montoCuota: "100.00",
        cuotas: [
          {
            cuotaId: 20,
            numeroCuota: 3,
            pagos: [
              {
                validationStatus: "validated",
                paymentFalse: false,
                abono_capital: "60.00",
              },
            ],
          },
          {
            cuotaId: 21,
            numeroCuota: 3,
            pagos: [
              {
                validationStatus: "validated",
                paymentFalse: false,
                abono_capital: "40.00",
              },
            ],
          },
        ],
      }),
    ).toEqual({ cuotaId: 20, numeroCuota: 3 });
  });
});

describe("registerPaymentPolicy - resumen de abonos de cuota", () => {
  const resumir = (
    input: Parameters<
      typeof registerPaymentPolicy.calcularResumenAbonosCuota
    >[0],
  ) => {
    const calcularResumen = Reflect.get(
      registerPaymentPolicy,
      "calcularResumenAbonosCuota",
    );
    expect(calcularResumen).toBeFunction();
    if (typeof calcularResumen !== "function") return;
    return calcularResumen(input);
  };

  it("un pago completo de una cuota cerrada no es abono parcial", () => {
    expect(
      resumir({
        montoCuota: "100.00",
        cuotaCerrada: true,
        pagos: [
          {
            validationStatus: "validated",
            paymentFalse: false,
            abono_capital: "80.00",
            abono_interes: "17.86",
            abono_iva_12: "2.14",
          },
        ],
      }),
    ).toEqual({
      cuotaCerrada: true,
      totalAplicadoCuota: "100.00",
      saldoPendiente: "0.00",
      tieneAbonoParcial: false,
    });
  });

  it("una cuota abierta parcialmente cubierta sí tiene abono parcial", () => {
    expect(
      resumir({
        montoCuota: "100.00",
        cuotaCerrada: false,
        pagos: [
          {
            validationStatus: "pending",
            paymentFalse: false,
            abono_capital: "40.00",
          },
        ],
      }),
    ).toEqual({
      cuotaCerrada: false,
      totalAplicadoCuota: "40.00",
      saldoPendiente: "60.00",
      tieneAbonoParcial: true,
    });
  });

  it("un placeholder en cero no es abono parcial", () => {
    expect(
      resumir({
        montoCuota: "100.00",
        cuotaCerrada: false,
        pagos: [
          {
            validationStatus: "no_required",
            paymentFalse: false,
            abono_capital: "0",
          },
        ],
      }),
    ).toEqual({
      cuotaCerrada: false,
      totalAplicadoCuota: "0.00",
      saldoPendiente: "100.00",
      tieneAbonoParcial: false,
    });
  });

  it("excluye mora, otros, convenio y abono directo a capital", () => {
    expect(
      resumir({
        montoCuota: "100.00",
        cuotaCerrada: false,
        pagos: [
          {
            validationStatus: "validated",
            paymentFalse: false,
            abono_interes: "20.00",
          },
          {
            validationStatus: "validated",
            paymentFalse: false,
            mora: "100.00",
            otros: "200.00",
            pagoConvenio: "300.00",
          },
          {
            validationStatus: "capital_validated",
            paymentFalse: false,
            abono_capital: "500.00",
          },
        ],
      }),
    ).toEqual({
      cuotaCerrada: false,
      totalAplicadoCuota: "20.00",
      saldoPendiente: "80.00",
      tieneAbonoParcial: true,
    });
  });
});

describe("registerPaymentPolicy - shouldIncobrableInstallmentBePaid", () => {
  it("no aplica (null) cuando el crédito no es incobrable", () => {
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "ACTIVO",
        capital: "7744.11",
        abonoCapital: "7744.11",
      }),
    ).toBeNull();
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "MOROSO",
        capital: "1000",
        abonoCapital: "1000",
      }),
    ).toBeNull();
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: null,
        capital: "0",
        abonoCapital: "0",
      }),
    ).toBeNull();
  });

  it("marca la cuota pagada cuando el capital llega a 0 con este abono", () => {
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "INCOBRABLE",
        capital: "2373.14",
        abonoCapital: "2373.14",
      }),
    ).toBeTrue();
  });

  it("deja la cuota pendiente si aún queda capital por recuperar", () => {
    // crédito 23: capital 7744.11, recupera un parcial de 2373.14 → falta
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "INCOBRABLE",
        capital: "7744.11",
        abonoCapital: "2373.14",
      }),
    ).toBeFalse();
  });

  it("tolera redondeos de hasta un centavo", () => {
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "INCOBRABLE",
        capital: "7744.11",
        abonoCapital: "7744.10",
      }),
    ).toBeTrue(); // queda 0.01, dentro de tolerancia
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "INCOBRABLE",
        capital: "7744.13",
        abonoCapital: "7744.10",
      }),
    ).toBeFalse(); // queda 0.03, fuera de tolerancia
  });

  it("cierra la cuota aunque el capital quede levemente negativo (sobre-recuperación)", () => {
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "INCOBRABLE",
        capital: "100",
        abonoCapital: "150",
      }),
    ).toBeTrue();
  });

  it("trata montos nulos como 0 sin reventar", () => {
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "INCOBRABLE",
        capital: null,
        abonoCapital: null,
      }),
    ).toBeTrue(); // 0 - 0 = 0 ≤ tolerancia
  });
});

describe("recomputeCreditAfterCapital", () => {
  it("crédito normal: recalcula interés/IVA sobre el porcentaje", () => {
    const r = recomputeCreditAfterCapital({
      statusCredit: "ACTIVO",
      newCapital: "10000",
      porcentajeInteres: "1.5",
    });
    expect(r.capital.toString()).toBe("10000");
    expect(r.cuotaInteres.toString()).toBe("150"); // 10000 * 1.5%
    expect(r.iva.toString()).toBe("18"); // 150 * 0.12
    expect(r.deudaTotal.toString()).toBe("10168");
  });

  it("INCOBRABLE: NO devenga interés aunque tenga porcentaje_interes>0", () => {
    const r = recomputeCreditAfterCapital({
      statusCredit: "INCOBRABLE",
      newCapital: "7744.11",
      porcentajeInteres: "1.5", // preservado del castigo, NO debe revivir
    });
    expect(r.cuotaInteres.toString()).toBe("0");
    expect(r.iva.toString()).toBe("0");
    expect(r.capital.toString()).toBe("7744.11");
    expect(r.deudaTotal.toString()).toBe("7744.11");
  });

  it("clampa el capital a 0 en sobre-recuperación (no queda negativo)", () => {
    const r = recomputeCreditAfterCapital({
      statusCredit: "INCOBRABLE",
      newCapital: "-50", // capital 100 - abono 150
      porcentajeInteres: "1.5",
    });
    expect(r.capital.toString()).toBe("0");
    expect(r.cuotaInteres.toString()).toBe("0");
    expect(r.deudaTotal.toString()).toBe("0");
  });

  it("suma seguro/gps/membresías a la deuda total", () => {
    const r = recomputeCreditAfterCapital({
      statusCredit: "ACTIVO",
      newCapital: "1000",
      porcentajeInteres: "0",
      seguro: "30",
      gps: "20",
      membresias: "10",
    });
    expect(r.deudaTotal.toString()).toBe("1060");
  });
});
