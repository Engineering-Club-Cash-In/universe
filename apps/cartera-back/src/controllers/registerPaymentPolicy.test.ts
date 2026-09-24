import { describe, expect, it } from "bun:test";
import Big from "big.js";
import {
  getAjusteFechaIdealADeducir,
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

describe("getAjusteFechaIdealADeducir", () => {
  it("null si la cuota 1 no está entre las pendientes (ya pagada o fuera de rango)", () => {
    expect(
      getAjusteFechaIdealADeducir({
        tieneCuota1Pendiente: false,
        ajustePendiente: { id: 1, monto_total: "30.96" },
        disponible: "1000",
      }),
    ).toBeNull();
  });

  it("null si no hay ajuste pendiente (ya cobrado o nunca aplicó)", () => {
    expect(
      getAjusteFechaIdealADeducir({
        tieneCuota1Pendiente: true,
        ajustePendiente: null,
        disponible: "1000",
      }),
    ).toBeNull();
  });

  it("null si el disponible no alcanza a cubrirlo completo (no cobra parcial)", () => {
    expect(
      getAjusteFechaIdealADeducir({
        tieneCuota1Pendiente: true,
        ajustePendiente: { id: 7, monto_total: "30.96" },
        disponible: "20",
      }),
    ).toBeNull();
  });

  it("devuelve el id y el monto cuando aplica y el disponible alcanza", () => {
    const resultado = getAjusteFechaIdealADeducir({
      tieneCuota1Pendiente: true,
      ajustePendiente: { id: 7, monto_total: "30.96" },
      disponible: "880.96",
    });
    expect(resultado?.id).toBe(7);
    expect(resultado?.monto.toString()).toBe("30.96");
  });

  it("null si disponible == monto exacto (no deja nada para procesar la cuota, ver comentario de la función)", () => {
    const resultado = getAjusteFechaIdealADeducir({
      tieneCuota1Pendiente: true,
      ajustePendiente: { id: 7, monto_total: "30.96" },
      disponible: "30.96",
    });
    expect(resultado).toBeNull();
  });

  it("deduce si disponible es apenas mayor al monto", () => {
    const resultado = getAjusteFechaIdealADeducir({
      tieneCuota1Pendiente: true,
      ajustePendiente: { id: 7, monto_total: "30.96" },
      disponible: "30.97",
    });
    expect(resultado?.monto.toString()).toBe("30.96");
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

describe("crearEstampadorOtros / resolverOtrosDeLaFila", () => {
  // Caso real crédito 8674: boleta de Q3,000 con Q10.32 de otros. La cuota 6 ya
  // estaba cubierta por un pago pendiente de validar, así que no absorbió nada;
  // la que cobró los Q2,989.68 fue la 7.
  it("no gasta el otros en una cuota que no cobra y se lo lleva la que sí", () => {
    const estamparOtros = registerPaymentPolicy.crearEstampadorOtros(10.32);

    // Cuota 6: sin abonos, sin mora, sin convenio → no escribe fila.
    const cuota6 = registerPaymentPolicy.resolverOtrosDeLaFila({
      filaSeEscribeSinOtrosManual: registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: 0,
        mora: 0,
        otros: 0,
        pagoConvenio: 0,
      }),
      estamparOtros,
    });
    expect(cuota6.toString()).toBe("0");
    // El sello sigue vivo: la cuota se puede saltar sin perder el otros.
    expect(estamparOtros.pendiente()).toBe("10.32");

    // Cuota 7: cobra Q2,989.68 → escribe fila y se lleva el otros.
    const cuota7 = registerPaymentPolicy.resolverOtrosDeLaFila({
      filaSeEscribeSinOtrosManual: registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: 2989.68,
        mora: 0,
        otros: 0,
        pagoConvenio: 0,
      }),
      estamparOtros,
    });
    expect(cuota7.toString()).toBe("10.32");
    // Una sola vez: las filas siguientes de la boleta van en 0.
    expect(estamparOtros.pendiente()).toBe("0");
  });

  it("un recibo de sólo mora sí carga el otros (no hay cuota que cobre)", () => {
    const estamparOtros = registerPaymentPolicy.crearEstampadorOtros(10.32);

    const fila = registerPaymentPolicy.resolverOtrosDeLaFila({
      filaSeEscribeSinOtrosManual: registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: 0,
        mora: 638.67,
        otros: 0,
        pagoConvenio: 0,
      }),
      estamparOtros,
    });

    expect(fila.toString()).toBe("10.32");
  });

  it("suma el ajuste por fecha ideal al otros de la cuota 1", () => {
    const estamparOtros = registerPaymentPolicy.crearEstampadorOtros(10.32);

    const fila = registerPaymentPolicy.resolverOtrosDeLaFila({
      filaSeEscribeSinOtrosManual: true,
      estamparOtros,
      ajusteFechaIdeal: 25,
    });

    expect(fila.toString()).toBe("35.32");
  });

  // El ajuste ya se descontó del disponible antes del loop: si la cuota 1 se
  // saltara, ese dinero quedaría sin fila y el ajuste sin marcar como cobrado,
  // listo para volver a cobrarse. Por eso entra en la pregunta.
  it("el ajuste de la cuota 1 obliga a escribir la fila aunque no absorba nada", () => {
    const ajusteFechaIdeal = 25;
    const filaSeEscribeSinOtrosManual =
      registerPaymentPolicy.debeInsertarFilaParcialCuota({
        totalPagado: 0,
        mora: 0,
        otros: ajusteFechaIdeal,
        pagoConvenio: 0,
      });
    expect(filaSeEscribeSinOtrosManual).toBe(true);

    const estamparOtros = registerPaymentPolicy.crearEstampadorOtros(10.32);
    const fila = registerPaymentPolicy.resolverOtrosDeLaFila({
      filaSeEscribeSinOtrosManual,
      estamparOtros,
      ajusteFechaIdeal,
    });

    expect(fila.toString()).toBe("35.32");
  });

  it("no arrastra el ajuste cuando la fila no se escribe", () => {
    const estamparOtros = registerPaymentPolicy.crearEstampadorOtros(10.32);

    const fila = registerPaymentPolicy.resolverOtrosDeLaFila({
      filaSeEscribeSinOtrosManual: false,
      estamparOtros,
      ajusteFechaIdeal: 25,
    });

    expect(fila.toString()).toBe("0");
    expect(estamparOtros.pendiente()).toBe("10.32");
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

describe("capitalSuprimidoSinAplicar (devolución por cuotas saltadas)", () => {
  // Escenario base: capital pedido sin permiso, la sección 7 no corrió y no
  // hubo mora ni fila especial de otros. Lo único que puede suprimir el 409
  // es el convenio o las cuotas saltadas.
  const base = {
    abonoCapital: 500,
    cuotasCompletas: 0,
    cuotasParciales: 0,
    moraAplicada: 0,
    otrosEspecialAplicado: false,
    convenioAplicado: 0,
  };

  // NOTA de precedencia: en el controller este escenario ya no se alcanza —
  // `debeRechazarPagoSinAplicacion` responde 409 antes de llegar a la
  // devolución. El test sigue siendo válido como contrato PURO del helper (no
  // depende del orden del controller) y fija la red por si esas condiciones
  // se estrechan; la pata convenio de #1246 sí sigue viva en producción.
  it("devuelve el capital cuando el 409 se suprimió SOLO por cuotas saltadas", () => {
    expect(
      registerPaymentPolicy
        .capitalSuprimidoSinAplicar({
          ...base,
          cuotasParciales: 3, // 0 reales + 3 saltadas
          cuotasSaltadas: 3,
        })
        .toString()
    ).toBe("500");
  });

  it("no devuelve nada cuando hubo parciales REALES (comportamiento pre-existente)", () => {
    expect(
      registerPaymentPolicy
        .capitalSuprimidoSinAplicar({
          ...base,
          cuotasParciales: 2, // ambas reales
          cuotasSaltadas: 0,
        })
        .toString()
    ).toBe("0");
  });

  it("no devuelve nada cuando el 409 SÍ procede (no se procesó nada)", () => {
    expect(
      registerPaymentPolicy
        .capitalSuprimidoSinAplicar({ ...base, cuotasSaltadas: 0 })
        .toString()
    ).toBe("0");
    expect(
      registerPaymentPolicy.debeRechazarAbonoCapitalNoAplicado(base)
    ).toBe(true);
  });

  it("devuelve el capital UNA sola vez cuando convenio y saltadas suprimen a la vez", () => {
    expect(
      registerPaymentPolicy
        .capitalSuprimidoSinAplicar({
          ...base,
          cuotasParciales: 2,
          cuotasSaltadas: 2,
          convenioAplicado: 230,
        })
        .toString()
    ).toBe("500");
  });

  it("sin `cuotasSaltadas` se comporta igual que capitalSuprimidoPorConvenio", () => {
    const conConvenio = { ...base, convenioAplicado: 230 };
    expect(
      registerPaymentPolicy.capitalSuprimidoSinAplicar(conConvenio).toString()
    ).toBe(
      registerPaymentPolicy.capitalSuprimidoPorConvenio(conConvenio).toString()
    );
    expect(
      registerPaymentPolicy.capitalSuprimidoSinAplicar(conConvenio).toString()
    ).toBe("500");
  });
});

describe("debeRechazarPagoSinAplicacion", () => {
  // Cascadeo que recorrió cuotas sin que ninguna absorbiera nada y sin ninguna
  // otra vía que haya escrito fila.
  const base = {
    cuotasSaltadas: 3,
    cuotasCompletas: 0,
    cuotasParciales: 0,
    moraAplicada: 0,
    otrosEspecialAplicado: false,
    convenioAplicado: 0,
  };

  it("rechaza cuando el pago no dejó NINGUNA fila (solo cuotas saltadas)", () => {
    expect(registerPaymentPolicy.debeRechazarPagoSinAplicacion(base)).toBe(true);
  });

  it("no rechaza si el loop nunca corrió (crédito sin cuotas pendientes)", () => {
    // Flujo histórico de saldo a favor: no se toca.
    expect(
      registerPaymentPolicy.debeRechazarPagoSinAplicacion({
        ...base,
        cuotasSaltadas: 0,
      })
    ).toBe(false);
  });

  it("no rechaza si la mora ya insertó su fila", () => {
    expect(
      registerPaymentPolicy.debeRechazarPagoSinAplicacion({
        ...base,
        moraAplicada: 75,
      })
    ).toBe(false);
  });

  it("no rechaza si la rama especial de otros insertó su fila", () => {
    expect(
      registerPaymentPolicy.debeRechazarPagoSinAplicacion({
        ...base,
        otrosEspecialAplicado: true,
      })
    ).toBe(false);
  });

  it("no rechaza si el convenio se aplicó (su fila existe)", () => {
    // Con convenio pendiente el skip no ocurre: la primera cuota inserta fila
    // (el convenio no consume disponible, así que el loop siempre corre).
    expect(
      registerPaymentPolicy.debeRechazarPagoSinAplicacion({
        ...base,
        convenioAplicado: 981.86,
      })
    ).toBe(false);
  });

  it("no rechaza si alguna cuota sí se procesó", () => {
    expect(
      registerPaymentPolicy.debeRechazarPagoSinAplicacion({
        ...base,
        cuotasParciales: 1,
      })
    ).toBe(false);
    expect(
      registerPaymentPolicy.debeRechazarPagoSinAplicacion({
        ...base,
        cuotasCompletas: 1,
      })
    ).toBe(false);
  });
});

describe("filtrarCuotasVencidasSinCobertura — contador de atrasadas por montos", () => {
  const filtrar = () => {
    const fn = Reflect.get(
      registerPaymentPolicy,
      "filtrarCuotasVencidasSinCobertura",
    );
    expect(fn).toBeFunction();
    return fn as (
      rows: any[],
      montoCuota: string | number,
    ) => any[];
  };

  // Fila como la devuelve la query de getCreditoByNumero (cuota + pago join)
  const fila = (over: Record<string, any> = {}) => ({
    cuota_id: 10,
    numero_cuota: 1,
    pago_id: 100,
    validationStatus: "validated",
    paymentFalse: false,
    abono_capital: "0",
    abono_interes: "0",
    abono_iva_12: "0",
    abono_seguro: "0",
    abono_gps: "0",
    membresias_pago: "0",
    ...over,
  });

  it("mantiene atrasada la cuota con pago validated parcial (caso Aura: 5,079.59 de 6,394.11)", () => {
    const rows = [
      fila({
        abono_capital: "902.44",
        abono_interes: "3729.60",
        abono_iva_12: "447.55",
      }), // suma 5,079.59
    ];
    expect(filtrar()(rows, "6394.11")).toHaveLength(1);
  });

  it("excluye la cuota cuya boleta pending SÍ cubre por montos (reemplaza al viejo NOT EXISTS)", () => {
    const rows = [
      fila({
        validationStatus: "pending",
        abono_capital: "1000.00",
        abono_interes: "4500.00",
        abono_iva_12: "894.11",
      }), // suma 6,394.11 exacto
    ];
    expect(filtrar()(rows, "6394.11")).toHaveLength(0);
  });

  it("cuenta atrasada la cuota con pending+pagado=true cuyos montos NO cubren (los flags mienten)", () => {
    const rows = [
      fila({
        validationStatus: "pending",
        pagado: true, // flag mentiroso: el viejo criterio la ocultaba
        abono_capital: "100.00",
      }),
    ];
    expect(filtrar()(rows, "6394.11")).toHaveLength(1);
  });

  it("cuenta atrasada la cuota sin ningún pago (fila con pago null del leftJoin)", () => {
    const rows = [
      fila({
        pago_id: null,
        validationStatus: null,
        paymentFalse: null,
        abono_capital: null,
        abono_interes: null,
        abono_iva_12: null,
        abono_seguro: null,
        abono_gps: null,
        membresias_pago: null,
      }),
    ];
    expect(filtrar()(rows, "6394.11")).toHaveLength(1);
  });

  it("ignora boletas con paymentFalse=true aunque sus montos cubran", () => {
    const rows = [
      fila({
        paymentFalse: true,
        abono_capital: "6394.11",
      }),
    ];
    expect(filtrar()(rows, "6394.11")).toHaveLength(1);
  });

  it("tolera 1 centavo de redondeo (6,394.10 aplicado cubre cuota de 6,394.11)", () => {
    const rows = [
      fila({
        abono_capital: "6394.10",
      }),
    ];
    expect(filtrar()(rows, "6394.11")).toHaveLength(0);
  });

  it("las filas de solo-mora no cubren la cuota (los rubros van en 0)", () => {
    // monto_aplicado legacy diría 2,420.41 (mora), pero la cuota no recibió nada
    const rows = [fila({ pago_mora: "2420.41" })];
    expect(filtrar()(rows, "6394.11")).toHaveLength(1);
  });

  it("filtra por cuota: devuelve solo las filas de la cuota descubierta, preservando orden y multiplicidad", () => {
    const cubierta1 = fila({
      cuota_id: 10,
      numero_cuota: 1,
      pago_id: 100,
      abono_capital: "3000.00",
    });
    const cubierta2 = fila({
      cuota_id: 10,
      numero_cuota: 1,
      pago_id: 101,
      abono_capital: "3394.11",
    }); // entre las dos suman 6,394.11
    const descubierta = fila({
      cuota_id: 11,
      numero_cuota: 2,
      pago_id: 102,
      abono_capital: "50.00",
    });

    const result = filtrar()([cubierta1, cubierta2, descubierta], "6394.11");
    expect(result).toEqual([descubierta]);
  });

  it("con dos filas parciales de la misma cuota descubierta, devuelve ambas filas", () => {
    const parcial1 = fila({ pago_id: 100, abono_capital: "1000.00" });
    const parcial2 = fila({ pago_id: 101, abono_capital: "2000.00" });
    const result = filtrar()([parcial1, parcial2], "6394.11");
    expect(result).toHaveLength(2);
  });
});

describe("filtrarCuotasVencidasSinCobertura — cuotas duplicadas (mismo numero_cuota, distinto cuota_id)", () => {
  const filtrar = registerPaymentPolicy.filtrarCuotasVencidasSinCobertura;

  const fila = (over: Record<string, any> = {}) => ({
    cuota_id: 10,
    numero_cuota: 1,
    pago_id: 100,
    validationStatus: "validated",
    paymentFalse: false,
    abono_capital: "0",
    abono_interes: "0",
    abono_iva_12: "0",
    abono_seguro: "0",
    abono_gps: "0",
    membresias_pago: "0",
    ...over,
  });

  it("suma los fragmentos de filas duplicadas de la misma cuota contractual antes de decidir", () => {
    // Cuota lógica #1 partida en dos filas de cuotas_credito (dup conocido):
    // Q60 en una y Q40 en la otra cubren la cuota de Q100 entre las dos.
    const fragmento1 = fila({ cuota_id: 10, pago_id: 100, abono_capital: "60.00" });
    const fragmento2 = fila({ cuota_id: 11, pago_id: 101, abono_capital: "40.00" });

    expect(filtrar([fragmento1, fragmento2], "100.00")).toHaveLength(0);
  });

  it("una fila cubierta + su duplicada vacía no dejan cuota atrasada fantasma", () => {
    const cubierta = fila({ cuota_id: 10, pago_id: 100, abono_capital: "100.00" });
    const dupVacia = fila({
      cuota_id: 11,
      pago_id: null,
      validationStatus: null,
      paymentFalse: null,
      abono_capital: null,
    });

    expect(filtrar([cubierta, dupVacia], "100.00")).toHaveLength(0);
  });

  it("cuotas de numero distinto NO se mezclan: cada una se evalúa sola", () => {
    const cuota1cubierta = fila({ cuota_id: 10, numero_cuota: 1, abono_capital: "100.00" });
    const cuota2descubierta = fila({ cuota_id: 20, numero_cuota: 2, pago_id: 200, abono_capital: "10.00" });

    expect(filtrar([cuota1cubierta, cuota2descubierta], "100.00")).toEqual([cuota2descubierta]);
  });
});

describe("filtrarCuotasEnValidacion — cuotas cubiertas que dependen de boletas sin validar", () => {
  const filtrar = () => {
    const fn = Reflect.get(registerPaymentPolicy, "filtrarCuotasEnValidacion");
    expect(fn).toBeFunction();
    return fn as (rows: any[], montoCuota: string | number) => any[];
  };

  const fila = (over: Record<string, any> = {}) => ({
    cuota_id: 10,
    numero_cuota: 1,
    pago_id: 100,
    validationStatus: "validated",
    paymentFalse: false,
    abono_capital: "0",
    abono_interes: "0",
    abono_iva_12: "0",
    abono_seguro: "0",
    abono_gps: "0",
    membresias_pago: "0",
    ...over,
  });

  it("incluye la cuota cubierta SOLO gracias a una boleta pending (caso Carlos)", () => {
    const rows = [
      fila({ validationStatus: "pending", abono_capital: "2273.80" }),
    ];
    expect(filtrar()(rows, "2273.80")).toHaveLength(1);
  });

  it("excluye la cuota cubierta solo con pagos validated (nada que validar)", () => {
    const rows = [fila({ abono_capital: "2273.80" })];
    expect(filtrar()(rows, "2273.80")).toHaveLength(0);
  });

  it("excluye la cuota descubierta (esa es atrasada, no en validación)", () => {
    const rows = [
      fila({ validationStatus: "pending", abono_capital: "500.00" }),
    ];
    expect(filtrar()(rows, "2273.80")).toHaveLength(0);
  });

  it("incluye la cuota que cierra con la mezcla validated + pending", () => {
    const rows = [
      fila({ pago_id: 100, abono_capital: "1500.00" }),
      fila({
        pago_id: 101,
        validationStatus: "pending",
        abono_capital: "773.80",
      }),
    ];
    expect(filtrar()(rows, "2273.80")).toHaveLength(2);
  });

  it("una boleta falsa pending no pone la cuota en validación", () => {
    const rows = [
      fila({
        validationStatus: "pending",
        paymentFalse: true,
        abono_capital: "2273.80",
      }),
    ];
    expect(filtrar()(rows, "2273.80")).toHaveLength(0);
  });

  it("agrupa por numero_cuota: fragmentos duplicados pending que cubren juntos cuentan", () => {
    const rows = [
      fila({ cuota_id: 10, validationStatus: "pending", abono_capital: "60.00" }),
      fila({ cuota_id: 11, pago_id: 101, validationStatus: "pending", abono_capital: "40.00" }),
    ];
    expect(filtrar()(rows, "100.00")).toHaveLength(2);
  });

  it("no mezcla cuotas: solo devuelve las filas de la cuota en validación", () => {
    const enValidacion = fila({
      numero_cuota: 1,
      validationStatus: "pending",
      abono_capital: "100.00",
    });
    const atrasada = fila({
      cuota_id: 20,
      numero_cuota: 2,
      pago_id: 200,
      validationStatus: null,
      abono_capital: "0",
    });
    expect(filtrar()([enValidacion, atrasada], "100.00")).toEqual([enValidacion]);
  });
});

describe("filtrarCuotas* — cuotas recortadas (recibo saldado con restantes en 0)", () => {
  const filtrarAtrasadas = registerPaymentPolicy.filtrarCuotasVencidasSinCobertura;
  const filtrarEnValidacion = registerPaymentPolicy.filtrarCuotasEnValidacion;

  // Última cuota tras abono grande: el recibo real vale menos que credito.cuota
  const reciboRecortado = (over: Record<string, any> = {}) => ({
    cuota_id: 10,
    numero_cuota: 84,
    pago_id: 100,
    validationStatus: "validated",
    paymentFalse: false,
    // Rubros: solo Q500 de capital topado + seguro (mucho menos que la cuota mensual)
    abono_capital: "500.00",
    abono_interes: "0",
    abono_iva_12: "0",
    abono_seguro: "150.00",
    abono_gps: "0",
    membresias_pago: "0",
    monto_aplicado: "650.00",
    // El recibo quedó SALDADO: todos los restantes en 0
    capital_restante: "0",
    interes_restante: "0",
    iva_12_restante: "0",
    seguro_restante: "0",
    gps_restante: "0",
    membresias_restante: "0",
    ...over,
  });

  it("no marca atrasada la cuota recortada saldada por un pago validated", () => {
    expect(filtrarAtrasadas([reciboRecortado()], "2273.80")).toHaveLength(0);
  });

  it("la cuota recortada saldada por un pago pending no es atrasada, es en-validación", () => {
    const rows = [reciboRecortado({ validationStatus: "pending" })];
    expect(filtrarAtrasadas(rows, "2273.80")).toHaveLength(0);
    expect(filtrarEnValidacion(rows, "2273.80")).toHaveLength(1);
  });

  it("un placeholder con restantes en 0 pero sin plata aplicada NO salda la cuota", () => {
    const rows = [
      reciboRecortado({
        abono_capital: "0",
        abono_seguro: "0",
        monto_aplicado: "0",
      }),
    ];
    expect(filtrarAtrasadas(rows, "2273.80")).toHaveLength(1);
  });

  it("un parcial normal (restantes > 0) sigue contando como atrasada", () => {
    const rows = [
      reciboRecortado({
        capital_restante: "800.00",
        interes_restante: "473.80",
      }),
    ];
    expect(filtrarAtrasadas(rows, "2273.80")).toHaveLength(1);
  });

  it("una boleta falsa saldada no cubre la cuota", () => {
    const rows = [reciboRecortado({ paymentFalse: true })];
    expect(filtrarAtrasadas(rows, "2273.80")).toHaveLength(1);
  });
});

describe("esReciboSaldado vía filtrar — pagos legacy solo-mora no saldan cuota", () => {
  const filtrarAtrasadas = registerPaymentPolicy.filtrarCuotasVencidasSinCobertura;

  it("un pago legacy de solo mora (monto_aplicado>0 pero rubros en 0) NO cubre la cuota", () => {
    // Legacy: monto_aplicado incluía mora+otros; la cuota no recibió nada.
    const filaLegacySoloMora = {
      cuota_id: 10,
      numero_cuota: 5,
      pago_id: 100,
      validationStatus: "validated",
      paymentFalse: false,
      abono_capital: "0",
      abono_interes: "0",
      abono_iva_12: "0",
      abono_seguro: "0",
      abono_gps: "0",
      membresias_pago: "0",
      monto_aplicado: "2420.41", // mora legacy, no plata de cuota
      pago_mora: "2420.41",
      capital_restante: "0",
      interes_restante: "0",
      iva_12_restante: "0",
      seguro_restante: "0",
      gps_restante: "0",
      membresias_restante: "0",
    };
    expect(filtrarAtrasadas([filaLegacySoloMora], "2273.80")).toHaveLength(1);
  });
});

describe("esReciboSaldado vía filtrar — restantes parcialmente informados", () => {
  it("un restante NULL con otros en 0 NO permite afirmar el saldado (todos deben venir)", () => {
    // Legacy: interes_restante=0 informado pero capital_restante NULL.
    // El ?? 0 trataría el NULL como pagado y escondería una cuota viva.
    const filaParcialmenteInformada = {
      cuota_id: 10,
      numero_cuota: 5,
      pago_id: 100,
      validationStatus: "validated",
      paymentFalse: false,
      abono_capital: "500.00",
      abono_interes: "0",
      abono_iva_12: "0",
      abono_seguro: "0",
      abono_gps: "0",
      membresias_pago: "0",
      capital_restante: null,
      interes_restante: "0",
      iva_12_restante: "0",
      seguro_restante: "0",
      gps_restante: "0",
      membresias_restante: "0",
    };
    expect(
      registerPaymentPolicy.filtrarCuotasVencidasSinCobertura(
        [filaParcialmenteInformada],
        "2273.80",
      ),
    ).toHaveLength(1);
  });
});

describe("esReciboSaldado vía filtrar — el cierre no cubre a sus hermanos (cierre diferido)", () => {
  const filtrarAtrasadas = registerPaymentPolicy.filtrarCuotasVencidasSinCobertura;
  const filtrarEnValidacion = registerPaymentPolicy.filtrarCuotasEnValidacion;

  const base = {
    cuota_id: 10,
    numero_cuota: 12,
    paymentFalse: false,
    abono_interes: "0",
    abono_iva_12: "0",
    abono_seguro: "0",
    abono_gps: "0",
    membresias_pago: "0",
    capital_restante: "0",
    interes_restante: "0",
    iva_12_restante: "0",
    seguro_restante: "0",
    gps_restante: "0",
    membresias_restante: "0",
  };

  // Fila de CIERRE validada primero: restantes 0 por diseño, rubros parciales
  const cierreValidado = {
    ...base,
    pago_id: 101,
    validationStatus: "validated",
    abono_capital: "800.00",
  };

  it("cierre validado + hermano pending con plata → la cuota está EN VALIDACIÓN, no cubierta firme", () => {
    const hermanoPending = {
      ...base,
      pago_id: 100,
      validationStatus: "pending",
      abono_capital: "1473.80",
      capital_restante: "1473.80", // el parcial aún debe sus restantes
    };
    const rows = [hermanoPending, cierreValidado];
    expect(filtrarAtrasadas(rows, "2273.80")).toHaveLength(0);
    expect(filtrarEnValidacion(rows, "2273.80")).toHaveLength(2);
  });

  it("cierre validado + hermano ANULADO con plata → la cuota vuelve a ser atrasada", () => {
    const hermanoAnulado = {
      ...base,
      pago_id: 100,
      validationStatus: "pending",
      paymentFalse: true,
      abono_capital: "1473.80",
    };
    const rows = [hermanoAnulado, cierreValidado];
    expect(filtrarAtrasadas(rows, "2273.80")).toHaveLength(2);
  });

  it("cierre validado SIN hermanos con plata (cuota recortada real) sigue cubierta firme", () => {
    const rows = [cierreValidado];
    expect(filtrarAtrasadas(rows, "2273.80")).toHaveLength(0);
    expect(filtrarEnValidacion(rows, "2273.80")).toHaveLength(0);
  });
});

describe("esReciboSaldado vía filtrar — pagos exactos por la vía stale-zero", () => {
  const filtrarAtrasadas = registerPaymentPolicy.filtrarCuotasVencidasSinCobertura;
  const filtrarEnValidacion = registerPaymentPolicy.filtrarCuotasEnValidacion;

  // Vía stale-zero (shouldApplyStaleZeroRestanteAdjustment): el pago exacto
  // consume la cuota subiendo monto_aplicado, pero los abono_* quedan en 0
  // porque los restantes de la fila origen ya estaban (mal) en 0.
  const staleZeroExacto = (over: Record<string, any> = {}) => ({
    cuota_id: 10,
    numero_cuota: 8,
    pago_id: 100,
    validationStatus: "pending",
    paymentFalse: false,
    abono_capital: "0",
    abono_interes: "0",
    abono_iva_12: "0",
    abono_seguro: "0",
    abono_gps: "0",
    membresias_pago: "0",
    monto_aplicado: "2273.80", // la cuota exacta
    pago_mora: "0",
    pago_otros: "0",
    capital_restante: "0",
    interes_restante: "0",
    iva_12_restante: "0",
    seguro_restante: "0",
    gps_restante: "0",
    membresias_restante: "0",
    ...over,
  });

  it("el pago exacto stale-zero pending NO es atrasada: es cuota en validación", () => {
    const rows = [staleZeroExacto()];
    expect(filtrarAtrasadas(rows, "2273.80")).toHaveLength(0);
    expect(filtrarEnValidacion(rows, "2273.80")).toHaveLength(1);
  });

  it("el pago exacto stale-zero validated cubre firme", () => {
    const rows = [staleZeroExacto({ validationStatus: "validated" })];
    expect(filtrarAtrasadas(rows, "2273.80")).toHaveLength(0);
    expect(filtrarEnValidacion(rows, "2273.80")).toHaveLength(0);
  });

  it("regresión: el legacy solo-mora (monto_aplicado = mora) sigue atrasado", () => {
    const rows = [
      staleZeroExacto({ monto_aplicado: "2420.41", pago_mora: "2420.41" }),
    ];
    expect(filtrarAtrasadas(rows, "2273.80")).toHaveLength(1);
  });

  it("regresión: mora+otros exactos tampoco saldan (plata de cuota = 0)", () => {
    const rows = [
      staleZeroExacto({
        monto_aplicado: "500.00",
        pago_mora: "300.00",
        pago_otros: "200.00",
      }),
    ];
    expect(filtrarAtrasadas(rows, "2273.80")).toHaveLength(1);
  });
});

describe("evaluarRubrosPlanosCuota (qué puede cerrar el fallback de aplicar-pago)", () => {
  const { evaluarRubrosPlanosCuota } = registerPaymentPolicy;

  it("bloquea el cierre del crédito 9234: seguro 0.00 de 245.00 y membresías 107.16 de 743.24", () => {
    // Los planos no se topan nunca: se cobran enteros en cada cuota. Que la fila
    // del pago tenga sus restantes en 0 no significa que estén cobrados.
    const evaluacion = evaluarRubrosPlanosCuota({
      cobrado: { seguro: "0", gps: "0", membresias: "107.16" },
      objetivo: { seguro: "245.00", gps: "0", membresias: "743.24" },
    });

    expect(evaluacion.cubiertos).toBe(false);
    expect(evaluacion.faltanteSeguro.toFixed(2)).toBe("245.00");
    expect(evaluacion.faltanteMembresias.toFixed(2)).toBe("636.08");
    expect(evaluacion.faltanteGps.toFixed(2)).toBe("0.00");
  });

  it("deja cerrar el recibo de cola legítimo: capital topado pero planos completos", () => {
    // Éste es el caso por el que el fallback existe: tras un abono grande el
    // recibo vale menos que `credito.cuota`, pero seguro/GPS/membresías se
    // cobraron enteros.
    const evaluacion = evaluarRubrosPlanosCuota({
      cobrado: { seguro: "245.00", gps: "150.00", membresias: "743.24" },
      objetivo: { seguro: "245.00", gps: "150.00", membresias: "743.24" },
    });

    expect(evaluacion.cubiertos).toBe(true);
  });

  it("un crédito sin rubros planos no queda bloqueado", () => {
    expect(
      evaluarRubrosPlanosCuota({
        cobrado: { seguro: "0", gps: "0", membresias: "0" },
        objetivo: { seguro: "0", gps: "0", membresias: "0" },
      }).cubiertos,
    ).toBe(true);
  });

  it("tolera el centavo y no se queja de un sobre-cobro", () => {
    expect(
      evaluarRubrosPlanosCuota({
        cobrado: { seguro: "244.99", gps: "150.01", membresias: "743.24" },
        objetivo: { seguro: "245.00", gps: "150.00", membresias: "743.24" },
      }).cubiertos,
    ).toBe(true);
  });
});

describe("evaluarCierreCuotaPorPlanos (la compuerta que RECHAZA al registrar)", () => {
  const { evaluarCierreCuotaPorPlanos, cuentaComoHermanoVivo } =
    registerPaymentPolicy;
  const TOLERANCIA = 0.01;

  /**
   * Arma el `cobrado` igual que `insertPayment`: Σ de los planos de los
   * hermanos VIVOS (los que pasan `cuentaComoHermanoVivo`) más lo que aplica el
   * pago en vuelo.
   */
  const cobradoDe = (
    hermanos: any[],
    enVuelo: { seguro: string; gps: string; membresias: string },
  ): { seguro: string; gps: string; membresias: string } =>
    hermanos.filter((h) => cuentaComoHermanoVivo(h)).reduce(
      (acc, h) => ({
        seguro: new Big(acc.seguro).plus(h.abono_seguro ?? 0).toString(),
        gps: new Big(acc.gps).plus(h.abono_gps ?? 0).toString(),
        membresias: new Big(acc.membresias)
          .plus(h.membresias_pago ?? 0)
          .toString(),
      }),
      enVuelo,
    );

  it("RECHAZA el caso real del crédito 9234: seguro 0.00 de 245.00 y membresías 107.16 de 743.24", () => {
    const decision = evaluarCierreCuotaPorPlanos({
      todosRestantesEnCero: true,
      cobrado: { seguro: "0", gps: "0", membresias: "107.16" },
      objetivo: { seguro: "245.00", gps: "0", membresias: "743.24" },
      tolerancia: TOLERANCIA,
    });

    expect(decision.rechazar).toBe(true);
    expect(decision.cortos.map((c) => c.rubro)).toEqual([
      "seguro",
      "membresías",
    ]);
    expect(decision.cortos[0]?.faltante.toFixed(2)).toBe("245.00");
    expect(decision.cortos[1]?.faltante.toFixed(2)).toBe("636.08");
    // El GPS estaba en 0 de 0: no se reporta como corto.
    expect(decision.cortos.map((c) => c.rubro)).not.toContain("GPS");
  });

  it("NO rechaza el recibo de cola con capital topado: vale menos que la cuota pero los planos están enteros", () => {
    // NO-REGRESIÓN. Un piso medido contra `credito.cuota` (2,998.48) rechazaba
    // este pago de 1,301.68, que es exactamente lo que el crédito pide después
    // de un abono grande a capital: `recalcularPagosCredito` topa el capital
    // proyectado del recibo de cola. Los planos, en cambio, no se topan nunca y
    // acá están completos, así que el pago tiene que pasar.
    const decision = evaluarCierreCuotaPorPlanos({
      todosRestantesEnCero: true,
      cobrado: { seguro: "245.00", gps: "150.00", membresias: "743.24" },
      objetivo: { seguro: "245.00", gps: "150.00", membresias: "743.24" },
      tolerancia: TOLERANCIA,
    });

    expect(decision.rechazar).toBe(false);
    expect(decision.cortos).toEqual([]);
  });

  it("NO rechaza cuando los planos los cubrió una fila hermana `no_required` con plata", () => {
    // Crédito 890 / cuota 12: una `no_required` que lleva plata aplicada y
    // facturada es hermana VIVA. Filtrarla por status (validated/pending)
    // dejaría los planos en cero y bloquearía la cuota para siempre.
    const hermanaNoRequiredConPlata = {
      validationStatus: "no_required",
      monto_aplicado: "988.24",
      abono_capital: "0",
      abono_interes: "0",
      abono_iva_12: "0",
      abono_seguro: "245.00",
      abono_gps: "0",
      membresias_pago: "743.24",
      abono_interes_ci: "0",
      abono_iva_ci: "0",
      mora: "0",
      pagoConvenio: "0",
      otros: null,
    };
    // Y una semilla virgen de SIFCO, que NO cuenta (no aporta nada).
    const semillaSifco = {
      validationStatus: "no_required",
      monto_aplicado: "0",
      abono_seguro: "0",
      membresias_pago: "0",
      otros: null,
    };

    expect(cuentaComoHermanoVivo(hermanaNoRequiredConPlata)).toBe(true);
    expect(cuentaComoHermanoVivo(semillaSifco)).toBe(false);

    const decision = evaluarCierreCuotaPorPlanos({
      todosRestantesEnCero: true,
      cobrado: cobradoDe([hermanaNoRequiredConPlata, semillaSifco], {
        seguro: "0",
        gps: "0",
        membresias: "0",
      }),
      objetivo: { seguro: "245.00", gps: "0", membresias: "743.24" },
      tolerancia: TOLERANCIA,
    });

    expect(decision.rechazar).toBe(false);
  });

  it("NO rechaza cuando el ajuste de restantes stale-cero ya consumió la cuota entera", () => {
    // Ese ajuste (`shouldApplyStaleZeroRestanteAdjustment`) sólo dispara con el
    // monto EXACTO de una cuota, sin hermanos validados y sin parcial con
    // restante: la cuota SÍ quedó cobrada completa, lo que falta es la
    // itemización por rubro. `insertPayment` le pasa entonces
    // `todosRestantesEnCero: false` para no rechazar un pago correcto.
    const staleZeroDisparo = registerPaymentPolicy.shouldApplyStaleZeroRestanteAdjustment(
      {
        hasExistingPayment: true,
        isFirstProcessedInstallment: true,
        isExactSingleInstallmentPayment: true,
        hasValidatedPayments: false,
        hasLastPartialPaymentWithRemaining: false,
        allRemainingZero: true,
        missingAgainstInstallment: "2998.48",
        availableRemaining: "2998.48",
      },
    );
    expect(staleZeroDisparo).toBe(true);

    expect(
      evaluarCierreCuotaPorPlanos({
        todosRestantesEnCero: true && !staleZeroDisparo,
        cobrado: { seguro: "0", gps: "0", membresias: "0" },
        objetivo: { seguro: "245.00", gps: "0", membresias: "743.24" },
        tolerancia: TOLERANCIA,
      }).rechazar,
    ).toBe(false);

    // Y el caso 9234 NO pasa por esa puerta: Q1,000.00 contra una cuota de
    // Q2,998.48 no es el monto exacto de una cuota.
    expect(
      registerPaymentPolicy.shouldApplyStaleZeroRestanteAdjustment({
        hasExistingPayment: true,
        isFirstProcessedInstallment: true,
        isExactSingleInstallmentPayment: false,
        hasValidatedPayments: false,
        hasLastPartialPaymentWithRemaining: false,
        allRemainingZero: true,
        missingAgainstInstallment: "1998.48",
        availableRemaining: "1998.48",
      }),
    ).toBe(false);
  });

  it("no se mete cuando la cuota queda parcial (quedan restantes vivos)", () => {
    // Un parcial cobra de menos A PROPÓSITO: la cuota sigue abierta y el
    // faltante se puede seguir cobrando.
    expect(
      evaluarCierreCuotaPorPlanos({
        todosRestantesEnCero: false,
        cobrado: { seguro: "0", gps: "0", membresias: "0" },
        objetivo: { seguro: "245.00", gps: "0", membresias: "743.24" },
        tolerancia: TOLERANCIA,
      }).rechazar,
    ).toBe(false);
  });

  it("un crédito sin rubros planos nunca queda bloqueado", () => {
    expect(
      evaluarCierreCuotaPorPlanos({
        todosRestantesEnCero: true,
        cobrado: { seguro: "0", gps: "0", membresias: "0" },
        objetivo: { seguro: "0", gps: "0", membresias: "0" },
        tolerancia: TOLERANCIA,
      }).rechazar,
    ).toBe(false);
  });

  it("tolera el centavo de redondeo y no se queja de un sobre-cobro", () => {
    expect(
      evaluarCierreCuotaPorPlanos({
        todosRestantesEnCero: true,
        cobrado: { seguro: "244.99", gps: "150.01", membresias: "743.24" },
        objetivo: { seguro: "245.00", gps: "150.00", membresias: "743.24" },
        tolerancia: TOLERANCIA,
      }).rechazar,
    ).toBe(false);
  });
});

describe("decidirCierrePorRestantesEnCero (la validación NO se traba por planos)", () => {
  const { decidirCierrePorRestantesEnCero } = registerPaymentPolicy;

  it("cierra la cuota cuando no queda ningún hermano pendiente", () => {
    expect(
      decidirCierrePorRestantesEnCero({
        hayHermanoPendiente: false,
        filaPagada: true,
      }),
    ).toEqual({ cuotaCompleta: true, cierreDiferido: false });
  });

  it("difiere el cierre al hermano que falta validar, sin cerrar la cuota", () => {
    expect(
      decidirCierrePorRestantesEnCero({
        hayHermanoPendiente: true,
        filaPagada: true,
      }),
    ).toEqual({ cuotaCompleta: false, cierreDiferido: true });
    expect(
      decidirCierrePorRestantesEnCero({
        hayHermanoPendiente: true,
        filaPagada: false,
      }),
    ).toEqual({ cuotaCompleta: false, cierreDiferido: false });
  });

  it("la cobertura de los planos NO es una entrada de esta decisión", () => {
    // Es el invariante que la versión anterior rompió: si los planos cortos
    // pudieran impedir el cierre, la cuota de un recibo de cola quedaría
    // abierta para siempre (por RAMA A no se reescriben restantes ni se
    // distribuye a inversionistas). Los planos sólo dejan rastro.
    expect(
      decidirCierrePorRestantesEnCero({
        hayHermanoPendiente: false,
        filaPagada: false,
        // Aunque se le grite que los planos están cortos, cierra igual.
        planosCubiertos: false,
      } as any),
    ).toEqual({ cuotaCompleta: true, cierreDiferido: false });
  });
});

describe("decidirCierreCortoEnCascada (tirar sólo si no se escribió nada)", () => {
  const { decidirCierreCortoEnCascada } = registerPaymentPolicy;

  // Se arma igual que en el call-site (`cuotas_completas + cuotas_parciales >
  // 0`) para que el caso "ya hay una parcial" y el caso "ya hay una completa"
  // sean dos escenarios distintos y no la misma constante escrita dos veces.
  const yaSeEscribioAlgo = (completas: number, parciales: number) =>
    completas + parciales > 0;

  it("rechaza el pago cuando la cuota corta es la primera que toca la boleta", () => {
    // El caso del crédito 9234: la cuota 1 es la primera del cascadeo, no hay
    // ninguna fila commiteada, así que el throw es limpio — el cajero corrige
    // la boleta y reintenta sin dejar nada a medias.
    expect(
      decidirCierreCortoEnCascada({
        rechazar: true,
        yaSeEscribioAlgo: yaSeEscribioAlgo(0, 0),
      }),
    ).toBe("rechazar");
  });

  it("corta la cascada cuando ya hay una cuota completa escrita", () => {
    // 🔒 El candado: `insertPayment` no tiene transacción envolvente, así que
    // la cuota anterior YA está commiteada (fila, pagado=true, boleta,
    // restantes). Tirar acá deja la boleta a medias con un error al operador,
    // y con banco + autorización el reintento choca contra el dedupe.
    expect(
      decidirCierreCortoEnCascada({
        rechazar: true,
        yaSeEscribioAlgo: yaSeEscribioAlgo(1, 0),
      }),
    ).toBe("cortar");
  });

  it("corta también cuando lo escrito es una parcial", () => {
    // Una parcial escribe exactamente igual que una completa (misma fila,
    // misma boleta, mismos restantes sincronizados): el daño de tirar es el
    // mismo, de ahí que `yaSeEscribioAlgo` sume completas + parciales.
    expect(
      decidirCierreCortoEnCascada({
        rechazar: true,
        yaSeEscribioAlgo: yaSeEscribioAlgo(0, 1),
      }),
    ).toBe("cortar");
  });

  it("sigue de largo cuando no hay rechazo, haya o no cuotas escritas", () => {
    // Sin rechazo la compuerta no opina: el cascadeo normal no se toca.
    expect(
      decidirCierreCortoEnCascada({
        rechazar: false,
        yaSeEscribioAlgo: yaSeEscribioAlgo(0, 0),
      }),
    ).toBe("seguir");
    expect(
      decidirCierreCortoEnCascada({
        rechazar: false,
        yaSeEscribioAlgo: yaSeEscribioAlgo(2, 1),
      }),
    ).toBe("seguir");
  });
});

describe("restaurarDisponibleTrasCorteEnCascada (que el corte no evapore la plata)", () => {
  const { restaurarDisponibleTrasCorteEnCascada } = registerPaymentPolicy;

  // CONSERVACIÓN: la distribución de la cuota ya descontó `totalPagado` del
  // disponible, y el corte no escribe nada. Lo que entró a la iteración tiene
  // que ser exactamente lo que queda disponible al salir por el `break`: si no,
  // el monto no queda en la cuota, no llega a saldo a favor (el post-loop lee
  // `disponible_restante`) y no sale en la respuesta — se evapora con el pago
  // reportado exitoso.
  it("lo que entró a la iteración es lo que queda disponible al cortar", () => {
    const disponibleAlEntrar = new Big("500.00");
    const totalPagado = new Big("500.00");
    const disponibleAlBreak = disponibleAlEntrar.minus(totalPagado);

    expect(disponibleAlBreak.toFixed(2)).toBe("0.00");
    expect(
      restaurarDisponibleTrasCorteEnCascada({
        disponible: disponibleAlBreak,
        totalPagado,
      }).toFixed(2),
    ).toBe(disponibleAlEntrar.toFixed(2));
  });

  it("conserva también el sobrante que la cuota no alcanzó a consumir", () => {
    // Cuota que sólo pudo absorber 800 de los 1,000 que traía la boleta: al
    // cortar tienen que quedar disponibles los 1,000 completos.
    const disponibleAlEntrar = new Big("1000");
    const totalPagado = new Big("800");

    expect(
      restaurarDisponibleTrasCorteEnCascada({
        disponible: disponibleAlEntrar.minus(totalPagado),
        totalPagado,
      }).toFixed(2),
    ).toBe("1000.00");
  });

  it("no inventa plata cuando la cuota no consumió nada", () => {
    expect(
      restaurarDisponibleTrasCorteEnCascada({
        disponible: "250.75",
        totalPagado: "0",
      }).toFixed(2),
    ).toBe("250.75");
  });

  it("no pierde centavos (Big, no float)", () => {
    expect(
      restaurarDisponibleTrasCorteEnCascada({
        disponible: "0.1",
        totalPagado: "0.2",
      }).toString(),
    ).toBe("0.3");
  });
});
