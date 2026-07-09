import { describe, expect, it } from "bun:test";
import Big from "big.js";
import { calcDerivadosCubePuro } from "./absorberEnCube";

describe("calcDerivadosCubePuro", () => {
  it("CUBE-puro: todo va a cash_in, participacion en 0", () => {
    // monto 10000, tasa 2% => cuota = 200.00
    const d = calcDerivadosCubePuro(new Big("10000"), "2");
    expect(d.cuota_inversionista).toBe("200.00");
    expect(d.monto_cash_in).toBe("200.00");
    expect(d.monto_inversionista).toBe("0.00");
    expect(d.iva_cash_in).toBe("24.00");        // 200 * 0.12
    expect(d.iva_inversionista).toBe("0.00");
  });
});
