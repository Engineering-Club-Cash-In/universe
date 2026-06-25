import { describe, expect, it } from "bun:test";
import Big from "big.js";
import {
  applyCapitalPaymentAndBuildResponse,
  calcularSaldoNetoCuota,
  esDestinoSobrescribible,
  getApplyPaymentHttpStatus,
  getCuotaIdForPaymentInsert,
  getRequestedInstallmentFloor,
  getSpecialPaymentCuotaId,
  getSpecialPaymentInstallmentFields,
  shouldApplyStaleZeroRestanteAdjustment,
  shouldRejectZeroAppliedNormalValidation,
  shouldMarkInstallmentPaymentPaid,
  sumarAplicadoACuota,
} from "./registerPaymentPolicy";

describe("register payment", () => {
  it("usa null en vez de 0 cuando el pago no tiene cuota", () => {
    expect(getCuotaIdForPaymentInsert(null)).toBeNull();
    expect(getCuotaIdForPaymentInsert(undefined)).toBeNull();
    expect(getCuotaIdForPaymentInsert(15)).toBe(15);
  });

  it("espera a que termine el abono a capital antes de responder", async () => {
    let resolveAbono: (() => void) | undefined;
    const applyCapitalAbono = () =>
      new Promise<void>((resolve) => {
        resolveAbono = resolve;
      });

    const resultPromise = applyCapitalPaymentAndBuildResponse(
      { credito_id: 10, abono_capital: "100" },
      99,
      applyCapitalAbono
    );
    await Promise.resolve();

    const firstSettled = await Promise.race([
      resultPromise.then(() => "resolved"),
      Promise.resolve("pending"),
    ]);

    expect(firstSettled).toBe("pending");

    resolveAbono?.();
    await expect(resultPromise).resolves.toMatchObject({ success: true });
  });

  it("no salta cuotas pendientes anteriores aunque el request venga adelantado", () => {
    expect(getRequestedInstallmentFloor(11)).toBe(1);
    expect(getRequestedInstallmentFloor(1)).toBe(1);
  });

  it("no marca como pagado un pago que solo cubre mora", () => {
    expect(
      shouldMarkInstallmentPaymentPaid({
        allRemainingZero: true,
        hasExistingInstallmentPayment: true,
        installmentAmountApplied: 0,
      })
    ).toBe(false);

    expect(
      shouldMarkInstallmentPaymentPaid({
        allRemainingZero: true,
        hasExistingInstallmentPayment: true,
        installmentAmountApplied: 100,
      })
    ).toBe(true);
  });

  it("rechaza validar un pago normal sin monto aplicado", () => {
    expect(
      shouldRejectZeroAppliedNormalValidation({
        validationStatus: "pending",
        nextValidationStatus: "validated",
        montoAplicado: "0.00",
        mora: "0.00",
        otros: "0",
        pagoConvenio: "0",
      })
    ).toBe(true);
  });

  it("rechaza revalidar un pago normal sin monto aplicado", () => {
    expect(
      shouldRejectZeroAppliedNormalValidation({
        validationStatus: "pending",
        nextValidationStatus: "validated",
        montoAplicado: "0",
        mora: "0",
        otros: "0",
        pagoConvenio: "0",
      })
    ).toBe(true);
  });

  it("permite validar filas especiales sin monto aplicado", () => {
    expect(
      shouldRejectZeroAppliedNormalValidation({
        validationStatus: "reset",
        nextValidationStatus: "validated",
        montoAplicado: "0.00",
      })
    ).toBe(false);

    expect(
      shouldRejectZeroAppliedNormalValidation({
        validationStatus: "pending",
        nextValidationStatus: "validated",
        montoAplicado: "0.00",
        mora: "25.00",
      })
    ).toBe(false);
  });

  it("mapea rechazos de regla de negocio de aplicar pago a HTTP 400", () => {
    expect(getApplyPaymentHttpStatus({ success: false })).toBe(400);
    expect(getApplyPaymentHttpStatus({ success: true })).toBe(200);
  });

  it("aplica el ajuste de restantes en cero a la primera cuota procesada aunque el request venga adelantado", () => {
    expect(
      shouldApplyStaleZeroRestanteAdjustment({
        hasExistingPayment: true,
        isFirstProcessedInstallment: true,
        isExactSingleInstallmentPayment: true,
        hasValidatedPayments: false,
        hasLastPartialPaymentWithRemaining: false,
        allRemainingZero: true,
        missingAgainstInstallment: "1443.25",
        availableRemaining: "1443.25",
      })
    ).toBe(true);
  });

  it("asocia pagos solo mora u otros a la cuota solicitada cuando existe entre las pendientes", () => {
    expect(
      getSpecialPaymentCuotaId({
        requestedInstallment: 11,
        pendingInstallments: [
          { numeroCuota: 10, cuotaId: 100 },
          { numeroCuota: 11, cuotaId: 110 },
          { numeroCuota: 12, cuotaId: 120 },
        ],
      })
    ).toBe(110);
  });

  it("conserva el fallback anterior para pagos especiales si la cuota solicitada no está pendiente", () => {
    expect(
      getSpecialPaymentCuotaId({
        requestedInstallment: 11,
        pendingInstallments: [
          { numeroCuota: 10, cuotaId: 100 },
          { numeroCuota: 12, cuotaId: 120 },
        ],
      })
    ).toBe(100);
  });

  it("no cuenta pagos solo mora u otros como abono a cuota pero conserva el pago liquidado", () => {
    expect(getSpecialPaymentInstallmentFields()).toEqual({
      montoAplicado: 0,
      pagado: true,
    });
  });
});

describe("sumarAplicadoACuota", () => {
  // Caso reportado: la cuota #5 vale 1793.40 pero el detector veía 20000
  // "ya aplicado" porque sumaba `monto_aplicado` de filas de mora/otros. Esas
  // filas traen TODOS los `abono_*` en 0, así que no deben sumar nada a la
  // cuota: lo aplicado real son sólo los rubros de cuota de los pagos normales.
  it("ignora mora/otros (rubros en 0) y sólo cuenta lo aplicado a la cuota", () => {
    const rows = [
      // fila de sólo mora/otros: monto_aplicado=20000 pero rubros en 0
      {
        abono_capital: 0,
        abono_interes: 0,
        abono_iva_12: 0,
        abono_seguro: 0,
        abono_gps: 0,
        membresias_pago: 0,
      },
      // pago de cuota normal: rubros suman 1793.40
      {
        abono_capital: 1400.0,
        abono_interes: 350.0,
        abono_iva_12: 42.0,
        abono_seguro: 0,
        abono_gps: 1.4,
        membresias_pago: 0,
      },
    ];
    expect(sumarAplicadoACuota(rows).toFixed(2)).toBe("1793.40");
  });

  it("suma todos los rubros de cuota (incluido el capital de la cuota)", () => {
    const r = sumarAplicadoACuota([
      {
        abono_capital: 845.12,
        abono_interes: 177.86,
        abono_iva_12: 21.34,
        abono_seguro: 260.93,
        abono_gps: 138.0,
        membresias_pago: 0,
      },
    ]);
    expect(r.toFixed(2)).toBe("1443.25");
  });

  it("es 0 sin hermanos y tolera campos nulos/ausentes", () => {
    expect(sumarAplicadoACuota([]).toFixed(2)).toBe("0.00");
    expect(
      sumarAplicadoACuota([
        { abono_capital: null, abono_interes: "100" },
      ]).toFixed(2)
    ).toBe("100.00");
  });

  it("trabaja con strings (la forma real que devuelve Drizzle para numeric)", () => {
    // Las columnas numeric de pagos_credito vuelven como string, no number.
    const r = sumarAplicadoACuota([
      {
        abono_capital: "1400.00",
        abono_interes: "350.00",
        abono_iva_12: "42.00",
        abono_seguro: "0",
        abono_gps: "1.40",
        membresias_pago: "0",
      },
    ]);
    expect(r.toFixed(2)).toBe("1793.40");
  });

  it("suma varios parciales de cuota (filas hermanas) sin perder centavos", () => {
    const r = sumarAplicadoACuota([
      { abono_capital: "500.00", abono_interes: "100.00", abono_iva_12: "12.00" },
      { abono_capital: "300.00", abono_interes: "50.00", abono_iva_12: "6.00" },
      { abono_seguro: "260.93", abono_gps: "138.00", membresias_pago: "0" },
    ]);
    expect(r.toFixed(2)).toBe("1366.93");
  });

  it("una fila de sólo mora/otros (todos los abono_* en 0) aporta 0 aunque su monto_aplicado sea enorme", () => {
    // monto_aplicado=20000 vive en la fila pero NO se mira aquí: sólo rubros.
    expect(
      sumarAplicadoACuota([
        {
          abono_capital: "0",
          abono_interes: "0",
          abono_iva_12: "0",
          abono_seguro: "0",
          abono_gps: "0",
          membresias_pago: "0",
        },
      ]).toFixed(2)
    ).toBe("0.00");
  });
});

// Reproducción end-to-end del caso reportado a nivel de política: la cuota #5
// (1793.40) tiene un hermano de SÓLO mora/otros con monto_aplicado=20000. Antes,
// `aplicadoPrevioCuota = Σ monto_aplicado = 20000` colapsaba `saldoRealCuota` a 0
// → la cuota no se podía pagar Y la red de seguridad tronaba con "sobre-aplicada".
// Con `sumarAplicadoACuota` (rubros, no monto_aplicado) el hermano aporta 0 y la
// cuota vuelve a ser pagable por su monto completo.
describe("regresión: mora/otros no debe colapsar el saldo de la cuota", () => {
  const hermanoSoloMora = {
    abono_capital: "0",
    abono_interes: "0",
    abono_iva_12: "0",
    abono_seguro: "0",
    abono_gps: "0",
    membresias_pago: "0",
  };

  it("con el cálculo VIEJO (monto_aplicado) el saldo de la cuota se iría a 0 (estado a evitar)", () => {
    // Simula el bug: medir por monto_aplicado de la fila de mora.
    const aplicadoViejo = 20000;
    const saldo = calcularSaldoNetoCuota({
      montoCuota: 1793.4,
      aplicadoPrevioCuota: aplicadoViejo,
      filaInteresRestante: 0,
      filaIvaRestante: 0,
      filaSeguroRestante: 0,
      filaGpsRestante: 0,
      filaMembresiasRestante: 0,
      filaCapitalRestante: 1793.4,
      objetivoSeguro: 0,
      objetivoGps: 0,
      objetivoMembresias: 0,
      hermanosSeguro: 0,
      hermanosGps: 0,
      hermanosMembresias: 0,
      hermanosInteres: 0,
      hermanosIva: 0,
    });
    expect(saldo.saldoRealCuota.toFixed(2)).toBe("0.00"); // cuota trabada (bug)
  });

  it("con el cálculo NUEVO (sumarAplicadoACuota) la cuota sigue siendo pagable por su monto completo", () => {
    const aplicadoNuevo = sumarAplicadoACuota([hermanoSoloMora]); // = 0
    expect(aplicadoNuevo.toFixed(2)).toBe("0.00");

    const saldo = calcularSaldoNetoCuota({
      montoCuota: 1793.4,
      aplicadoPrevioCuota: aplicadoNuevo,
      filaInteresRestante: 0,
      filaIvaRestante: 0,
      filaSeguroRestante: 0,
      filaGpsRestante: 0,
      filaMembresiasRestante: 0,
      filaCapitalRestante: 1793.4,
      objetivoSeguro: 0,
      objetivoGps: 0,
      objetivoMembresias: 0,
      hermanosSeguro: 0,
      hermanosGps: 0,
      hermanosMembresias: 0,
      hermanosInteres: 0,
      hermanosIva: 0,
    });
    expect(saldo.saldoRealCuota.toFixed(2)).toBe("1793.40"); // cuota pagable
    expect(saldo.capitalRestante.toFixed(2)).toBe("1793.40");

    // Y la red de seguridad ya no tronaría: aplicado(0) + pago(1793.40) == cuota.
    const totalProyectado = aplicadoNuevo.plus(1793.4);
    expect(totalProyectado.gt(new Big(1793.4).plus(0.01))).toBe(false);
  });

  it("un hermano REAL de cuota (con rubros) sí cuenta y topa el faltante correctamente", () => {
    // Hermano que ya aplicó 793.40 de cuota (capital+interés) → faltan 1000.
    const aplicado = sumarAplicadoACuota([
      { abono_capital: "700.00", abono_interes: "82.50", abono_iva_12: "10.90" },
    ]);
    expect(aplicado.toFixed(2)).toBe("793.40");
    const saldo = calcularSaldoNetoCuota({
      montoCuota: 1793.4,
      aplicadoPrevioCuota: aplicado,
      filaInteresRestante: 0,
      filaIvaRestante: 0,
      filaSeguroRestante: 0,
      filaGpsRestante: 0,
      filaMembresiasRestante: 0,
      filaCapitalRestante: 1793.4,
      objetivoSeguro: 0,
      objetivoGps: 0,
      objetivoMembresias: 0,
      hermanosSeguro: 0,
      hermanosGps: 0,
      hermanosMembresias: 0,
      hermanosInteres: 0,
      hermanosIva: 0,
    });
    expect(saldo.saldoRealCuota.toFixed(2)).toBe("1000.00");
  });
});

// Bug crédito 217 / cuota #8: el placeholder `no_required` de la cuota YA fue
// consumido por un parcial anterior (esa fila pasó a `validated` con
// `abono_interes` real, ya facturado). Al llegar el pago que CIERRA la cuota,
// `pagoOriginal` (no_required) es undefined y `existingPago` cae al fallback
// `allExistingPagos[0]` = la fila REAL más vieja. El cierre hacía UPDATE sobre
// esa fila, BORRANDO un pago de interés validado/facturado. El fix: el cierre
// solo puede UPDATE-ar un destino realmente desechable; si no, INSERTA fila nueva.
describe("esDestinoSobrescribible", () => {
  it("el placeholder no_required SIEMPRE es sobrescribible (aunque trajera saldos)", () => {
    expect(
      esDestinoSobrescribible({
        validationStatus: "no_required",
        monto_aplicado: "0",
        abono_capital: "0",
        abono_interes: "0",
      })
    ).toBe(true);
  });

  it("una fila vacía (monto_aplicado≈0 y todos los abono_* ≈0) es sobrescribible", () => {
    expect(
      esDestinoSobrescribible({
        validationStatus: "pending",
        monto_aplicado: "0",
        abono_capital: "0",
        abono_interes: "0",
        abono_iva_12: "0",
        abono_seguro: "0",
        abono_gps: "0",
        membresias_pago: "0",
      })
    ).toBe(true);
  });

  it("tolera centavos de ruido al medir 'vacío'", () => {
    expect(
      esDestinoSobrescribible({
        validationStatus: "validated",
        monto_aplicado: "0.00",
        abono_capital: "0.005",
        abono_interes: "0",
      })
    ).toBe(true);
  });

  it("un pago real de EXACTAMENTE Q0.01 NO es sobrescribible (numeric(2) es exacto)", () => {
    // Codex P2: con `lte(0.01)` un parcial de un centavo se trataba como vacío
    // y el cierre lo machacaba. Debe contar como pago real.
    expect(
      esDestinoSobrescribible({
        validationStatus: "validated",
        monto_aplicado: "0.01",
        abono_capital: "0",
        abono_interes: "0.01",
        abono_iva_12: "0",
        abono_seguro: "0",
        abono_gps: "0",
        membresias_pago: "0",
      })
    ).toBe(false);
  });

  it("un pago REAL (con abono_interes validado) NO es sobrescribible", () => {
    // Caso crédito 217: fila validated con interés real ya facturado.
    expect(
      esDestinoSobrescribible({
        validationStatus: "validated",
        monto_aplicado: "1151.00",
        abono_capital: "0",
        abono_interes: "1027.68",
        abono_iva_12: "123.32",
        abono_seguro: "0",
        abono_gps: "0",
        membresias_pago: "0",
      })
    ).toBe(false);
  });

  it("una fila con monto_aplicado real pero rubros en 0 NO es sobrescribible", () => {
    // p.ej. fila solo-mora/otros con plata aplicada: no la queremos pisar.
    expect(
      esDestinoSobrescribible({
        validationStatus: "validated",
        monto_aplicado: "200.00",
        abono_capital: "0",
        abono_interes: "0",
      })
    ).toBe(false);
  });

  it("una fila con solo abono_capital real NO es sobrescribible", () => {
    expect(
      esDestinoSobrescribible({
        validationStatus: "pending",
        monto_aplicado: "0",
        abono_capital: "500.00",
        abono_interes: "0",
      })
    ).toBe(false);
  });

  it("un pago de solo MORA (monto_aplicado/abono_* en 0) NO es sobrescribible", () => {
    // Codex P2: insertarPago crea filas mora/otros con monto_aplicado:0 y
    // abono_* en 0 pero plata en mora. No debe tratarse como vacío.
    expect(
      esDestinoSobrescribible({
        validationStatus: "pending",
        monto_aplicado: "0",
        abono_capital: "0",
        abono_interes: "0",
        mora: "150.00",
      })
    ).toBe(false);
  });

  it("un pago de solo OTROS (TEXT con monto) NO es sobrescribible", () => {
    expect(
      esDestinoSobrescribible({
        validationStatus: "pending",
        monto_aplicado: "0",
        abono_interes: "0",
        otros: "300.00",
      })
    ).toBe(false);
  });

  it("una fila con `otros` vacío/no-numérico SÍ puede ser vacía", () => {
    expect(
      esDestinoSobrescribible({
        validationStatus: "no_required",
        monto_aplicado: "0",
        otros: "",
      })
    ).toBe(true);
  });
});

// Réplica pura del árbol de decisión insert-vs-update del cierre en
// `insertPayment` (registerPayment.ts ~1378): NO toca DB; modela exactamente la
// rama elegida y el conjunto de filas resultante de la cuota, para asegurar que
// (a) la fila real preexistente nunca se sobrescribe, (b) se INSERTA una fila de
// cierre, y (c) no se pierde ni se duplica plata en la cuota.
type FilaCuota = {
  pago_id: number;
  validationStatus: string;
  monto_aplicado: string;
  abono_capital: string;
  abono_interes: string;
  abono_iva_12: string;
};

const sumaRubrosCuota = (filas: FilaCuota[]) =>
  filas
    .reduce(
      (acc, f) =>
        acc
          .plus(new Big(f.abono_capital))
          .plus(new Big(f.abono_interes))
          .plus(new Big(f.abono_iva_12)),
      new Big(0)
    )
    .toFixed(2);

/**
 * Aplica la decisión de cierre tal como lo hace el controlador:
 *  - pagado && destinoSobrescribible → UPDATE sobre existingPago.
 *  - pagado && !destinoSobrescribible → INSERT fila de cierre nueva.
 *  - !pagado → INSERT parcial.
 * Devuelve el nuevo set de filas de la cuota.
 */
const aplicarDecisionCierre = (
  filas: FilaCuota[],
  existingPagoId: number,
  pagoData: {
    pagado: boolean;
    abono_capital: string;
    abono_interes: string;
    abono_iva_12: string;
    monto_aplicado: string;
  }
): FilaCuota[] => {
  const existing = filas.find((f) => f.pago_id === existingPagoId)!;
  const sobrescribible = esDestinoSobrescribible(existing);
  const nuevaFila: FilaCuota = {
    pago_id: Math.max(...filas.map((f) => f.pago_id)) + 1,
    validationStatus: "pending",
    monto_aplicado: pagoData.monto_aplicado,
    abono_capital: pagoData.abono_capital,
    abono_interes: pagoData.abono_interes,
    abono_iva_12: pagoData.abono_iva_12,
  };

  if (pagoData.pagado && sobrescribible) {
    return filas.map((f) =>
      f.pago_id === existingPagoId
        ? {
            ...f,
            validationStatus: "pending",
            monto_aplicado: pagoData.monto_aplicado,
            abono_capital: pagoData.abono_capital,
            abono_interes: pagoData.abono_interes,
            abono_iva_12: pagoData.abono_iva_12,
          }
        : f
    );
  }
  // INSERT (cierre-nuevo o parcial): se preservan todas las filas previas.
  return [...filas, nuevaFila];
};

describe("cierre de cuota: no sobrescribe un pago real cuando el no_required ya fue consumido", () => {
  it("INSERTA una fila de cierre y conserva la fila validated preexistente (crédito 217 / cuota 8)", () => {
    // Estado: el placeholder no_required YA fue consumido por un parcial → no
    // existe fila no_required; queda una fila `validated` con interés real
    // (Q1151 ya facturado) y la cuota aún tiene capital pendiente.
    const filasPrevias: FilaCuota[] = [
      {
        pago_id: 5001, // fila REAL (parcial validado de interés, ya facturado)
        validationStatus: "validated",
        monto_aplicado: "1151.00",
        abono_capital: "0",
        abono_interes: "1027.68",
        abono_iva_12: "123.32",
      },
    ];
    // existingPago cae al fallback allExistingPagos[0] = la fila real 5001.
    const existingPagoId = 5001;
    expect(esDestinoSobrescribible(filasPrevias[0])).toBe(false);

    // Pago que CIERRA la cuota: cubre el capital faltante (cuota = 2151).
    const pagoData = {
      pagado: true,
      abono_capital: "1000.00",
      abono_interes: "0",
      abono_iva_12: "0",
      monto_aplicado: "1000.00",
    };

    const resultado = aplicarDecisionCierre(
      filasPrevias,
      existingPagoId,
      pagoData
    );

    // (a) la fila validated preexistente NO se modificó.
    const filaPreexistente = resultado.find((f) => f.pago_id === 5001)!;
    expect(filaPreexistente.validationStatus).toBe("validated");
    expect(filaPreexistente.abono_interes).toBe("1027.68");
    expect(filaPreexistente.monto_aplicado).toBe("1151.00");

    // (b) se INSERTÓ una fila nueva de cierre.
    expect(resultado).toHaveLength(2);
    const filaCierre = resultado.find((f) => f.pago_id !== 5001)!;
    expect(filaCierre.abono_capital).toBe("1000.00");

    // (c) Σ de rubros de la cuota = composición real (1151 previo + 1000 cierre
    //     = 2151), sin perder ni duplicar plata.
    expect(sumaRubrosCuota(resultado)).toBe("2151.00");
  });

  it("comportamiento intacto: con placeholder no_required vivo el cierre hace UPDATE (no inserta)", () => {
    // Caso normal: existe el placeholder no_required (sin rubros). El cierre lo
    // sobrescribe (UPDATE) → NO crece el número de filas.
    const filasPrevias: FilaCuota[] = [
      {
        pago_id: 7001, // placeholder no_required (pago_id == cuota_id típicamente)
        validationStatus: "no_required",
        monto_aplicado: "0",
        abono_capital: "0",
        abono_interes: "0",
        abono_iva_12: "0",
      },
    ];
    const pagoData = {
      pagado: true,
      abono_capital: "1900.00",
      abono_interes: "224.11",
      abono_iva_12: "26.89",
      monto_aplicado: "2151.00",
    };

    const resultado = aplicarDecisionCierre(filasPrevias, 7001, pagoData);

    // UPDATE: misma cantidad de filas, el placeholder ahora trae el cierre.
    expect(resultado).toHaveLength(1);
    expect(resultado[0].pago_id).toBe(7001);
    expect(resultado[0].validationStatus).toBe("pending");
    expect(resultado[0].abono_capital).toBe("1900.00");
    expect(sumaRubrosCuota(resultado)).toBe("2151.00");
  });
});

describe("calcularSaldoNetoCuota", () => {
  // Caso real crédito 1086 / cuota 48: ya tiene un pago validado de Q1,345.00
  // (seguro y GPS COMPLETOS) pero la fila vigente quedó con los `*_restante`
  // desincronizados (seguro 260.93 y GPS 138 como si no se hubieran pagado, y
  // capital inflado en 1044.32). Antes esto hacía que un parcial intentara
  // re-aplicar Q1,167.65 y tronara con "cuota sobre-aplicada".
  it("netea rubros ya pagados por hermanos y topa el capital al faltante real", () => {
    const r = calcularSaldoNetoCuota({
      montoCuota: 1443.25,
      aplicadoPrevioCuota: 1345.0,
      filaInteresRestante: 0,
      filaIvaRestante: 0,
      filaSeguroRestante: 260.93,
      filaGpsRestante: 138.0,
      filaMembresiasRestante: 0,
      filaCapitalRestante: 1044.32,
      objetivoSeguro: 260.93,
      objetivoGps: 138.0,
      objetivoMembresias: 0,
      hermanosSeguro: 260.93,
      hermanosGps: 138.0,
      hermanosMembresias: 0,
      hermanosInteres: 0,
      hermanosIva: 0,
    });

    // Solo quedan Q98.25 (capital) para cerrar la cuota.
    expect(r.saldoRealCuota.toFixed(2)).toBe("98.25");
    expect(r.seguroRestante.toFixed(2)).toBe("0.00"); // ya pagado por hermano
    expect(r.gpsRestante.toFixed(2)).toBe("0.00"); // ya pagado por hermano
    expect(r.interesRestante.toFixed(2)).toBe("0.00");
    expect(r.ivaRestante.toFixed(2)).toBe("0.00");
    expect(r.capitalRestante.toFixed(2)).toBe("98.25");

    // Invariante anti-sobreaplicación: lo distribuible nunca supera el faltante.
    const distribuible = r.interesRestante
      .plus(r.ivaRestante)
      .plus(r.seguroRestante)
      .plus(r.gpsRestante)
      .plus(r.membresiasRestante)
      .plus(r.capitalRestante);
    expect(distribuible.toFixed(2)).toBe("98.25");
  });

  // Cuota fresca (sin pagos hermanos): el neteo debe ser no-op y respetar el
  // desglose por rubro de la fila para no romper la facturación normal.
  it("es no-op en una cuota fresca sin pagos hermanos", () => {
    const r = calcularSaldoNetoCuota({
      montoCuota: 1443.25,
      aplicadoPrevioCuota: 0,
      filaInteresRestante: 177.86,
      filaIvaRestante: 21.34,
      filaSeguroRestante: 260.93,
      filaGpsRestante: 138.0,
      filaMembresiasRestante: 0,
      filaCapitalRestante: 845.12,
      objetivoSeguro: 260.93,
      objetivoGps: 138.0,
      objetivoMembresias: 0,
      hermanosSeguro: 0,
      hermanosGps: 0,
      hermanosMembresias: 0,
      hermanosInteres: 0,
      hermanosIva: 0,
    });

    expect(r.saldoRealCuota.toFixed(2)).toBe("1443.25");
    expect(r.interesRestante.toFixed(2)).toBe("177.86");
    expect(r.ivaRestante.toFixed(2)).toBe("21.34");
    expect(r.seguroRestante.toFixed(2)).toBe("260.93");
    expect(r.gpsRestante.toFixed(2)).toBe("138.00");
    expect(r.capitalRestante.toFixed(2)).toBe("845.12");

    const distribuible = r.interesRestante
      .plus(r.ivaRestante)
      .plus(r.seguroRestante)
      .plus(r.gpsRestante)
      .plus(r.membresiasRestante)
      .plus(r.capitalRestante);
    expect(distribuible.toFixed(2)).toBe("1443.25");
  });

  // Aunque la fila muestre capital inflado, nunca se puede pasar del faltante.
  it("nunca distribuye más que el faltante real aunque la fila esté inflada", () => {
    const r = calcularSaldoNetoCuota({
      montoCuota: 1443.25,
      aplicadoPrevioCuota: 1400.0,
      filaInteresRestante: 0,
      filaIvaRestante: 0,
      filaSeguroRestante: 0,
      filaGpsRestante: 0,
      filaMembresiasRestante: 0,
      filaCapitalRestante: 9999.99, // basura
      objetivoSeguro: 260.93,
      objetivoGps: 138.0,
      objetivoMembresias: 0,
      hermanosSeguro: 260.93,
      hermanosGps: 138.0,
      hermanosMembresias: 0,
      hermanosInteres: 0,
      hermanosIva: 0,
    });
    expect(r.saldoRealCuota.toFixed(2)).toBe("43.25");
    expect(r.capitalRestante.toFixed(2)).toBe("43.25");
  });

  // Escenario reportado por Codex: la fila vigente está STALE para interés/IVA
  // (los muestra como por pagar) pero OTRO hermano ya los abonó. Sin netear
  // interés/IVA, se re-aplicarían y el capital se sub-aplicaría quedando bajo
  // el total de la cuota → el throw de seguridad no lo cachaba. Con el neteo
  // (fila − abonos de otros hermanos) interés/IVA caen a 0 y el capital recibe
  // todo el faltante real.
  it("netea interés/IVA stale contra los abonos de otros hermanos", () => {
    const r = calcularSaldoNetoCuota({
      montoCuota: 1443.25,
      aplicadoPrevioCuota: 1345.0,
      // fila vigente stale: muestra interés/IVA por pagar pese a que un hermano
      // ya los abonó (interés 50, IVA 10).
      filaInteresRestante: 50.0,
      filaIvaRestante: 10.0,
      filaSeguroRestante: 260.93,
      filaGpsRestante: 138.0,
      filaMembresiasRestante: 0,
      filaCapitalRestante: 1044.32,
      objetivoSeguro: 260.93,
      objetivoGps: 138.0,
      objetivoMembresias: 0,
      hermanosSeguro: 260.93,
      hermanosGps: 138.0,
      hermanosMembresias: 0,
      // interés/IVA ya abonados por OTRO hermano (no la fila vigente).
      hermanosInteres: 50.0,
      hermanosIva: 10.0,
    });

    expect(r.interesRestante.toFixed(2)).toBe("0.00"); // no se re-aplica
    expect(r.ivaRestante.toFixed(2)).toBe("0.00"); // no se re-aplica
    expect(r.seguroRestante.toFixed(2)).toBe("0.00");
    expect(r.gpsRestante.toFixed(2)).toBe("0.00");
    // el capital recibe el faltante real completo, no un residuo sub-aplicado.
    expect(r.capitalRestante.toFixed(2)).toBe("98.25");

    const distribuible = r.interesRestante
      .plus(r.ivaRestante)
      .plus(r.seguroRestante)
      .plus(r.gpsRestante)
      .plus(r.membresiasRestante)
      .plus(r.capitalRestante);
    expect(distribuible.toFixed(2)).toBe("98.25");
  });

  // La fila vigente puede legítimamente tener interés/IVA pendientes que NO
  // debe netear (no hay hermanos que los hayan abonado): se respetan tal cual.
  it("respeta interés/IVA de la fila cuando ningún otro hermano los abonó", () => {
    const r = calcularSaldoNetoCuota({
      montoCuota: 1443.25,
      aplicadoPrevioCuota: 0,
      filaInteresRestante: 177.86,
      filaIvaRestante: 21.34,
      filaSeguroRestante: 260.93,
      filaGpsRestante: 138.0,
      filaMembresiasRestante: 0,
      filaCapitalRestante: 845.12,
      objetivoSeguro: 260.93,
      objetivoGps: 138.0,
      objetivoMembresias: 0,
      hermanosSeguro: 0,
      hermanosGps: 0,
      hermanosMembresias: 0,
      hermanosInteres: 0,
      hermanosIva: 0,
    });
    expect(r.interesRestante.toFixed(2)).toBe("177.86");
    expect(r.ivaRestante.toFixed(2)).toBe("21.34");
  });
});
