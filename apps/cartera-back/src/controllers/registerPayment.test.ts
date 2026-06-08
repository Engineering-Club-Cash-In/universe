import { describe, expect, it } from "bun:test";
import {
  applyCapitalPaymentAndBuildResponse,
  getCuotaIdForPaymentInsert,
  getRequestedInstallmentFloor,
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
});
