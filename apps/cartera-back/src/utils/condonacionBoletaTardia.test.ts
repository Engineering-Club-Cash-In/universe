import { describe, expect, test } from "bun:test";
import Big from "big.js";
import {
  TOPE_DIAS_BOLETA_TARDIA,
  cuotasQueCalificanBoletaTardia,
  decidirCondonacionBoletaTardia,
  decidirCondonacionNexaATiempo,
  disponibleParaCuotas,
} from "./condonacionNexaATiempo";
import { validarFechaBoleta, ymdDeFechaCalendario } from "./fechaCalendarioGT";

// Capital 10,000 → 1 día de mora = 3.733333…; 3 días = 11.20; 5 días = 18.666667; 6 días = 22.40.
const cuota = (cuota_id: number, numero_cuota: number, fecha_vencimiento: string, saldo = "1000") =>
  ({ cuota_id, numero_cuota, fecha_vencimiento, saldo });
const anterior = (...pares: [number, string | null][]) => new Map<number, string | null>(pares);

const aTiempo = {
  statusCredit: "MOROSO",
  capital: "10000",
  rubrosPendientes: 0,
  ajusteFechaIdeal: null,
  moraActiva: "11.20",
  cuotasConMora: [{ cuota_id: 12, diasAtraso: 3, pagado: 0, fecha_vencimiento: "2026-09-30" }],
  cuotasAbiertas: [cuota(12, 12, "2026-09-30"), cuota(13, 13, "2026-10-30")],
  hoy: "2026-10-03",
  fechaBoleta: "2026-09-30",
  vencimientoCuotaAnterior: anterior([12, "2026-08-30"]),
  monto: "1000.00",
};

describe("decidirCondonacionBoletaTardia", () => {
  test("TOPE_DIAS_BOLETA_TARDIA es 5", () => {
    expect(TOPE_DIAS_BOLETA_TARDIA).toBe(5);
  });

  test("boleta del vencimiento registrada 3 días después, pago exacto → condona toda la mora de esa cuota", () => {
    const d = decidirCondonacionBoletaTardia(aTiempo);
    expect(d.condonar).toBe(true);
    if (!d.condonar) return;
    expect(d.monto.toFixed(2)).toBe("11.20");
    expect(d.moraACobrar.toFixed(2)).toBe("0.00");
    expect(d.cuotas.map((c) => c.cuota_id)).toEqual([12]);
    expect(d.cuotas[0]!.monto.toFixed(6)).toBe("11.200000");
    expect(d.pagosPendientes).toEqual([]);
  });

  test("borde del tope: 5 días de retraso entra", () => {
    const d = decidirCondonacionBoletaTardia({
      ...aTiempo, hoy: "2026-10-05", moraActiva: "18.67",
      cuotasConMora: [{ cuota_id: 12, diasAtraso: 5, pagado: 0, fecha_vencimiento: "2026-09-30" }],
    });
    expect(d.condonar).toBe(true);
    if (d.condonar) expect(d.monto.toFixed(2)).toBe("18.67");
  });

  test("borde del tope: 6 días de retraso → fuera_de_tope", () => {
    const d = decidirCondonacionBoletaTardia({
      ...aTiempo, hoy: "2026-10-06", moraActiva: "22.40",
      cuotasConMora: [{ cuota_id: 12, diasAtraso: 6, pagado: 0, fecha_vencimiento: "2026-09-30" }],
    });
    expect(d).toEqual({ condonar: false, razon: "fuera_de_tope" });
  });

  test("boleta posterior al vencimiento → fuera_de_ventana", () => {
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, fechaBoleta: "2026-10-01" }))
      .toEqual({ condonar: false, razon: "fuera_de_ventana" });
  });

  test("boleta futura, con formato malo o con fecha imposible → boleta_invalida", () => {
    for (const fechaBoleta of ["2026-10-04", "03/10/2026", "2026-02-30", "", "2026-9-30"]) {
      expect(decidirCondonacionBoletaTardia({ ...aTiempo, fechaBoleta }))
        .toEqual({ condonar: false, razon: "boleta_invalida" });
    }
  });

  test("sin mora gana sobre boleta inválida; estado excluido gana sobre todo", () => {
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, moraActiva: null, fechaBoleta: "basura" }))
      .toEqual({ condonar: false, razon: "sin_mora" });
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, statusCredit: "EN_CONVENIO", fechaBoleta: "basura" }))
      .toEqual({ condonar: false, razon: "estado_no_aplica" });
  });

  test("control de período: boleta igual o anterior al vencimiento de la cuota previa → boleta_de_otro_periodo", () => {
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, fechaBoleta: "2026-08-30" }))
      .toEqual({ condonar: false, razon: "boleta_de_otro_periodo" });
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, fechaBoleta: "2026-08-20" }))
      .toEqual({ condonar: false, razon: "boleta_de_otro_periodo" });
    // 30-ago es domingo: el lunes 31 aún es la boleta a tiempo de la cuota previa; el 1-sep ya es de este período
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, fechaBoleta: "2026-08-31" }))
      .toEqual({ condonar: false, razon: "boleta_de_otro_periodo" });
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, fechaBoleta: "2026-09-01" }).condonar).toBe(true);
  });

  test("cuota 1 (sin cuota anterior): el control de período no aplica", () => {
    const d = decidirCondonacionBoletaTardia({
      ...aTiempo,
      cuotasConMora: [{ cuota_id: 1, diasAtraso: 3, pagado: 0, fecha_vencimiento: "2026-09-30" }],
      cuotasAbiertas: [cuota(1, 1, "2026-09-30"), cuota(2, 2, "2026-10-30")],
      vencimientoCuotaAnterior: anterior([1, null]),
    });
    expect(d.condonar).toBe(true);
  });

  test("mora legítima de una cuota anterior a la boleta se cobra; solo se condona la del retraso", () => {
    const conPrevia = {
      ...aTiempo,
      moraActiva: "123.20", // 112.00 (cuota 11, techo de 30 días) + 11.20 (cuota 12)
      cuotasConMora: [
        { cuota_id: 11, diasAtraso: 33, pagado: 0, fecha_vencimiento: "2026-08-31" },
        { cuota_id: 12, diasAtraso: 3, pagado: 0, fecha_vencimiento: "2026-09-30" },
      ],
      cuotasAbiertas: [cuota(11, 11, "2026-08-31"), cuota(12, 12, "2026-09-30"), cuota(13, 13, "2026-10-30")],
      vencimientoCuotaAnterior: anterior([11, "2026-07-31"], [12, "2026-08-31"]),
    };
    const d = decidirCondonacionBoletaTardia({ ...conPrevia, monto: "2112.00" });
    expect(d.condonar).toBe(true);
    if (!d.condonar) return;
    expect(d.monto.toFixed(2)).toBe("11.20");
    expect(d.moraACobrar.toFixed(2)).toBe("112.00");
    expect(d.cuotas.map((c) => c.cuota_id)).toEqual([12]);
    // Falta Q112 para dejar la cuota 12 al día → nada.
    expect(decidirCondonacionBoletaTardia({ ...conPrevia, monto: "2000.00" }))
      .toEqual({ condonar: false, razon: "no_queda_al_dia" });
    // No alcanza ni para la mora legítima.
    expect(decidirCondonacionBoletaTardia({ ...conPrevia, monto: "100.00" }))
      .toEqual({ condonar: false, razon: "no_alcanza_mora" });
  });

  test("cuota fuera del tope con boleta de su vencimiento: la boleta es del período de la cuota previa → boleta_de_otro_periodo", () => {
    // Cuota 11 vence 26-sep (7 días de mora, fuera de tope). Cuota 12 vence 30-sep (3 días).
    // La boleta del 26-sep paga la cuota 11 (la previa de la 12): la 12 no califica por período.
    const d = decidirCondonacionBoletaTardia({
      ...aTiempo,
      moraActiva: "37.33",
      cuotasConMora: [
        { cuota_id: 11, diasAtraso: 7, pagado: 0, fecha_vencimiento: "2026-09-26" },
        { cuota_id: 12, diasAtraso: 3, pagado: 0, fecha_vencimiento: "2026-09-30" },
      ],
      fechaBoleta: "2026-09-26",
      cuotasAbiertas: [cuota(11, 11, "2026-09-26"), cuota(12, 12, "2026-09-30"), cuota(13, 13, "2026-10-30")],
      vencimientoCuotaAnterior: anterior([11, "2026-08-26"], [12, "2026-09-26"]),
      monto: "2026.13",
    });
    expect(d).toEqual({ condonar: false, razon: "boleta_de_otro_periodo" });
  });

  test("si para quedar al día hace falta un pago pendiente vigente → no_queda_al_dia (la regla no lo admite)", () => {
    const conPendiente = {
      ...aTiempo,
      cuotasConMora: [
        { cuota_id: 11, diasAtraso: 33, pagado: 0, fecha_vencimiento: "2026-08-31" },
        { cuota_id: 12, diasAtraso: 3, pagado: 0, fecha_vencimiento: "2026-09-30" },
      ],
      moraActiva: "123.20",
      cuotasAbiertas: [
        { ...cuota(11, 11, "2026-08-31", "0"), pagosPendientes: [61] },
        cuota(12, 12, "2026-09-30"),
        cuota(13, 13, "2026-10-30"),
      ],
      vencimientoCuotaAnterior: anterior([11, "2026-07-31"], [12, "2026-08-31"]),
      monto: "1112.00",
    };
    expect(decidirCondonacionBoletaTardia(conPendiente))
      .toEqual({ condonar: false, razon: "no_queda_al_dia" });
    // Control: la misma decisión de Nexa sí condona y reporta el pendiente.
    const nexa = decidirCondonacionNexaATiempo({ ...conPendiente, fechaBanco: "2026-09-30" });
    expect(nexa.condonar && nexa.pagosPendientes).toEqual([61]);
  });

  test("varias cuotas en ventana (calendario no mensual): el período se mide contra la candidata más vieja", () => {
    const d = decidirCondonacionBoletaTardia({
      ...aTiempo,
      moraActiva: "11.20", // 2 días (7.466667) + 1 día (3.733333)
      cuotasConMora: [
        { cuota_id: 11, diasAtraso: 2, pagado: 0, fecha_vencimiento: "2026-10-01" },
        { cuota_id: 12, diasAtraso: 1, pagado: 0, fecha_vencimiento: "2026-10-02" },
      ],
      fechaBoleta: "2026-10-01",
      cuotasAbiertas: [cuota(11, 11, "2026-10-01"), cuota(12, 12, "2026-10-02")],
      vencimientoCuotaAnterior: anterior([11, "2026-09-01"], [12, "2026-10-01"]),
      monto: "2000.00",
    });
    expect(d.condonar).toBe(true);
    if (!d.condonar) return;
    expect(d.monto.toFixed(2)).toBe("11.20");
    expect(d.cuotas.map((c) => c.cuota_id)).toEqual([11, 12]);
  });

  test("pago parcial → no_queda_al_dia; tolerancia de un centavo", () => {
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, monto: "500.00" }))
      .toEqual({ condonar: false, razon: "no_queda_al_dia" });
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, monto: "999.98" }).condonar).toBe(false);
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, monto: "999.99" }).condonar).toBe(true);
  });

  test("cuota duplicada por numero_cuota (la vieja con mora no llega a abiertas) → no_queda_al_dia", () => {
    const d = decidirCondonacionBoletaTardia({
      ...aTiempo,
      moraActiva: "22.40",
      cuotasConMora: [
        { cuota_id: 12, diasAtraso: 3, pagado: 0, fecha_vencimiento: "2026-09-30" },
        { cuota_id: 120, diasAtraso: 3, pagado: 0, fecha_vencimiento: "2026-09-30" },
      ],
      cuotasAbiertas: [cuota(120, 12, "2026-09-30"), cuota(13, 13, "2026-10-30")],
    });
    expect(d).toEqual({ condonar: false, razon: "no_queda_al_dia" });
  });

  test("rubros pendientes consumen la boleta antes que la cuota", () => {
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, rubrosPendientes: 300, monto: "1000.00" }))
      .toEqual({ condonar: false, razon: "no_queda_al_dia" });
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, rubrosPendientes: 300, monto: "1300.00" }).condonar).toBe(true);
  });

  test("ajuste de fecha ideal pendiente en la cuota 1 se descuenta antes de las cuotas", () => {
    const cuota1 = {
      ...aTiempo,
      cuotasConMora: [{ cuota_id: 1, diasAtraso: 3, pagado: 0, fecha_vencimiento: "2026-09-30" }],
      cuotasAbiertas: [cuota(1, 1, "2026-09-30"), cuota(2, 2, "2026-10-30")],
      vencimientoCuotaAnterior: anterior([1, null]),
      ajusteFechaIdeal: { id: 7, monto_total: "100" },
    };
    expect(decidirCondonacionBoletaTardia({ ...cuota1, monto: "1000.00" }))
      .toEqual({ condonar: false, razon: "no_queda_al_dia" });
    expect(decidirCondonacionBoletaTardia({ ...cuota1, monto: "1100.00" }).condonar).toBe(true);
  });

  test("EN_CONVENIO / INCOBRABLE no aplican; sin mora no aplica", () => {
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, statusCredit: "INCOBRABLE" }))
      .toEqual({ condonar: false, razon: "estado_no_aplica" });
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, moraActiva: "0" }))
      .toEqual({ condonar: false, razon: "sin_mora" });
  });
});

describe("cuotasQueCalificanBoletaTardia", () => {
  test("devuelve las calificadas y null de razón; sin calificar, la razón", () => {
    const ok = cuotasQueCalificanBoletaTardia({
      cuotasConMora: aTiempo.cuotasConMora, cuotasAbiertas: aTiempo.cuotasAbiertas, fechaBoleta: "2026-09-30", hoy: "2026-10-03",
      vencimientoCuotaAnterior: aTiempo.vencimientoCuotaAnterior,
    });
    expect(ok.calificadas.map((c) => c.cuota_id)).toEqual([12]);
    expect(ok.razonSiNinguna).toBeNull();
    const no = cuotasQueCalificanBoletaTardia({
      cuotasConMora: aTiempo.cuotasConMora, cuotasAbiertas: aTiempo.cuotasAbiertas, fechaBoleta: "2026-10-01", hoy: "2026-10-03",
      vencimientoCuotaAnterior: aTiempo.vencimientoCuotaAnterior,
    });
    expect(no).toEqual({ calificadas: [], razonSiNinguna: "fuera_de_ventana" });
  });

  test("acepta fecha_vencimiento como Date (timestamp sin zona leído por pg)", () => {
    const r = cuotasQueCalificanBoletaTardia({
      cuotasConMora: [{ cuota_id: 12, diasAtraso: 3, pagado: 0, fecha_vencimiento: new Date(2026, 8, 30) }],
      cuotasAbiertas: aTiempo.cuotasAbiertas, fechaBoleta: "2026-09-30", hoy: new Date(2026, 9, 3), vencimientoCuotaAnterior: anterior([12, "2026-08-30"]),
    });
    expect(r.calificadas).toHaveLength(1);
  });
});

describe("disponibleParaCuotas", () => {
  test("boleta − otros − abono directo a capital, sin pasar de cero", () => {
    expect(disponibleParaCuotas({ montoBoleta: "1100.00", otros: 100 }).toFixed(2)).toBe("1000.00");
    expect(disponibleParaCuotas({ montoBoleta: 1000, otros: 100, abonoDirectoCapital: 200 }).toFixed(2)).toBe("700.00");
    expect(disponibleParaCuotas({ montoBoleta: 100, otros: 100, abonoDirectoCapital: 50 }).toFixed(2)).toBe("0.00");
    expect(disponibleParaCuotas({ montoBoleta: "500.50" }).toFixed(2)).toBe("500.50");
  });
});

describe("F1: el tope también acota el monto (diasAtraso del llamador)", () => {
  test("diasAtraso 30 con vencimiento a 3 días de hoy (dato inconsistente) → no condona los 30 días", () => {
    const d = decidirCondonacionBoletaTardia({
      ...aTiempo,
      moraActiva: "112.00",
      cuotasConMora: [{ cuota_id: 12, diasAtraso: 30, pagado: 0, fecha_vencimiento: "2026-09-30" }],
      monto: "1112.00",
    });
    expect(d.condonar).toBe(false);
  });
  test("diasAtraso 6 con vencimiento a 5 días (inconsistente) → no condona", () => {
    const d = decidirCondonacionBoletaTardia({
      ...aTiempo, hoy: "2026-10-05", moraActiva: "22.40",
      cuotasConMora: [{ cuota_id: 12, diasAtraso: 6, pagado: 0, fecha_vencimiento: "2026-09-30" }],
    });
    expect(d.condonar).toBe(false);
  });
});

describe("F2: entrada ausente en vencimientoCuotaAnterior nunca equivale a cuota 1", () => {
  test("cuota 12 sin entrada en el mapa, boleta vieja → boleta_de_otro_periodo", () => {
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, fechaBoleta: "2026-09-30", vencimientoCuotaAnterior: anterior() }))
      .toEqual({ condonar: false, razon: "boleta_de_otro_periodo" });
  });
  test("null con numero_cuota > 1 → boleta_de_otro_periodo", () => {
    expect(decidirCondonacionBoletaTardia({ ...aTiempo, vencimientoCuotaAnterior: anterior([12, null]) }))
      .toEqual({ condonar: false, razon: "boleta_de_otro_periodo" });
  });
  test("cuota 1 sin entrada → no califica; con null → califica", () => {
    const c1 = {
      ...aTiempo,
      cuotasConMora: [{ cuota_id: 1, diasAtraso: 3, pagado: 0, fecha_vencimiento: "2026-09-30" }],
      cuotasAbiertas: [cuota(1, 1, "2026-09-30"), cuota(2, 2, "2026-10-30")],
    };
    expect(decidirCondonacionBoletaTardia({ ...c1, vencimientoCuotaAnterior: anterior() }))
      .toEqual({ condonar: false, razon: "boleta_de_otro_periodo" });
    expect(decidirCondonacionBoletaTardia({ ...c1, vencimientoCuotaAnterior: anterior([1, null]) }).condonar).toBe(true);
  });
  test("cuota 1 con previa = desembolso: boleta anterior o igual al desembolso no califica; posterior sí", () => {
    const c1 = {
      ...aTiempo,
      cuotasConMora: [{ cuota_id: 1, diasAtraso: 3, pagado: 0, fecha_vencimiento: "2026-09-30" }],
      cuotasAbiertas: [cuota(1, 1, "2026-09-30"), cuota(2, 2, "2026-10-30")],
      vencimientoCuotaAnterior: anterior([1, "2026-09-01"]),
    };
    expect(decidirCondonacionBoletaTardia({ ...c1, fechaBoleta: "2026-08-15" }))
      .toEqual({ condonar: false, razon: "boleta_de_otro_periodo" });
    expect(decidirCondonacionBoletaTardia({ ...c1, fechaBoleta: "2026-09-02" }).condonar).toBe(true);
  });
});

describe("validarFechaBoleta", () => {
  test("F4: hoyYmd inválido lanza en vez de dejar pasar fechas futuras", () => {
    for (const hoy of ["", "basura", "2026-13-40x"]) {
      expect(() => validarFechaBoleta("2099-01-01", hoy)).toThrow();
    }
  });

  test("null si es válida (hoy incluido); motivo si es futura, mal formada, imposible o no es string", () => {
    expect(validarFechaBoleta("2026-10-03", "2026-10-03")).toBeNull();
    expect(validarFechaBoleta("2026-09-30", "2026-10-03")).toBeNull();
    expect(validarFechaBoleta("2026-10-04", "2026-10-03")).toMatch(/futura/);
    for (const mala of ["03/10/2026", "2026-9-30", "", "2026-02-30", "2026-10-03T00:00:00Z", null, undefined, 20261003, new Date()]) {
      expect(validarFechaBoleta(mala, "2026-10-03")).toEqual(expect.any(String));
    }
  });
});

describe("ymdDeFechaCalendario", () => {
  test("string con hora, Date con campos locales y fecha inválida", () => {
    expect(ymdDeFechaCalendario("2026-10-03 00:00:00")).toBe("2026-10-03");
    expect(ymdDeFechaCalendario(new Date(2026, 9, 3))).toBe("2026-10-03");
    expect(() => ymdDeFechaCalendario("no-es-fecha")).toThrow();
  });

  test("Codex r1 #1: una fecha imposible lanza en vez de normalizarse a otro día", () => {
    expect(() => ymdDeFechaCalendario("2026-02-30")).toThrow();
    expect(() => ymdDeFechaCalendario("2026-02-30 00:00:00")).toThrow();
    expect(ymdDeFechaCalendario("2026-09-30 00:00:00")).toBe("2026-09-30");
    expect(() => decidirCondonacionBoletaTardia({ ...aTiempo, hoy: "2026-02-30" })).toThrow();
  });
});

describe("Nexa conserva su regla exacta tras la generalización", () => {
  test("misma decisión que antes: 2 días, ventana de 3 hábiles", () => {
    const d = decidirCondonacionNexaATiempo({
      statusCredit: "MOROSO", capital: "10000", rubrosPendientes: 0, ajusteFechaIdeal: null,
      moraActiva: "7.47",
      cuotasConMora: [{ cuota_id: 5, diasAtraso: 2, pagado: 0, fecha_vencimiento: "2026-10-05" }],
      cuotasAbiertas: [cuota(5, 5, "2026-10-05"), cuota(6, 6, "2026-11-05")],
      fechaBanco: "2026-10-07", hoy: "2026-10-07", monto: "1000.00",
    });
    expect(d.condonar).toBe(true);
    if (d.condonar) expect(new Big(d.monto).toFixed(2)).toBe("7.47");
  });
});
