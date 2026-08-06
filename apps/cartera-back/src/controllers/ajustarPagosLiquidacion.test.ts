import { beforeEach, describe, expect, it, mock } from "bun:test";

// Cola de resultados: computarTotalesFiltrados hace 3 selects en orden:
// inversionista → créditos espejo → pagos espejo.
let selectQueue: unknown[][] = [];

function chain() {
  const builder: any = {
    from: () => builder,
    where: () => builder,
    limit: () => builder,
    orderBy: () => builder,
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
  };
  return builder;
}

mock.module("../database/index", () => ({
  db: { select: () => chain() },
}));

const { computarTotalesFiltrados } = await import("./ajustarPagosLiquidacion");

// Un pago: capital 500, interés 100, IVA almacenado 12.
const PAGO = { credito_id: 1, abono_capital: "500", abono_interes: "100", abono_iva_12: "12" };
const CREDITO = { credito_id: 1, monto_aportado: "1000", tipo_reinversion: null };

const correr = async (emite_factura: boolean, descuenta_impuestos: boolean) => {
  selectQueue = [
    [{ emite_factura, descuenta_impuestos, reinversion: "sin_reinversion", monto_reinversion: null, moneda: "quetzales" }],
    [CREDITO],
    [PAGO],
  ];
  return computarTotalesFiltrados({
    inversionista_id: 1,
    liquidacion_id: 1,
    creditos_excluidos: new Set(),
    monto_aportado_ajustado: new Map(),
  });
};

describe("computarTotalesFiltrados — 4 combinaciones emite_factura × descuenta_impuestos", () => {
  beforeEach(() => {
    selectQueue = [];
  });

  it("emite=false, descuenta=false → como siempre: interés − ISR 7%", async () => {
    const t = await correr(false, false);
    expect(t.total_abono_interes.toString()).toBe("100");
    expect(t.total_isr.toString()).toBe("7");
    expect(t.total_abono_general_interes.toString()).toBe("93");
    expect(t.total_cuota.toString()).toBe("593");
  });

  it("emite=true, descuenta=false → como siempre: interés + IVA, ISR 0", async () => {
    const t = await correr(true, false);
    expect(t.total_isr.toString()).toBe("0");
    expect(t.total_abono_general_interes.toString()).toBe("112");
    expect(t.total_cuota.toString()).toBe("612");
  });

  it("emite=false, descuenta=true → neto 81 (100 − 12 − 7), ISR 7, cuota 581", async () => {
    const t = await correr(false, true);
    expect(t.total_abono_general_interes.toString()).toBe("81");
    expect(t.total_isr.toString()).toBe("7");
    expect(t.total_cuota.toString()).toBe("581");
    expect(t.descuenta_impuestos).toBeTrue();
  });

  it("emite=true, descuenta=true → el descuento MANDA: neto 81, ISR 7, cuota 581", async () => {
    const t = await correr(true, true);
    expect(t.total_abono_general_interes.toString()).toBe("81");
    expect(t.total_isr.toString()).toBe("7");
    expect(t.total_cuota.toString()).toBe("581");
  });

  it("regresión: con descuenta=false los totales son idénticos a la fórmula histórica", async () => {
    // Espejo exacto de la fórmula previa al cambio: int±(iva|isr), sin carril.
    const legacy = (emite: boolean) => (emite ? { general: "112", cuota: "612", isr: "0" } : { general: "93", cuota: "593", isr: "7" });
    for (const emite of [false, true]) {
      const t = await correr(emite, false);
      const exp = legacy(emite);
      expect(t.total_abono_general_interes.toString()).toBe(exp.general);
      expect(t.total_cuota.toString()).toBe(exp.cuota);
      expect(t.total_isr.toString()).toBe(exp.isr);
    }
  });
});
