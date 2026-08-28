import { describe, expect, it } from "bun:test";
import {
  calcularEsperado,
  computarDiffFacturas,
  keyIntereses,
  type FacturaActiva,
  type InversionistaParaDiff,
  type PagoParaDiff,
} from "./facturasFaltantes";

// Pago tipo: cuota con mora, seguro e intereses.
// interes 1000 + iva 120 = 1120 con IVA para repartir.
const PAGO: PagoParaDiff = {
  mora: "150.00",
  abono_seguro: "80.00",
  abono_gps: "0",
  membresias_pago: "0",
  otros: "0",
  abono_interes: "1000.00",
  abono_iva_12: "120.00",
  bandera_reinversion: false,
};

// CUBE 50% / Rodrigo 50%. Rodrigo: 70% participación + 30% cash_in.
const CUBE: InversionistaParaDiff = {
  inversionista_id: 1,
  nombre: "CUBE INVESTMENTS S.A.",
  emite_factura: false,
  porcentaje_participacion: 100,
  porcentaje_cash_in: 0,
  interes_proporcional: "560.00",
};

const RODRIGO: InversionistaParaDiff = {
  inversionista_id: 2,
  nombre: "Rodrigo Estrada Osorio",
  emite_factura: false,
  porcentaje_participacion: 70,
  porcentaje_cash_in: 30,
  interes_proporcional: "560.00",
};

const ROSTER = [CUBE, RODRIGO];

const activa = (
  concepto: string | null,
  inversionista_id: number | null = null,
  factura_id = 1
): FacturaActiva => ({ factura_id, concepto, inversionista_id });

describe("calcularEsperado", () => {
  it("1. arma las keys de los 3 rubros + intereses por inversionista + CUBE", () => {
    expect([...calcularEsperado({ pagoData: PAGO, inversionistas: ROSTER })].sort()).toEqual([
      "INTERESES:2",
      "INTERESES_CUBE",
      "MORA",
      "OTROS_SERVICIOS",
    ]);
  });

  it("2. pago sin ningún rubro (solo capital) → esperado vacío", () => {
    expect(
      calcularEsperado({
        pagoData: {
          mora: "0",
          abono_seguro: "0",
          abono_gps: "0",
          membresias_pago: "0",
          otros: "0",
          abono_interes: "0",
          abono_iva_12: "0",
        },
        inversionistas: ROSTER,
      }).size
    ).toBe(0);
  });

  it("3. GPS o membresía solos también activan OTROS_SERVICIOS; `otros` activa OTROS", () => {
    const esperado = calcularEsperado({
      pagoData: {
        mora: "0",
        abono_seguro: "0",
        abono_gps: "45.00",
        membresias_pago: "0",
        otros: "12.50",
        abono_interes: "0",
      },
      inversionistas: [],
    });
    expect([...esperado].sort()).toEqual(["OTROS", "OTROS_SERVICIOS"]);
  });

  it("4. inversionista que se autofactura (emite_factura, sin config) NO entra al esperado", () => {
    const esperado = calcularEsperado({
      pagoData: PAGO,
      inversionistas: [CUBE, { ...RODRIGO, emite_factura: true }],
    });
    expect(esperado.has(keyIntereses(2))).toBe(false);
    // CUBE sigue esperado: su residuo NO cambia porque el inv no reciba DTE.
    expect(esperado.has("INTERESES_CUBE")).toBe(true);
  });

  it("5. inversionista que emite_factura PERO tiene facturador propio SÍ entra (AUTOCASH)", () => {
    const esperado = calcularEsperado({
      pagoData: PAGO,
      inversionistas: [
        CUBE,
        { ...RODRIGO, inversionista_id: 7, nombre: "AUTOCASH S.A.", emite_factura: true },
      ],
    });
    expect(esperado.has(keyIntereses(7))).toBe(true);
  });

  it("6. inversionista redirigido a CUBE (bandera_reinversion + espejo pendiente) NO entra", () => {
    const esperado = calcularEsperado({
      pagoData: { ...PAGO, bandera_reinversion: true },
      inversionistas: [
        CUBE,
        { ...RODRIGO, status_espejo: "pendiente_reinversion" },
      ],
    });
    expect(esperado.has(keyIntereses(2))).toBe(false);
    expect(esperado.has("INTERESES_CUBE")).toBe(true);
  });

  it("7. sin residuo para CUBE (un solo inversionista se lleva todo) → no hay INTERESES_CUBE", () => {
    const esperado = calcularEsperado({
      pagoData: { ...PAGO, mora: "0", abono_seguro: "0" },
      inversionistas: [
        {
          ...RODRIGO,
          porcentaje_participacion: 100,
          porcentaje_cash_in: 0,
          interes_proporcional: "1120.00", // se lleva el total con IVA
        },
      ],
    });
    expect([...esperado]).toEqual([keyIntereses(2)]);
  });
});

// ⚠️ Varias columnas de pagos_credito son `text` y la mayoría de las filas traen
//    CADENA VACÍA, no NULL (108,267 de 120,764 pagos con otros=''). Un `new Big("")`
//    lanza y el handler lo convierte en HTTP 500.
describe("calcularEsperado — montos sucios (columnas text de pagos_credito)", () => {
  const pagoSucio = (over: Partial<PagoParaDiff>): PagoParaDiff => ({
    mora: "0",
    abono_seguro: "0",
    abono_gps: "0",
    membresias_pago: "0",
    otros: "0",
    abono_interes: "0",
    abono_iva_12: "0",
    ...over,
  });

  it("21. otros='' no revienta y NO pide OTROS", () => {
    const esperado = calcularEsperado({
      pagoData: pagoSucio({ otros: "" }),
      inversionistas: [],
    });
    expect(esperado.has("OTROS")).toBe(false);
  });

  it("22. cadena vacía / whitespace / null / undefined / basura → 0 en todos los rubros", () => {
    for (const v of ["", "   ", null, undefined, "abc", "N/A", "-"] as const) {
      const esperado = calcularEsperado({
        pagoData: pagoSucio({
          mora: v,
          otros: v,
          abono_seguro: v,
          abono_gps: v,
          membresias_pago: v,
          abono_interes: v,
          abono_iva_12: v,
        }),
        inversionistas: ROSTER,
      });
      expect({ v, keys: [...esperado] }).toEqual({ v, keys: [] });
    }
  });

  it("23. NaN e Infinity numéricos tampoco revientan", () => {
    const esperado = calcularEsperado({
      pagoData: pagoSucio({ mora: NaN, otros: Infinity }),
      inversionistas: [],
    });
    expect([...esperado]).toEqual([]);
  });

  it("24. parseFloat manda: '12abc' se lee como 12 (igual que el bloque de emisión)", () => {
    const esperado = calcularEsperado({
      pagoData: pagoSucio({ mora: "12abc" }),
      inversionistas: [],
    });
    expect([...esperado]).toEqual(["MORA"]);
  });

  it("25. interes_proporcional sucio de un inversionista no rompe el reparto", () => {
    const esperado = calcularEsperado({
      pagoData: pagoSucio({ abono_interes: "1000.00", abono_iva_12: "120.00" }),
      inversionistas: [CUBE, { ...RODRIGO, interes_proporcional: "" }],
    });
    // Sin parte para el inversionista: todo el interés queda de residuo en CUBE.
    expect([...esperado]).toEqual(["INTERESES_CUBE"]);
  });

  it("26. REPRO pago 54778 del dump (otros=''): antes 500, ahora FALTANTES", () => {
    // Fila real: mora 0.00, otros '', abono_seguro 260.93, abono_gps 0.00,
    // membresias_pago 341.66, abono_interes 588.50, abono_iva_12 70.62.
    const pago54778: PagoParaDiff = {
      mora: "0.00",
      otros: "",
      abono_seguro: "260.93",
      abono_gps: "0.00",
      membresias_pago: "341.66",
      abono_interes: "588.50",
      abono_iva_12: "70.62",
      bandera_reinversion: false,
    };

    expect([
      ...calcularEsperado({ pagoData: pago54778, inversionistas: ROSTER }),
    ].sort()).toEqual(["INTERESES:2", "INTERESES_CUBE", "OTROS_SERVICIOS"]);

    const diff = computarDiffFacturas({
      pagoData: pago54778,
      inversionistas: ROSTER,
      activas: [activa("OTROS_SERVICIOS", null, 1), activa("INTERESES_CUBE", null, 2)],
    });
    expect(diff.modo).toBe("FALTANTES");
    if (diff.modo !== "FALTANTES") throw new Error("modo inesperado");
    expect([...diff.faltantes]).toEqual([keyIntereses(2)]);
  });
});

describe("computarDiffFacturas", () => {
  it("8. sin facturas activas → COMPLETO (flujo de siempre, sin cambios)", () => {
    expect(
      computarDiffFacturas({ pagoData: PAGO, inversionistas: ROSTER, activas: [] })
    ).toEqual({ modo: "COMPLETO" });
  });

  it("9. FALTANTES: certificaron intereses pero MORA falló → solo falta MORA", () => {
    const diff = computarDiffFacturas({
      pagoData: PAGO,
      inversionistas: ROSTER,
      activas: [
        activa("OTROS_SERVICIOS", null, 10),
        activa("INTERESES", 2, 11),
        activa("INTERESES_CUBE", null, 12),
      ],
    });
    expect(diff.modo).toBe("FALTANTES");
    if (diff.modo !== "FALTANTES") throw new Error("modo inesperado");
    expect([...diff.faltantes]).toEqual(["MORA"]);
  });

  it("10. FALTANTES: falta el DTE de UN inversionista específico", () => {
    const tresInv = [
      CUBE,
      RODRIGO,
      { ...RODRIGO, inversionista_id: 3, nombre: "Ana Lucía Pérez" },
    ];
    const diff = computarDiffFacturas({
      pagoData: PAGO,
      inversionistas: tresInv,
      activas: [
        activa("MORA", null, 20),
        activa("OTROS_SERVICIOS", null, 21),
        activa("INTERESES", 2, 22),
        activa("INTERESES_CUBE", null, 23),
      ],
    });
    expect(diff.modo).toBe("FALTANTES");
    if (diff.modo !== "FALTANTES") throw new Error("modo inesperado");
    expect([...diff.faltantes]).toEqual([keyIntereses(3)]);
  });

  it("11. FALTANTES vacío: todo lo esperado ya está activo (el handler responde 400)", () => {
    const diff = computarDiffFacturas({
      pagoData: PAGO,
      inversionistas: ROSTER,
      activas: [
        activa("MORA", null, 30),
        activa("OTROS_SERVICIOS", null, 31),
        activa("INTERESES", 2, 32),
        activa("INTERESES_CUBE", null, 33),
      ],
    });
    expect(diff.modo).toBe("FALTANTES");
    if (diff.modo !== "FALTANTES") throw new Error("modo inesperado");
    expect(diff.faltantes.size).toBe(0);
  });

  it("12. BLOQUEADO por concepto NULL (facturas históricas sin etiquetar)", () => {
    const diff = computarDiffFacturas({
      pagoData: PAGO,
      inversionistas: ROSTER,
      activas: [activa(null, null, 40), activa("MORA", null, 41)],
    });
    expect(diff.modo).toBe("BLOQUEADO");
    if (diff.modo !== "BLOQUEADO") throw new Error("modo inesperado");
    expect(diff.razon).toContain("no tienen concepto registrado");
  });

  it("13. BLOQUEADO por logrado ⊄ esperado (el roster de inversionistas cambió)", () => {
    const diff = computarDiffFacturas({
      pagoData: PAGO,
      inversionistas: ROSTER, // hoy solo participa el inversionista 2
      activas: [
        activa("MORA", null, 50),
        activa("INTERESES", 99, 51), // DTE vivo de un inv que ya no participa
      ],
    });
    expect(diff.modo).toBe("BLOQUEADO");
    if (diff.modo !== "BLOQUEADO") throw new Error("modo inesperado");
    expect(diff.razon).toContain("INTERESES:99");
  });

  it("14. BLOQUEADO por flujo prorrateado (compra de cartera pendiente_facturar)", () => {
    const diff = computarDiffFacturas({
      pagoData: PAGO,
      inversionistas: ROSTER,
      activas: [activa("MORA", null, 60)],
      tieneOperacionesPendientesFacturar: true,
    });
    expect(diff.modo).toBe("BLOQUEADO");
    if (diff.modo !== "BLOQUEADO") throw new Error("modo inesperado");
    expect(diff.razon).toContain("compra de cartera");
  });

  it("15. prorrateado SIN activas sigue siendo COMPLETO (no se bloquea una primera corrida)", () => {
    expect(
      computarDiffFacturas({
        pagoData: PAGO,
        inversionistas: ROSTER,
        activas: [],
        tieneOperacionesPendientesFacturar: true,
      })
    ).toEqual({ modo: "COMPLETO" });
  });

  it("16. BLOQUEADO por INTERESES sin inversionista_id (etiqueta incompleta)", () => {
    const diff = computarDiffFacturas({
      pagoData: PAGO,
      inversionistas: ROSTER,
      activas: [activa("INTERESES", null, 70)],
    });
    expect(diff.modo).toBe("BLOQUEADO");
    if (diff.modo !== "BLOQUEADO") throw new Error("modo inesperado");
    expect(diff.razon).toContain("sin inversionista_id");
  });

  it("17. BLOQUEADO por concepto desconocido", () => {
    const diff = computarDiffFacturas({
      pagoData: PAGO,
      inversionistas: ROSTER,
      activas: [activa("CAPITAL", null, 80)],
    });
    expect(diff.modo).toBe("BLOQUEADO");
    if (diff.modo !== "BLOQUEADO") throw new Error("modo inesperado");
    expect(diff.razon).toContain("concepto desconocido");
  });

  it("18. BLOQUEADO: hay MORA activa pero el pago ya no trae mora", () => {
    const diff = computarDiffFacturas({
      pagoData: { ...PAGO, mora: "0" },
      inversionistas: ROSTER,
      activas: [activa("MORA", null, 90)],
    });
    expect(diff.modo).toBe("BLOQUEADO");
    if (diff.modo !== "BLOQUEADO") throw new Error("modo inesperado");
    expect(diff.razon).toContain("MORA");
  });

  it("19. el DTE de un inversionista que se autofactura no se pide como faltante", () => {
    const diff = computarDiffFacturas({
      pagoData: PAGO,
      inversionistas: [CUBE, { ...RODRIGO, emite_factura: true }],
      activas: [
        activa("MORA", null, 100),
        activa("OTROS_SERVICIOS", null, 101),
        activa("INTERESES_CUBE", null, 102),
      ],
    });
    expect(diff.modo).toBe("FALTANTES");
    if (diff.modo !== "FALTANTES") throw new Error("modo inesperado");
    expect(diff.faltantes.size).toBe(0);
  });

  it("20. el DTE de un inversionista redirigido a CUBE no se pide como faltante", () => {
    const diff = computarDiffFacturas({
      pagoData: { ...PAGO, bandera_reinversion: true },
      inversionistas: [CUBE, { ...RODRIGO, status_espejo: "pendiente_compra_cartera" }],
      activas: [
        activa("MORA", null, 110),
        activa("INTERESES_CUBE", null, 111),
      ],
    });
    expect(diff.modo).toBe("FALTANTES");
    if (diff.modo !== "FALTANTES") throw new Error("modo inesperado");
    expect([...diff.faltantes]).toEqual(["OTROS_SERVICIOS"]);
  });
});

describe("computarDiffFacturas — regla (d): los DTEs vivos deben cuadrar al centavo", () => {
  const conMonto = (
    concepto: string,
    monto_total: string,
    inversionista_id: number | null = null,
    factura_id = 1
  ): FacturaActiva => ({ factura_id, concepto, inversionista_id, monto_total });

  // Con PAGO + ROSTER: MORA=150.00, OTROS_SERVICIOS=80.00, INTERESES:2=392.00,
  // INTERESES_CUBE = 1120 − 560 + 168 = 728.00.

  it("27. roster que CRECIÓ: el DTE de CUBE viejo trae el reparto anterior → BLOQUEADO", () => {
    // Corrida original con CUBE como único inversionista: su DTE salió por Q1120.
    // Hoy Rodrigo ya está en el roster → esperado CUBE=728 + INTERESES:2=392.
    // La regla (b) no lo ve (logrado ⊆ esperado); la (d) sí: 1120 ≠ 728.
    const diff = computarDiffFacturas({
      pagoData: PAGO,
      inversionistas: ROSTER,
      activas: [conMonto("INTERESES_CUBE", "1120.00", null, 120)],
    });
    expect(diff.modo).toBe("BLOQUEADO");
    if (diff.modo !== "BLOQUEADO") throw new Error("modo inesperado");
    expect(diff.razon).toContain("Q1120.00");
    expect(diff.razon).toContain("Q728.00");
  });

  it("28. montos que cuadran al centavo → FALTANTES sigue funcionando", () => {
    const diff = computarDiffFacturas({
      pagoData: PAGO,
      inversionistas: ROSTER,
      activas: [
        conMonto("MORA", "150.00", null, 121),
        conMonto("INTERESES_CUBE", "728.00", null, 122),
      ],
    });
    expect(diff.modo).toBe("FALTANTES");
    if (diff.modo !== "FALTANTES") throw new Error("modo inesperado");
    expect([...diff.faltantes].sort()).toEqual(["INTERESES:2", "OTROS_SERVICIOS"]);
  });

  it("29. monto del pago cambió después de facturar (sync/recálculo) → BLOQUEADO", () => {
    // El DTE de MORA salió por Q99.00; hoy el pago dice mora=150.00.
    const diff = computarDiffFacturas({
      pagoData: PAGO,
      inversionistas: ROSTER,
      activas: [conMonto("MORA", "99.00", null, 123)],
    });
    expect(diff.modo).toBe("BLOQUEADO");
    if (diff.modo !== "BLOQUEADO") throw new Error("modo inesperado");
    expect(diff.razon).toContain("MORA");
  });

  it("30. DTE de INTERESES de un inversionista con monto desfasado → BLOQUEADO", () => {
    const diff = computarDiffFacturas({
      pagoData: PAGO,
      inversionistas: ROSTER,
      activas: [conMonto("INTERESES", "400.00", 2, 124)], // hoy le tocaría 392.00
    });
    expect(diff.modo).toBe("BLOQUEADO");
    if (diff.modo !== "BLOQUEADO") throw new Error("modo inesperado");
    expect(diff.razon).toContain("INTERESES:2");
  });

  it("31. activa sin monto_total (caller viejo/tests) no bloquea por monto", () => {
    const diff = computarDiffFacturas({
      pagoData: PAGO,
      inversionistas: ROSTER,
      activas: [activa("MORA", null, 125)],
    });
    expect(diff.modo).toBe("FALTANTES");
  });
});
