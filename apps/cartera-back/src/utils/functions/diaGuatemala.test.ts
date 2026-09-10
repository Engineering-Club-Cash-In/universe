import { describe, expect, it } from "bun:test";
import {
  aInstante,
  inicioDiaGT,
  inicioDiaGTComoTimestampUTC,
  partesGT,
} from "./diaGuatemala";

// ─────────────────────────────────────────────────────────────────────────────
// Conversión día de Guatemala → instante UTC.
//
// El bug que fijan estos tests: el único chequeo era `Number.isNaN(getTime())`,
// que NUNCA se dispara porque `Date.UTC` normaliza el desborde en silencio. El
// filtro de condonaciones terminaba devolviendo un día que el usuario nunca
// pidió.
// ─────────────────────────────────────────────────────────────────────────────

describe("inicioDiaGT — días válidos", () => {
  it("la medianoche GT es 06:00 UTC del mismo día", () => {
    expect(inicioDiaGT("2026-08-25")!.toISOString()).toBe("2026-08-25T06:00:00.000Z");
  });

  it("offsetDias cruza mes y año", () => {
    expect(inicioDiaGT("2026-08-31", 1)!.toISOString()).toBe("2026-09-01T06:00:00.000Z");
    expect(inicioDiaGT("2026-12-31", 1)!.toISOString()).toBe("2027-01-01T06:00:00.000Z");
  });

  it("acepta el 29 de febrero de un año bisiesto", () => {
    expect(inicioDiaGT("2024-02-29")!.toISOString()).toBe("2024-02-29T06:00:00.000Z");
  });
});

describe("inicioDiaGT — horario de verano de Guatemala (2006)", () => {
  // El 2006-04-30 el reloj de Guatemala saltó de las 23:59 del 29 a la 01:00
  // del 30: la medianoche local NO EXISTIÓ. Las dos pasadas de offset oscilan
  // sobre la transición y quedarse con la última devolvía 05:00Z, que en
  // Guatemala es el 29 a las 23:00 — el filtro se corría un día entero.
  it("devuelve el PRIMER instante que sí existe del día del salto", () => {
    const d = inicioDiaGT("2006-04-30")!;
    expect(d.toISOString()).toBe("2006-04-30T06:00:00.000Z");
  });

  it("ese instante ya cae dentro del día pedido, leído en Guatemala", () => {
    const p = partesGT(inicioDiaGT("2006-04-30")!);
    expect(`${p.year}-${p.month}-${p.day}`).toBe("2006-04-30");
    expect(p.hour).toBe("01");
  });

  it("el literal de timestamp del día del salto también es del 30", () => {
    expect(inicioDiaGTComoTimestampUTC("2006-04-30")).toBe("2006-04-30 06:00:00.000");
  });

  it("llegar al día del salto por offsetDias da lo mismo", () => {
    expect(inicioDiaGT("2006-04-29", 1)!.toISOString()).toBe("2006-04-30T06:00:00.000Z");
  });

  it("durante el horario de verano la medianoche GT es 05:00 UTC", () => {
    expect(inicioDiaGT("2006-05-15")!.toISOString()).toBe("2006-05-15T05:00:00.000Z");
    const p = partesGT(inicioDiaGT("2006-05-15")!);
    expect(`${p.year}-${p.month}-${p.day} ${p.hour}`).toBe("2006-05-15 00");
  });

  it("el día en que termina el DST sigue cayendo en su propio día", () => {
    const p = partesGT(inicioDiaGT("2006-10-01")!);
    expect(`${p.year}-${p.month}-${p.day} ${p.hour}`).toBe("2006-10-01 00");
  });
});

describe("inicioDiaGT — rechaza fechas imposibles (antes las normalizaba)", () => {
  it("31 de febrero: Date.UTC lo corría al 3 de marzo", () => {
    // Evidencia del comportamiento silencioso que se está tapando.
    expect(new Date(Date.UTC(2026, 1, 31)).toISOString().slice(0, 10)).toBe("2026-03-03");
    expect(inicioDiaGT("2026-02-31")).toBeNull();
  });

  it("29 de febrero en año NO bisiesto", () => {
    expect(inicioDiaGT("2026-02-29")).toBeNull();
  });

  it("mes 13: se iba a enero del año siguiente", () => {
    expect(new Date(Date.UTC(2026, 12, 1)).toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(inicioDiaGT("2026-13-01")).toBeNull();
  });

  it("mes 00: se iba a diciembre del año anterior", () => {
    expect(inicioDiaGT("2026-00-10")).toBeNull();
  });

  it("día 00 y día 32", () => {
    expect(inicioDiaGT("2026-08-00")).toBeNull();
    expect(inicioDiaGT("2026-08-32")).toBeNull();
  });

  it("año de dos dígitos: Date.UTC mapea 0-99 a 1900+y", () => {
    expect(new Date(Date.UTC(26, 0, 1)).getUTCFullYear()).toBe(1926);
    expect(inicioDiaGT("0026-01-01")).toBeNull();
    expect(inicioDiaGT("0099-12-31")).toBeNull();
  });

  it("formato que no es YYYY-MM-DD", () => {
    expect(inicioDiaGT("25/08/2026")).toBeNull();
    expect(inicioDiaGT("ayer")).toBeNull();
    expect(inicioDiaGT("")).toBeNull();
    expect(inicioDiaGT("2026-8-5")).toBeNull();
    expect(inicioDiaGT(undefined as any)).toBeNull();
  });
});

describe("inicioDiaGTComoTimestampUTC — no genera literales corruptos", () => {
  it("formatea el literal timestamp que espera Postgres", () => {
    expect(inicioDiaGTComoTimestampUTC("2026-08-25")).toBe("2026-08-25 06:00:00.000");
    expect(inicioDiaGTComoTimestampUTC("2026-08-25", 1)).toBe("2026-08-26 06:00:00.000");
  });

  it("9999-12-31 + 1 día caía en el año 10000 y el slice lo dejaba corrupto", () => {
    // Lo que hacía el código anterior: toISOString() en formato extendido…
    const desbordado = new Date(Date.UTC(10000, 0, 1)).toISOString();
    expect(desbordado.startsWith("+010000")).toBe(true);
    // …y `slice(0, 23)` producía "+010000-01-01T06:00:00" → Postgres 500.
    expect(desbordado.slice(0, 23).replace("T", " ")).not.toMatch(/^\d{4}-/);

    // Ahora el año está acotado: se rechaza explícitamente, no se corrompe.
    expect(inicioDiaGTComoTimestampUTC("9999-12-31", 1)).toBeNull();
    expect(inicioDiaGT("9999-12-31")).toBeNull();
    // El último año soportado sí funciona, incluso sumando el día.
    expect(inicioDiaGTComoTimestampUTC("9998-12-31", 1)).toBe("9999-01-01 06:00:00.000");
    // Todo literal generado tiene año de 4 dígitos.
    for (const dia of ["1900-01-01", "2026-08-25", "9998-12-31"]) {
      expect(inicioDiaGTComoTimestampUTC(dia)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    }
  });

  it("rechaza años anteriores a 1900", () => {
    expect(inicioDiaGT("1899-12-31")).toBeNull();
    expect(inicioDiaGT("1900-01-01")).not.toBeNull();
  });
});

describe("partesGT / aInstante (implementación única del backend)", () => {
  it("lee un instante en hora de Guatemala", () => {
    const p = partesGT(new Date("2026-09-09T05:59:05Z"));
    expect(`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`).toBe("2026-09-08 23:59");
  });

  it("un timestamp de Postgres SIN zona se interpreta como UTC", () => {
    expect(aInstante("2026-09-09 05:59:05.245566")!.toISOString()).toBe(
      "2026-09-09T05:59:05.245Z"
    );
  });

  it("acepta el offset de dos dígitos que escribe Postgres", () => {
    expect(aInstante("2026-09-09 05:59:05+00")!.toISOString()).toBe(
      "2026-09-09T05:59:05.000Z"
    );
  });

  it("null/basura devuelven null", () => {
    expect(aInstante(null)).toBeNull();
    expect(aInstante("")).toBeNull();
    expect(aInstante("no es fecha")).toBeNull();
  });
});
