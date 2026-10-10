import { describe, expect, it } from "bun:test";
import {
  PreviewEstadoCuentaBodySchema,
  calcularDesgloseCancelacion,
  fechaCorteGuatemala,
  normalizarEntradaEstadoCuenta,
  type MontosCreditoCancelacion,
  type PreviewEstadoCuentaBody,
} from "./estadoCuentaCancelacionCalculo";

const credito: MontosCreditoCancelacion = {
  capital: "25000.00",
  interes: "750.00",
  iva: "90.00",
  membresias: "150.00",
  seguro: "210.50",
  gps: "45.00",
  mora: "312.45",
};

const body = (extra: Partial<PreviewEstadoCuentaBody> = {}): PreviewEstadoCuentaBody => ({
  cuotasRestantes: 2,
  traspaso: 0,
  garantiaMobiliaria: 0,
  otros: 0,
  montosAdicionales: [],
  motivo: "Pago anticipado",
  ...extra,
});

const calcular = (b: PreviewEstadoCuentaBody, c = credito) =>
  calcularDesgloseCancelacion(c, normalizarEntradaEstadoCuenta(b));

describe("calcularDesgloseCancelacion — misma fórmula que el modal", () => {
  it("capital + n × (interés+IVA+seguro+GPS+membresía) + mora + extras", () => {
    const d = calcular(body({ traspaso: 500, garantiaMobiliaria: 250, otros: 100 }));
    // por cuota: 750 + 90 + 210.50 + 45 + 150 = 1245.50 → × 2 = 2491.00
    expect(d.totalesCuotas.subtotal).toBe("2491.00");
    expect(d.totalesCuotas.interes).toBe("1500.00");
    expect(d.totalesCuotas.seguro).toBe("421.00");
    // 25000 + 2491 + 312.45 + 500 + 250 + 100
    expect(d.montoCancelacion).toBe("28653.45");
    expect(d.moneda).toBe("GTQ");
  });

  it("cuotasRestantes = 0: solo capital, mora y extras", () => {
    const d = calcular(body({ cuotasRestantes: 0 }));
    expect(d.totalesCuotas.subtotal).toBe("0.00");
    expect(d.montoCancelacion).toBe("25312.45");
  });

  it("mora cero (sin mora activa) y crédito en cero dan total cero", () => {
    const cero: MontosCreditoCancelacion = {
      capital: "0", interes: "0", iva: "0", membresias: "0", seguro: "0", gps: "0", mora: null,
    };
    const d = calcular(body({ cuotasRestantes: 5 }), cero);
    expect(d.mora).toBe("0.00");
    expect(d.montoCancelacion).toBe("0.00");
  });

  it("extras negativos descuentan y el total puede quedar negativo (sin regla nueva)", () => {
    const d = calcular(
      body({
        cuotasRestantes: 0,
        otros: -312.45,
        montosAdicionales: [
          { concepto: "Descuento", monto: -26000 },
          { concepto: "Cargo", monto: 10 },
        ],
      })
    );
    expect(d.totalMontosAdicionales).toBe("-25990.00");
    // 25000 + 312.45 - 312.45 - 26000 + 10
    expect(d.montoCancelacion).toBe("-990.00");
  });

  it("importes fraccionarios con Big: sin errores de float", () => {
    const d = calcular(
      body({
        cuotasRestantes: 3,
        traspaso: 0.1,
        garantiaMobiliaria: 0.2,
        montosAdicionales: [{ concepto: "x", monto: 0.7 }],
      }),
      { ...credito, interes: "0.10", iva: "0.20", seguro: "0", gps: "0", membresias: "0", mora: "0" }
    );
    // 0.1 + 0.2 en float da 0.30000000000000004
    expect(d.traspaso).toBe("0.10");
    expect(d.totalesCuotas.subtotal).toBe("0.90");
    // 25000 + 0.90 + 0.1 + 0.2 + 0.7
    expect(d.montoCancelacion).toBe("25001.90");
  });

  it("montos del operador se usan tal cual; solo el total se lleva a centavos", () => {
    const d = calcular(body({ cuotasRestantes: 0, traspaso: 10.555, otros: 0.004 }));
    expect(d.traspaso).toBe("10.555");
    expect(d.otros).toBe("0.004");
    // 25000 + 312.45 + 10.555 + 0.004 = 25323.009 → 25323.01
    expect(d.montoCancelacion).toBe("25323.01");
  });

  it("redondeo del total: mitad lejos de cero (como numeric de Postgres)", () => {
    const base = { ...credito, capital: "0", mora: "0" };
    expect(calcular(body({ cuotasRestantes: 0, otros: 0.005 }), base).montoCancelacion).toBe("0.01");
    expect(calcular(body({ cuotasRestantes: 0, otros: -0.005 }), base).montoCancelacion).toBe("-0.01");
  });
});

describe("PreviewEstadoCuentaBodySchema", () => {
  it("rechaza valores del crédito enviados por el navegador", () => {
    for (const campo of ["capital", "mora", "interes", "iva", "seguro", "gps", "membresias", "monto_cancelacion"]) {
      const r = PreviewEstadoCuentaBodySchema.safeParse({ ...body(), [campo]: 1 });
      expect(r.success).toBe(false);
    }
  });

  it("exige cuotasRestantes entero >= 0 y motivo", () => {
    expect(PreviewEstadoCuentaBodySchema.safeParse({ ...body(), cuotasRestantes: -1 }).success).toBe(false);
    expect(PreviewEstadoCuentaBodySchema.safeParse({ ...body(), cuotasRestantes: 1.5 }).success).toBe(false);
    expect(PreviewEstadoCuentaBodySchema.safeParse({ ...body(), motivo: "   " }).success).toBe(false);
    expect(PreviewEstadoCuentaBodySchema.safeParse(body()).success).toBe(true);
  });

  it("normaliza motivo/observaciones como el modal (trim, vacío → null)", () => {
    const e = normalizarEntradaEstadoCuenta(body({ motivo: "  Venta  ", observaciones: "   " }));
    expect(e.motivo).toBe("Venta");
    expect(e.observaciones).toBeNull();
  });
});

describe("fechaCorteGuatemala", () => {
  it("usa el día de Guatemala (UTC-6), no el de UTC", () => {
    // 2026-10-02 03:00 UTC = 2026-10-01 21:00 en Guatemala
    expect(fechaCorteGuatemala(new Date("2026-10-02T03:00:00Z"))).toBe("2026-10-01");
  });
});
