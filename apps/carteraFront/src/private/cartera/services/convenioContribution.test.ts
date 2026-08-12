import { describe, expect, it } from "bun:test";
import { getConvenioAplicado } from "./convenioContribution";

describe("getConvenioAplicado", () => {
  it("aplica solo lo disponible cuando la boleta es menor a la cuota del convenio", () => {
    expect(getConvenioAplicado(230, 0, 0, 1006.45)).toBe(230);
  });

  it("aplica la cuota completa cuando la boleta alcanza", () => {
    expect(getConvenioAplicado(1200, 0, 0, 1006.45)).toBe(1006.45);
  });

  it("descuenta otros y mora antes de aplicar al convenio", () => {
    expect(getConvenioAplicado(230, 50, 30, 1006.45)).toBe(150);
  });

  it("devuelve cero cuando no hay convenio activo", () => {
    expect(getConvenioAplicado(500, 0, 0, 0)).toBe(0);
  });

  it("devuelve cero cuando otros y mora consumen toda la boleta", () => {
    expect(getConvenioAplicado(100, 150, 0, 1006.45)).toBe(0);
  });
});
