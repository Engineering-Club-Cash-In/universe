import { describe, expect, test } from "bun:test";
import {
  cuotaMensualDe,
  diaGuatemala,
  esFechaDeCalendario,
  estadoDeConvenio,
  fechasDelPlan,
  primerPagoPosteriorAlConvenio,
  motivoReprogramacionInvalida,
  primerPagoDelPlan,
} from "./convenio-plan";

describe("estadoDeConvenio", () => {
  test("deduce el estado de las banderas", () => {
    expect(estadoDeConvenio({ activo: false, completado: false, anulado_at: null })).toBe("pendiente");
    expect(estadoDeConvenio({ activo: true, completado: false, anulado_at: null })).toBe("activo");
    expect(estadoDeConvenio({ activo: true, completado: true, anulado_at: null })).toBe("completado");
    expect(estadoDeConvenio({ activo: false, completado: false, anulado_at: new Date() })).toBe("anulado");
  });
});

describe("primerPagoDelPlan", () => {
  const cuotas = [
    { numero_cuota: 1, fecha_vencimiento: "2026-09-10" },
    { numero_cuota: 2, fecha_vencimiento: "2026-10-10" },
    { numero_cuota: 3, fecha_vencimiento: "2026-11-10" },
  ];
  test("salta las cuotas ya vencidas al firmar el convenio", () => {
    expect(primerPagoDelPlan(cuotas, "2026-10-05T12:00:00Z")).toBe("2026-10-10");
  });
  test("si todas vencieron usa la primera del plan", () => {
    expect(primerPagoDelPlan(cuotas, "2027-01-01T00:00:00Z")).toBe("2026-09-10");
  });
  test("un convenio firmado por la tarde en Guatemala no descarta la cuota de ese día", () => {
    // 2026-10-10 20:00 en Guatemala = 2026-10-11 02:00 UTC.
    expect(primerPagoDelPlan(cuotas, "2026-10-11T02:00:00Z")).toBe("2026-10-10");
    // Una hora antes de medianoche UTC sigue siendo el mismo día en ambos.
    expect(primerPagoDelPlan(cuotas, new Date("2026-10-10T05:59:00Z"))).toBe("2026-10-10");
  });
  test("sin cuotas no hay primer pago", () => {
    expect(primerPagoDelPlan([], "2026-10-05")).toBeNull();
  });
});

describe("diaGuatemala", () => {
  test("resta las 6 horas de Guatemala", () => {
    expect(diaGuatemala(new Date("2026-10-11T05:59:00Z"))).toBe("2026-10-10");
    expect(diaGuatemala(new Date("2026-10-11T06:00:00Z"))).toBe("2026-10-11");
  });
});

describe("fechasDelPlan", () => {
  test("una cuota por mes desde el primer pago", () => {
    expect(fechasDelPlan("2026-10-15", 3)).toEqual(["2026-10-15", "2026-11-15", "2026-12-15"]);
  });
  test("cruza el año", () => {
    expect(fechasDelPlan("2026-12-05", 2)).toEqual(["2026-12-05", "2027-01-05"]);
  });
  test("cae al último día si el mes no tiene el día", () => {
    expect(fechasDelPlan("2026-01-31", 3)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(fechasDelPlan("2028-01-31", 2)).toEqual(["2028-01-31", "2028-02-29"]);
  });
});

describe("cuotaMensualDe", () => {
  test("redondea a centavos", () => {
    expect(cuotaMensualDe(1000, 3)).toBe(333.33);
    expect(cuotaMensualDe(1200, 6)).toBe(200);
  });
});

describe("primerPagoPosteriorAlConvenio", () => {
  test("exige un día posterior al del convenio, en hora de Guatemala", () => {
    // 2026-10-13 20:00 en Guatemala = 2026-10-14 02:00Z: el convenio es del 13.
    const firmado = "2026-10-14T02:00:00Z";
    expect(primerPagoPosteriorAlConvenio("2026-10-13", firmado)).toBe(false);
    expect(primerPagoPosteriorAlConvenio("2026-10-14", firmado)).toBe(true);
    expect(primerPagoPosteriorAlConvenio("2026-10-12", firmado)).toBe(false);
  });
});

describe("esFechaDeCalendario", () => {
  test("acepta días que existen", () => {
    expect(esFechaDeCalendario("2026-10-31")).toBe(true);
    expect(esFechaDeCalendario("2028-02-29")).toBe(true);
  });
  test("rechaza días que el formato deja pasar pero no existen", () => {
    expect(esFechaDeCalendario("2026-10-32")).toBe(false);
    expect(esFechaDeCalendario("2026-02-31")).toBe(false);
    expect(esFechaDeCalendario("2027-02-29")).toBe(false);
    expect(esFechaDeCalendario("2026-13-01")).toBe(false);
    expect(esFechaDeCalendario("2026-00-10")).toBe(false);
    expect(esFechaDeCalendario("20/10/2026")).toBe(false);
  });
});

describe("motivoReprogramacionInvalida", () => {
  const base = { meses: 4, primerPago: "2026-10-20", hoy: "2026-10-12" };
  test("acepta un plan razonable", () => {
    expect(motivoReprogramacionInvalida(base)).toBeNull();
    expect(motivoReprogramacionInvalida({ ...base, primerPago: "2026-10-12" })).toBeNull();
  });
  test("rechaza cuotas fuera de rango", () => {
    expect(motivoReprogramacionInvalida({ ...base, meses: 0 })).toContain("entre 1 y 60");
    expect(motivoReprogramacionInvalida({ ...base, meses: 61 })).toContain("entre 1 y 60");
    expect(motivoReprogramacionInvalida({ ...base, meses: 2.5 })).toContain("entre 1 y 60");
    expect(motivoReprogramacionInvalida({ ...base, meses: 25 })).toBeNull();
    expect(motivoReprogramacionInvalida({ ...base, meses: 60 })).toBeNull();
    expect(motivoReprogramacionInvalida({ ...base, meses: 7 })).toBeNull();
    expect(motivoReprogramacionInvalida({ ...base, meses: 9, maxMeses: 6 })).toContain("entre 1 y 6");
  });
  test("rechaza fechas pasadas, mal formadas o muy lejanas", () => {
    expect(motivoReprogramacionInvalida({ ...base, primerPago: "2026-10-11" })).toContain("pasado");
    expect(motivoReprogramacionInvalida({ ...base, primerPago: "20/10/2026" })).toContain("no es válida");
    expect(motivoReprogramacionInvalida({ ...base, primerPago: "2026-10-32" })).toContain("no es válida");
    expect(motivoReprogramacionInvalida({ ...base, primerPago: "2026-11-31" })).toContain("no es válida");
    expect(motivoReprogramacionInvalida({ ...base, primerPago: "2027-02-01" })).toContain("90 días");
  });
});
