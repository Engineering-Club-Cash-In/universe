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

  it("sigue detectando la inconsistencia con el escenario del insoluto (crédito normal)", () => {
    expect(
      registerPaymentPolicy.getCoveredOpenInstallment({
        montoCuota: "3750.00",
        cuotas: [
          {
            cuotaId: 40,
            numeroCuota: 1,
            pagos: [
              {
                pago_id: 50,
                validationStatus: "validated",
                paymentFalse: false,
                abono_capital: "3750.00",
              },
            ],
          },
        ],
      }),
    ).toEqual({ cuotaId: 40, numeroCuota: 1 });
  });
});

describe("registerPaymentPolicy - cuotas cubiertas de INCOBRABLES", () => {
  // Caso real crédito 9272 (cuota contractual 3750): la cuota 1 quedó cubierta
  // por un pago validated, las 2-4 sólo tienen el recibo no_required.
  it("lista la cuota cubierta por un pago validated", () => {
    expect([
      ...registerPaymentPolicy.getCoveredInstallmentNumbers({
        montoCuota: "3750.00",
        cuotas: [
          {
            cuotaId: 40,
            numeroCuota: 1,
            pagos: [
              {
                pago_id: 50,
                validationStatus: "validated",
                paymentFalse: false,
                abono_capital: "3750.00",
              },
            ],
          },
          {
            cuotaId: 41,
            numeroCuota: 2,
            pagos: [
              {
                pago_id: 51,
                validationStatus: "no_required",
                paymentFalse: false,
                abono_capital: "0.00",
              },
            ],
          },
        ],
      }),
    ]).toEqual([1]);
  });

  it("no lista una cuota con abono parcial que no la cubre", () => {
    expect([
      ...registerPaymentPolicy.getCoveredInstallmentNumbers({
        montoCuota: "3750.00",
        cuotas: [
          {
            cuotaId: 40,
            numeroCuota: 1,
            pagos: [
              {
                pago_id: 50,
                validationStatus: "validated",
                paymentFalse: false,
                abono_capital: "1000.00",
              },
            ],
          },
        ],
      }),
    ]).toEqual([]);
  });

  // El loop de insertPayment calcula el saldo de la cuota contra los hermanos
  // vivos validated Y pending, así que el skip tiene que usar el mismo criterio:
  // si no, la cuota entra al loop con saldo neto 0 y nace otra fila en cero.
  it("cuenta los pagos pending para la cobertura (mismo criterio del loop)", () => {
    const cuotas = [
      {
        cuotaId: 40,
        numeroCuota: 1,
        pagos: [
          {
            pago_id: 50,
            validationStatus: "validated",
            paymentFalse: false,
            abono_capital: "3000.00",
          },
          {
            pago_id: 51,
            validationStatus: "pending",
            paymentFalse: false,
            abono_capital: "750.00",
          },
        ],
      },
    ];

    expect([
      ...registerPaymentPolicy.getCoveredInstallmentNumbers({
        montoCuota: "3750.00",
        cuotas,
      }),
    ]).toEqual([1]);

    // Paridad con develop: el gate normal NO cuenta pendings, así que este
    // mismo escenario no es una inconsistencia para un crédito no INCOBRABLE.
    expect(
      registerPaymentPolicy.getCoveredOpenInstallment({
        montoCuota: "3750.00",
        cuotas,
      }),
    ).toBeNull();
  });

  it("un pending anulado (paymentFalse) no cuenta como cobertura", () => {
    expect([
      ...registerPaymentPolicy.getCoveredInstallmentNumbers({
        montoCuota: "3750.00",
        cuotas: [
          {
            cuotaId: 40,
            numeroCuota: 1,
            pagos: [
              {
                pago_id: 50,
                validationStatus: "validated",
                paymentFalse: false,
                abono_capital: "3000.00",
              },
              {
                pago_id: 51,
                validationStatus: "pending",
                paymentFalse: true,
                abono_capital: "750.00",
              },
            ],
          },
        ],
      }),
    ]).toEqual([]);
  });

  it("los abonos directos a capital (capital_validated) no cuentan como cobertura", () => {
    expect([
      ...registerPaymentPolicy.getCoveredInstallmentNumbers({
        montoCuota: "3750.00",
        cuotas: [
          {
            cuotaId: 40,
            numeroCuota: 1,
            pagos: [
              {
                pago_id: 60,
                validationStatus: "capital_validated",
                paymentFalse: false,
                abono_capital: "5250.00",
              },
              {
                pago_id: 61,
                validationStatus: "capital_validated",
                paymentFalse: false,
                abono_capital: "1000.00",
              },
            ],
          },
        ],
      }),
    ]).toEqual([]);
  });
});

describe("registerPaymentPolicy - pago solo capital", () => {
  it("boleta completa destinada a abono a capital es solo-capital", () => {
    expect(
      registerPaymentPolicy.esPagoSoloCapital({
        montoBoleta: "5000.00",
        otros: 0,
        abonoDirectoCapital: 5000,
      }),
    ).toBe(true);
  });

  it("un pago mixto (parte capital, parte cuota) NO es solo-capital", () => {
    expect(
      registerPaymentPolicy.esPagoSoloCapital({
        montoBoleta: "5000.00",
        otros: 0,
        abonoDirectoCapital: 3000,
      }),
    ).toBe(false);
  });

  it("sin abono directo a capital nunca es solo-capital", () => {
    expect(
      registerPaymentPolicy.esPagoSoloCapital({
        montoBoleta: "5000.00",
        otros: 0,
        abonoDirectoCapital: 0,
      }),
    ).toBe(false);
  });

  it("descuenta otros: boleta 5000 con otros 200 y capital 4800 es solo-capital", () => {
    expect(
      registerPaymentPolicy.esPagoSoloCapital({
        montoBoleta: "5000.00",
        otros: 200,
        abonoDirectoCapital: 4800,
      }),
    ).toBe(true);
  });

  it("un request sobre-asignado (capital > boleta - otros) NO es solo-capital", () => {
    expect(
      registerPaymentPolicy.esPagoSoloCapital({
        montoBoleta: "1000.00",
        otros: 0,
        abonoDirectoCapital: 5000,
      }),
    ).toBe(false);
  });

  it("boleta en cero con capital pedido NO es solo-capital", () => {
    expect(
      registerPaymentPolicy.esPagoSoloCapital({
        montoBoleta: "0",
        otros: 0,
        abonoDirectoCapital: 5000,
      }),
    ).toBe(false);
  });
});

describe("registerPaymentPolicy - pago solo otros", () => {
  it("boleta igual a otros sin capital es solo-otros", () => {
    expect(
      registerPaymentPolicy.esPagoSoloOtros({
        montoBoleta: "1000.00",
        otros: 1000,
        abonoDirectoCapital: 0,
      }),
    ).toBe(true);
  });

  it("capital colado descarta la clasificación (boleta==otros + capital)", () => {
    expect(
      registerPaymentPolicy.esPagoSoloOtros({
        montoBoleta: "1000.00",
        otros: 1000,
        abonoDirectoCapital: 5000,
      }),
    ).toBe(false);
  });

  it("boleta en cero no clasifica", () => {
    expect(
      registerPaymentPolicy.esPagoSoloOtros({
        montoBoleta: "0",
        otros: 0,
        abonoDirectoCapital: 0,
      }),
    ).toBe(false);
  });

  it("boleta distinta de otros no clasifica", () => {
    expect(
      registerPaymentPolicy.esPagoSoloOtros({
        montoBoleta: "1000.00",
        otros: 500,
        abonoDirectoCapital: 0,
      }),
    ).toBe(false);
  });
});

describe("registerPaymentPolicy - abono solo-capital sin permiso", () => {
  it("el bypass del guard sólo aplica si el crédito permite abono a capital", () => {
    expect(
      registerPaymentPolicy.puedeOmitirGuardTodasCubiertas({
        esSoloCapital: true,
        permiteAbonoCapital: true,
        pagoSoloOtros: false,
      }),
    ).toBe(true);

    // Todos los insolutos tienen permite_abono_capital = false (default de la
    // columna): sin permiso la sección 7 no corre y el abono se perdería.
    expect(
      registerPaymentPolicy.puedeOmitirGuardTodasCubiertas({
        esSoloCapital: true,
        permiteAbonoCapital: false,
        pagoSoloOtros: false,
      }),
    ).toBe(false);

    expect(
      registerPaymentPolicy.puedeOmitirGuardTodasCubiertas({
        esSoloCapital: false,
        permiteAbonoCapital: true,
        pagoSoloOtros: false,
      }),
    ).toBe(false);
  });

  it("el pago de sólo otros omite el guard aunque no permita abono a capital", () => {
    expect(
      registerPaymentPolicy.puedeOmitirGuardTodasCubiertas({
        esSoloCapital: false,
        permiteAbonoCapital: false,
        pagoSoloOtros: true,
      }),
    ).toBe(true);
  });

  it("un pago normal nunca omite el guard", () => {
    expect(
      registerPaymentPolicy.puedeOmitirGuardTodasCubiertas({
        esSoloCapital: false,
        permiteAbonoCapital: false,
        pagoSoloOtros: false,
      }),
    ).toBe(false);
  });

  it("el pago especial cae en la cuota de referencia cuando no quedan pendientes", () => {
    expect(
      registerPaymentPolicy.getSpecialPaymentCuotaId({
        requestedInstallment: 1,
        pendingInstallments: [],
        fallbackCuotaId: 40,
      }),
    ).toBe(40);

    // Sin fallback se conserva el 0 histórico.
    expect(
      registerPaymentPolicy.getSpecialPaymentCuotaId({
        requestedInstallment: 1,
        pendingInstallments: [],
      }),
    ).toBe(0);

    // Con pendientes, el fallback no interfiere.
    expect(
      registerPaymentPolicy.getSpecialPaymentCuotaId({
        requestedInstallment: 2,
        pendingInstallments: [{ numeroCuota: 2, cuotaId: 41 }],
        fallbackCuotaId: 40,
      }),
    ).toBe(41);
  });

  it("rechaza el abono a capital que quedó sin aplicar y sin nada escrito", () => {
    expect(
      registerPaymentPolicy.debeRechazarAbonoCapitalNoAplicado({
        abonoCapital: 5000,
        cuotasCompletas: 0,
        cuotasParciales: 0,
        moraAplicada: 0,
        otrosEspecialAplicado: false,
      }),
    ).toBe(true);
  });

  it("no rechaza si ya se escribió algo (cuotas o mora o pago de sólo otros)", () => {
    const base = {
      abonoCapital: 5000,
      cuotasCompletas: 0,
      cuotasParciales: 0,
      moraAplicada: 0,
      otrosEspecialAplicado: false,
    };

    expect(
      registerPaymentPolicy.debeRechazarAbonoCapitalNoAplicado({
        ...base,
        cuotasCompletas: 1,
      }),
    ).toBe(false);
    expect(
      registerPaymentPolicy.debeRechazarAbonoCapitalNoAplicado({
        ...base,
        cuotasParciales: 1,
      }),
    ).toBe(false);
    expect(
      registerPaymentPolicy.debeRechazarAbonoCapitalNoAplicado({
        ...base,
        moraAplicada: 120,
      }),
    ).toBe(false);
    expect(
      registerPaymentPolicy.debeRechazarAbonoCapitalNoAplicado({
        ...base,
        otrosEspecialAplicado: true,
      }),
    ).toBe(false);
  });

  it("no rechaza un pago sin abono directo a capital", () => {
    expect(
      registerPaymentPolicy.debeRechazarAbonoCapitalNoAplicado({
        abonoCapital: 0,
        cuotasCompletas: 0,
        cuotasParciales: 0,
        moraAplicada: 0,
        otrosEspecialAplicado: false,
      }),
    ).toBe(false);
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

describe("crearEstampadorPagoConvenio", () => {
  it("entrega el monto del convenio solo a la primera fila de la boleta", () => {
    const estampar = registerPaymentPolicy.crearEstampadorPagoConvenio(981.86);

    // Boleta que cierra una cuota, deja parcial la siguiente y abona capital:
    // tres filas, pero el convenio se cobró una sola vez.
    expect(estampar()).toBe("981.86");
    expect(estampar()).toBe("0");
    expect(estampar()).toBe("0");
  });

  it("estampa 0 en todas las filas cuando la boleta no aplicó al convenio", () => {
    expect(registerPaymentPolicy.crearEstampadorPagoConvenio(0)()).toBe("0");
    expect(registerPaymentPolicy.crearEstampadorPagoConvenio(null)()).toBe("0");
    expect(registerPaymentPolicy.crearEstampadorPagoConvenio(undefined)()).toBe(
      "0"
    );
  });

  it("acepta el monto como string decimal (formato de la DB)", () => {
    const estampar = registerPaymentPolicy.crearEstampadorPagoConvenio("981.86");
    expect(estampar()).toBe("981.86");
    expect(estampar()).toBe("0");
  });
});

describe("debeInsertarFilaParcialCuota", () => {
  it("no inserta fila cuando la cuota no absorbió nada (caso crédito 8717)", () => {
    expect(
      registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: 0,
        mora: 0,
        otros: 0,
      })
    ).toBe(false);
  });

  it("inserta fila cuando la cuota absorbió abonos", () => {
    expect(
      registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: 150.5,
        mora: 0,
        otros: 0,
      })
    ).toBe(true);
  });

  it("inserta fila cuando solo hay mora que cobrar", () => {
    expect(
      registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: 0,
        mora: 30,
        otros: 0,
      })
    ).toBe(true);
  });

  it("inserta fila cuando solo hay otros que cobrar", () => {
    expect(
      registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: 0,
        mora: 0,
        otros: 25,
      })
    ).toBe(true);
  });

  it("trata los strings decimales de la DB como números (0.00 => false)", () => {
    expect(
      registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: "0.00",
        mora: "0.00",
        otros: "0.00",
      })
    ).toBe(false);

    expect(
      registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: "0.01",
        mora: "0.00",
        otros: "0.00",
      })
    ).toBe(true);
  });

  it("inserta fila cuando queda convenio pendiente de estampar", () => {
    expect(
      registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: 0,
        mora: 0,
        otros: 0,
        pagoConvenio: 981.86,
      })
    ).toBe(true);

    // String decimal (formato del estampador / de la DB).
    expect(
      registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: 0,
        mora: 0,
        otros: 0,
        pagoConvenio: "981.86",
      })
    ).toBe(true);
  });

  it("se salta la cuota cuando el convenio ya fue estampado o no existe", () => {
    expect(
      registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: 0,
        mora: 0,
        otros: 0,
        pagoConvenio: "0",
      })
    ).toBe(false);

    expect(
      registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: 0,
        mora: 0,
        otros: 0,
        pagoConvenio: null,
      })
    ).toBe(false);
  });

  it("tolera mora/otros ausentes o nulos", () => {
    expect(
      registerPaymentPolicy.debeInsertarFilaParcialCuota({ totalPagado: 0 })
    ).toBe(false);
    expect(
      registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: 0,
        mora: null,
        otros: null,
      })
    ).toBe(false);
  });
});

describe("crearEstampadorPagoConvenio - peek pendiente()", () => {
  it("reporta el monto sin consumir el sello", () => {
    const estampar = registerPaymentPolicy.crearEstampadorPagoConvenio(981.86);

    // Consultar dos veces no quema el sello.
    expect(estampar.pendiente()).toBe("981.86");
    expect(estampar.pendiente()).toBe("981.86");

    expect(estampar()).toBe("981.86");

    // Ya estampado: el peek pasa a 0 y las cuotas siguientes pueden saltarse.
    expect(estampar.pendiente()).toBe("0");
    expect(estampar()).toBe("0");
  });

  it("reporta 0 cuando la boleta no aplicó al convenio", () => {
    expect(registerPaymentPolicy.crearEstampadorPagoConvenio(0).pendiente()).toBe("0");
    expect(
      registerPaymentPolicy.crearEstampadorPagoConvenio(null).pendiente()
    ).toBe("0");
  });
});
