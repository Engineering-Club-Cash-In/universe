import { describe, expect, it } from "bun:test";
import Big from "big.js";
import { resolverAbonosNoLiquidados } from "./abonosNoLiquidados";

describe("resolverAbonosNoLiquidados", () => {
  it("sin abonos pendientes, no hace nada", () => {
    const res = resolverAbonosNoLiquidados({
      abonosNoLiquidados: [],
      abonoCapitalBase: new Big(100),
      montoAportado: "5000",
      devolucionCompleta: false,
      isCube: false,
    });

    expect(res.abonoCapital.toString()).toBe("100");
    expect(res.abonoCapitalId).toBeNull();
    expect(res.abonoIdsConsumidos).toEqual([]);
    expect(res.saltado).toBe(false);
  });

  it("devolución completa: un CAPITAL pendiente se consume sin sumarse (el pago devuelve el capital completo y evita filas huérfanas)", () => {
    const res = resolverAbonosNoLiquidados({
      abonosNoLiquidados: [{ abono_id: 1, tipo: "CAPITAL", monto: "500" }],
      abonoCapitalBase: new Big(5000),
      montoAportado: "5000",
      devolucionCompleta: true,
      isCube: false,
    });

    expect(res.abonoCapital.toString()).toBe("5000");
    expect(res.abonoIdsConsumidos).toEqual([1]);
    expect(res.saltado).toBe(true);
  });

  it("devolución completa: la CANCELACION se consume sin sumarse (es el mismo monto_aportado que ya se paga)", () => {
    const res = resolverAbonosNoLiquidados({
      abonosNoLiquidados: [{ abono_id: 9, tipo: "CANCELACION", monto: "5000" }],
      abonoCapitalBase: new Big(5000),
      montoAportado: "5000",
      devolucionCompleta: true,
      isCube: false,
    });

    expect(res.abonoCapital.toString()).toBe("5000");
    expect(res.abonoIdsConsumidos).toEqual([9]);
    expect(res.saltado).toBe(true);
    expect(res.abonoCapitalId).toBeNull();
  });

  it("devolución completa con CANCELACION + CAPITAL: consume ambos abonos para no dejar filas huérfanas", () => {
    const res = resolverAbonosNoLiquidados({
      abonosNoLiquidados: [
        { abono_id: 9, tipo: "CANCELACION", monto: "5000" },
        { abono_id: 10, tipo: "CAPITAL", monto: "700" },
      ],
      abonoCapitalBase: new Big(5000),
      montoAportado: "5000",
      devolucionCompleta: true,
      isCube: false,
    });

    expect(res.abonoCapital.toString()).toBe("5000");
    expect(res.abonoIdsConsumidos).toEqual([9, 10]);
    expect(res.saltado).toBe(true);
  });

  it("inversionista normal (no-CUBE) con varias filas: abonoCapitalId sigue siendo el primer id crudo, sin cambio de comportamiento", () => {
    const res = resolverAbonosNoLiquidados({
      abonosNoLiquidados: [
        { abono_id: 5, tipo: "CAPITAL", monto: "300" },
        { abono_id: 6, tipo: "CANCELACION", monto: "9999" },
      ],
      abonoCapitalBase: new Big(0),
      montoAportado: "9999",
      devolucionCompleta: false,
      isCube: false,
    });

    expect(res.abonoIdsConsumidos).toEqual([5, 6]);
    expect(res.abonoCapitalId).toBe(5);
  });

  it("CAPITAL se suma normal, para CUBE también", () => {
    const res = resolverAbonosNoLiquidados({
      abonosNoLiquidados: [{ abono_id: 1, tipo: "CAPITAL", monto: "500" }],
      abonoCapitalBase: new Big(100),
      montoAportado: "5000",
      devolucionCompleta: false,
      isCube: true,
    });

    expect(res.abonoCapital.toString()).toBe("600");
    expect(res.abonoIdsConsumidos).toEqual([1]);
  });

  it("CANCELACION de un inversionista normal: devuelve el monto_aportado completo", () => {
    const res = resolverAbonosNoLiquidados({
      abonosNoLiquidados: [{ abono_id: 7, tipo: "CANCELACION", monto: "999" }],
      abonoCapitalBase: new Big(100),
      montoAportado: "5000",
      devolucionCompleta: false,
      isCube: false,
    });

    expect(res.abonoCapital.toString()).toBe("5000");
    expect(res.abonoIdsConsumidos).toEqual([7]);
  });

  it("inversionista normal con CANCELACION + CAPITAL: devuelve exactamente monto_aportado (no suma CAPITAL encima, evita [ABONO_SUPERA_MONTO]) y consume ambos", () => {
    const res = resolverAbonosNoLiquidados({
      abonosNoLiquidados: [
        { abono_id: 1, tipo: "CANCELACION", monto: "5000" },
        { abono_id: 2, tipo: "CAPITAL", monto: "1200" },
      ],
      abonoCapitalBase: new Big(100),
      montoAportado: "5000",
      devolucionCompleta: false,
      isCube: false,
    });

    // Point 5 fix: abonoCapital debe ser 5000, NO 5000 + 1200 = 6200
    expect(res.abonoCapital.toString()).toBe("5000");
    expect(res.abonoIdsConsumidos).toEqual([1, 2]);
    expect(res.abonoCapitalId).toBe(1);
  });

  it("CANCELACION de CUBE: no se suma NI se marca consumida", () => {
    const res = resolverAbonosNoLiquidados({
      abonosNoLiquidados: [{ abono_id: 66, tipo: "CANCELACION", monto: "50000" }],
      abonoCapitalBase: new Big(100),
      montoAportado: "50000",
      devolucionCompleta: false,
      isCube: true,
    });

    expect(res.abonoCapital.toString()).toBe("100");
    expect(res.abonoIdsConsumidos).toEqual([]);
    expect(res.saltado).toBe(false);
  });

  it("CUBE con CAPITAL y CANCELACION mezclados (caso real: 54 CAPITAL + 66 CANCELACION en prod)", () => {
    const res = resolverAbonosNoLiquidados({
      abonosNoLiquidados: [
        { abono_id: 1, tipo: "CAPITAL", monto: "300" },
        { abono_id: 2, tipo: "CANCELACION", monto: "9999" },
        { abono_id: 3, tipo: "CAPITAL", monto: "200" },
      ],
      abonoCapitalBase: new Big(0),
      montoAportado: "9999",
      devolucionCompleta: false,
      isCube: true,
    });

    expect(res.abonoCapital.toString()).toBe("500");
    expect(res.abonoIdsConsumidos.sort()).toEqual([1, 3]);
  });

  it("CANCELACION de CUBE mezclada con otro inversionista en el mismo lote no lo afecta (no-CUBE sigue igual)", () => {
    const res = resolverAbonosNoLiquidados({
      abonosNoLiquidados: [{ abono_id: 9, tipo: "CANCELACION", monto: "1234" }],
      abonoCapitalBase: new Big(0),
      montoAportado: "1234",
      devolucionCompleta: false,
      isCube: false,
    });

    expect(res.abonoCapital.toString()).toBe("1234");
    expect(res.abonoIdsConsumidos).toEqual([9]);
  });
});
