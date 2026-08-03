import { describe, expect, it } from "bun:test";
import Big from "big.js";
import {
  cuentaParaRubroInv,
  decidirRubroInteresInversionistas,
} from "./rubroInteresInversionistas";

describe("decidirRubroInteresInversionistas", () => {
  it("1. interesFlujoOk=false → null aunque haya montos en pci y/o corrida", () => {
    expect(
      decidirRubroInteresInversionistas({
        interesFlujoOk: false,
        pciTotal: new Big(1000),
        pciIva: new Big(107.14),
        corridaTotal: new Big(500),
        corridaIva: new Big(53.57),
      })
    ).toBeNull();
  });

  it("2. pci > 0 manda: devuelve pci aunque la corrida difiera", () => {
    expect(
      decidirRubroInteresInversionistas({
        interesFlujoOk: true,
        pciTotal: new Big("1000.50"),
        pciIva: new Big("107.20"),
        corridaTotal: new Big("3020.69"),
        corridaIva: new Big("323.64"),
      })
    ).toEqual({ monto_total: "1000.50", monto_iva: "107.20" });
  });

  it("3. pci = 0 y corrida > 0 → devuelve lo facturado en la corrida", () => {
    expect(
      decidirRubroInteresInversionistas({
        interesFlujoOk: true,
        pciTotal: new Big(0),
        pciIva: new Big(0),
        corridaTotal: new Big("250.00"),
        corridaIva: new Big("26.79"),
      })
    ).toEqual({ monto_total: "250.00", monto_iva: "26.79" });
  });

  it("4. pci = 0 y corrida = 0 → null", () => {
    expect(
      decidirRubroInteresInversionistas({
        interesFlujoOk: true,
        pciTotal: new Big(0),
        pciIva: new Big(0),
        corridaTotal: new Big(0),
        corridaIva: new Big(0),
      })
    ).toBeNull();
  });

  it("5. caso real pago 149632 (parcial): corrida 3020.69 / 323.64", () => {
    expect(
      decidirRubroInteresInversionistas({
        interesFlujoOk: true,
        pciTotal: new Big(0),
        pciIva: new Big(0),
        corridaTotal: new Big("3020.69"),
        corridaIva: new Big("323.64"),
      })
    ).toEqual({ monto_total: "3020.69", monto_iva: "323.64" });
  });

  it("6. redondeo: más de 2 decimales salen a toFixed(2)", () => {
    expect(
      decidirRubroInteresInversionistas({
        interesFlujoOk: true,
        pciTotal: new Big("1234.5678"),
        pciIva: new Big("132.2749"),
        corridaTotal: new Big(0),
        corridaIva: new Big(0),
      })
    ).toEqual({ monto_total: "1234.57", monto_iva: "132.27" });
  });

  it("7a. pci negativo cae al fallback de corrida (semántica gt(0))", () => {
    expect(
      decidirRubroInteresInversionistas({
        interesFlujoOk: true,
        pciTotal: new Big("-5"),
        pciIva: new Big("-0.54"),
        corridaTotal: new Big("100.00"),
        corridaIva: new Big("10.71"),
      })
    ).toEqual({ monto_total: "100.00", monto_iva: "10.71" });
  });

  it("7b. pci con ruido (0.004) sigue siendo > 0 → gana pci y redondea a 0.00", () => {
    expect(
      decidirRubroInteresInversionistas({
        interesFlujoOk: true,
        pciTotal: new Big("0.004"),
        pciIva: new Big("0.0004"),
        corridaTotal: new Big("500.00"),
        corridaIva: new Big("53.57"),
      })
    ).toEqual({ monto_total: "0.00", monto_iva: "0.00" });
  });

  it("7c. corrida negativa con pci en 0 → null (no se escribe rubro)", () => {
    expect(
      decidirRubroInteresInversionistas({
        interesFlujoOk: true,
        pciTotal: new Big(0),
        pciIva: new Big(0),
        corridaTotal: new Big("-3"),
        corridaIva: new Big("-0.32"),
      })
    ).toBeNull();
  });
});

describe("cuentaParaRubroInv", () => {
  it("CUBE → false", () => {
    expect(
      cuentaParaRubroInv({ nombre: "CUBE INVESTMENTS S.A.", emite_factura: false }, false)
    ).toBe(false);
  });

  it("redirigido a CUBE → false", () => {
    expect(
      cuentaParaRubroInv({ nombre: "Rodrigo Estrada Osorio", emite_factura: false }, true)
    ).toBe(false);
  });

  it("emite_factura=true → false", () => {
    expect(
      cuentaParaRubroInv({ nombre: "SE PRESTA S.A.", emite_factura: true }, false)
    ).toBe(false);
  });

  it("no-CUBE con emite_factura=false → true", () => {
    expect(
      cuentaParaRubroInv({ nombre: "Rodrigo Estrada Osorio", emite_factura: false }, false)
    ).toBe(true);
  });

  it("emite_factura null/undefined se trata como false → true", () => {
    expect(cuentaParaRubroInv({ nombre: "Juan Perez", emite_factura: null }, false)).toBe(true);
  });
});
