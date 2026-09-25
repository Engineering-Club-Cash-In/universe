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

  it("descuenta los RUBROS antes del convenio, como el back", () => {
    // La cascada del backend es otros → mora → RUBROS → convenio → cuotas, y
    // acá los rubros no se restaban. El ejemplo: boleta de Q1,000 con Q800 de
    // rubros y un convenio de Q500. El back cobra los rubros primero y al
    // convenio sólo le quedan Q200; proyectar Q500 infla el umbral de excedente
    // en Q300 y la boleta pasa sin ofrecerle al asesor las opciones de
    // excedente que le correspondían.
    expect(getConvenioAplicado(1000, 0, 0, 500, 800)).toBe(200);
  });

  it("los rubros que consumen toda la boleta dejan el convenio en cero", () => {
    expect(getConvenioAplicado(1000, 0, 0, 500, 1200)).toBe(0);
  });

  it("sin rubros se comporta igual que antes", () => {
    // El parámetro es opcional: el resto de los llamadores no cambia.
    expect(getConvenioAplicado(230, 50, 30, 1006.45)).toBe(150);
  });
});
