import { describe, expect, it } from "bun:test";
import {
  applyCapitalPaymentAndBuildResponse,
  calcularSaldoNetoCuota,
  getCuotaIdForPaymentInsert,
  getRequestedInstallmentFloor,
  getSpecialPaymentCuotaId,
  getSpecialPaymentInstallmentFields,
  shouldApplyStaleZeroRestanteAdjustment,
  shouldMarkInstallmentPaymentPaid,
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

  it("no cuenta pagos solo mora u otros como abono a cuota", () => {
    expect(getSpecialPaymentInstallmentFields()).toEqual({
      montoAplicado: 0,
      pagado: false,
    });
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
