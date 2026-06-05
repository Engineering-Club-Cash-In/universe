import { describe, expect, it } from "bun:test";
import {
  applyCapitalPaymentAndBuildResponse,
  calcularSaldoNetoCuota,
  getCuotaIdForPaymentInsert,
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
    });
    expect(r.saldoRealCuota.toFixed(2)).toBe("43.25");
    expect(r.capitalRestante.toFixed(2)).toBe("43.25");
  });
});
