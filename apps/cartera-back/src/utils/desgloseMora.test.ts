import { describe, expect, test } from "bun:test";
import { construirDesgloseMora } from "./desgloseMora";

// Capital Q27,909.73 (el de la captura de Juan): cargo mensual Q312.59.
const CAP = "27909.73";

describe("construirDesgloseMora — el porqué de la mora, cuota por cuota", () => {
  test("la regla: cargo mensual = capital × 1.12% y diario = mensual ÷ 30", () => {
    const d = construirDesgloseMora({ capital: CAP, cuotas: [], numerosEnValidacion: new Set() });
    expect(d.cargoMensual).toBe("312.59");
    expect(d.cargoDiario).toBe("10.42");
    expect(d.total).toBe("0.00");
  });

  test("una cuota con pago en validación SIGUE generando mora: explica 2 × tope con 1 atrasada", () => {
    const d = construirDesgloseMora({
      capital: CAP,
      cuotas: [
        { cuota_id: 41, numero_cuota: 41, fecha_vencimiento: "2026-08-23", diasAtraso: 38, pagado: 0 },
        { cuota_id: 42, numero_cuota: 42, fecha_vencimiento: "2026-08-25", diasAtraso: 36, pagado: 0 },
      ],
      numerosEnValidacion: new Set([41]),
    });
    expect(d.cuotas.map((c) => [c.numero_cuota, c.topada, c.en_validacion, c.generado])).toEqual([
      [41, true, true, "312.59"],
      [42, true, false, "312.59"],
    ]);
    expect(d.total).toBe("625.18");
  });

  test("lo ya abonado baja el pendiente de ESA cuota", () => {
    const d = construirDesgloseMora({
      capital: CAP,
      cuotas: [{ cuota_id: 42, numero_cuota: 42, fecha_vencimiento: "2026-09-23", diasAtraso: 5, pagado: "20.84" }],
      numerosEnValidacion: new Set(),
    });
    expect(d.cuotas[0]).toMatchObject({ dias_atraso: 5, topada: false, generado: "52.10", abonado: "20.84", pendiente: "31.26" });
    expect(d.total).toBe("31.26");
  });
});

describe("construirDesgloseMora — los centavos cuadran (casos de Codex en #1796)", () => {
  test("capital Q100.45, 3 cuotas topadas: filas de Q1.13, total Q3.38 y ajuste −Q0.01 explícito", () => {
    const d = construirDesgloseMora({
      capital: "100.45",
      cuotas: [40, 40, 40].map((dias, i) => ({ cuota_id: i + 1, numero_cuota: i + 1, fecha_vencimiento: "2026-06-01", diasAtraso: dias, pagado: 0 })),
      numerosEnValidacion: new Set(),
    });
    expect(d.cuotas.map((c) => c.pendiente)).toEqual(["1.13", "1.13", "1.13"]);
    expect(d.total).toBe("3.38");
    expect(d.ajusteRedondeo).toBe("-0.01");
    // Filas + ajuste = total, y cada fila cuadra consigo misma.
    const suma = d.cuotas.reduce((a, c) => a + Number(c.pendiente), 0) + Number(d.ajusteRedondeo);
    expect(suma.toFixed(2)).toBe(d.total);
    for (const c of d.cuotas) expect((Number(c.generado) - Number(c.abonado)).toFixed(2)).toBe(c.pendiente);
  });

  test("capital Q100, una cuota con 1 día: mañana sube lo que realmente sube (Q0.03, no el cargo diario Q0.04)", () => {
    const d = construirDesgloseMora({
      capital: "100",
      cuotas: [{ cuota_id: 1, numero_cuota: 1, fecha_vencimiento: "2026-09-29", diasAtraso: 1, pagado: 0 }],
      numerosEnValidacion: new Set(),
    });
    expect(d.total).toBe("0.04");
    expect(d.totalManana).toBe("0.07");
    expect(d.cargoDiario).toBe("0.04");
  });

  test("cuotas topadas no suben mañana", () => {
    const d = construirDesgloseMora({
      capital: CAP,
      cuotas: [{ cuota_id: 1, numero_cuota: 1, fecha_vencimiento: "2026-08-01", diasAtraso: 45, pagado: 0 }],
      numerosEnValidacion: new Set(),
    });
    expect(d.totalManana).toBe(d.total);
    expect(d.ajusteRedondeo).toBe("0.00");
  });
});

describe("construirDesgloseMora — mañana incluye las cuotas que vencen hoy (Codex #1794)", () => {
  test("dos cuotas topadas + una que vence hoy: mañana sube el primer día de esa cuota", () => {
    const d = construirDesgloseMora({
      capital: "10000",
      cuotas: [
        { cuota_id: 1, numero_cuota: 1, fecha_vencimiento: "2026-08-21", diasAtraso: 40, pagado: 0 },
        { cuota_id: 2, numero_cuota: 2, fecha_vencimiento: "2026-08-26", diasAtraso: 35, pagado: 0 },
      ],
      numerosEnValidacion: new Set(),
      cuotasQueVencenHoy: 1,
    });
    expect(d.total).toBe("224.00");
    expect(d.totalManana).toBe("227.73");
    expect(d.cuotasQueSubenManana).toBe(1);
  });
});

describe("construirDesgloseMora — cuota con mora abonada de más (Codex #1794)", () => {
  test("la fila cuadra: el abono se muestra topado en lo generado y no le baja nada a otra cuota", () => {
    // Pagó Q1.12 cuando el capital era Q100; hoy el capital es Q50 y la cuota genera Q0.56.
    const d = construirDesgloseMora({
      capital: "50",
      cuotas: [
        { cuota_id: 5, numero_cuota: 5, fecha_vencimiento: "2026-08-21", diasAtraso: 40, pagado: "1.12" },
        { cuota_id: 6, numero_cuota: 6, fecha_vencimiento: "2026-09-01", diasAtraso: 29, pagado: 0 },
      ],
      numerosEnValidacion: new Set(),
    });
    expect(d.cuotas.map((c) => [c.numero_cuota, c.generado, c.abonado, c.pendiente])).toEqual([
      [5, "0.56", "0.56", "0.00"],
      [6, "0.54", "0.00", "0.54"],
    ]);
    expect(d.total).toBe("0.54");
    expect(d.ajusteRedondeo).toBe("0.00");
  });
});

describe("construirDesgloseMora — solo cuentan las cuotas cuyo pendiente crece (Codex #1794/#1796)", () => {
  test("una cuota con abono de sobra no «sigue sumando» aunque tenga menos de 30 días", () => {
    // Capital Q100: 10 días generan Q0.37, 11 días Q0.41. La #5 ya tiene Q1.12
    // abonado (con un capital mayor): mañana tampoco debe nada. Solo sube la #6.
    const d = construirDesgloseMora({
      capital: "100",
      cuotas: [
        { cuota_id: 5, numero_cuota: 5, fecha_vencimiento: "2026-09-20", diasAtraso: 10, pagado: "1.12" },
        { cuota_id: 6, numero_cuota: 6, fecha_vencimiento: "2026-09-25", diasAtraso: 5, pagado: 0 },
      ],
      numerosEnValidacion: new Set(),
    });
    expect(d.cuotasQueSubenManana).toBe(1);
    expect(d.total).toBe("0.19");
    expect(d.totalManana).toBe("0.22");
  });
});
