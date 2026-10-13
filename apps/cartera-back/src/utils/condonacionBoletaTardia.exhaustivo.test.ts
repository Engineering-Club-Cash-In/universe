// Pruebas de caja negra de la regla "boleta pagada a tiempo, registrada tarde".
// Derivadas de la spec (docs/superpowers/specs/2026-10-13-boleta-tardia-condonacion-design.md
// §2, §4.1, §5, §6) y de las enmiendas E-1/E-2/E-3, no de la implementación.
//
// Capital de referencia: 3000 -> cargo mensual 33.60 -> 1.12 por día de atraso
// (proporcional hasta 30 días), así los montos esperados son exactos.
import { describe, expect, test } from "bun:test";
import Big from "big.js";
import {
  TOPE_DIAS_BOLETA_TARDIA,
  decidirCondonacionBoletaTardia,
  decidirCondonacionNexaATiempo,
  disponibleParaCuotas,
  type CuotaAbiertaNexa,
  type CuotaConMoraNexa,
  type ParamsBoletaTardia,
} from "./condonacionNexaATiempo";
import { validarFechaBoleta, ymdDeFechaCalendario } from "./fechaCalendarioGT";

const DIA = 86_400_000;
const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA);

type CuotaDef = {
  id: number;
  numero?: number;
  venc: string;
  saldo?: number | string;
  prev?: string | null;
  pagadoMora?: number | string;
  cierreDiferido?: boolean;
  pendientes?: number[];
};

/** Arma los parámetros a partir de cuotas definidas por vencimiento; los días de atraso salen de `hoy`. */
function escenario(o: {
  hoy?: string;
  boleta?: string;
  capital?: number | string;
  moraActiva?: number | string | null | Big;
  monto?: number | string | Big;
  status?: string | null;
  cuotas: CuotaDef[]; // todas las cuotas con mora
  abiertas?: CuotaAbiertaNexa[]; // por defecto, las mismas cuotas con saldo 300
  rubros?: number | string;
  ajuste?: { id: number; monto_total: number } | null;
}): ParamsBoletaTardia {
  const hoy = o.hoy ?? "2026-10-03";
  const conMora: CuotaConMoraNexa[] = o.cuotas.map((c) => ({
    cuota_id: c.id,
    diasAtraso: diasEntre(c.venc, hoy),
    pagado: c.pagadoMora ?? 0,
    fecha_vencimiento: c.venc,
  }));
  const abiertas: CuotaAbiertaNexa[] =
    o.abiertas ??
    o.cuotas.map((c) => ({
      cuota_id: c.id,
      numero_cuota: c.numero ?? c.id,
      fecha_vencimiento: c.venc,
      saldo: c.saldo ?? 300,
      cierreDiferido: c.cierreDiferido,
      pagosPendientes: c.pendientes,
    }));
  const prev = new Map<number, string | null>();
  for (const c of o.cuotas) if (c.prev !== undefined) prev.set(c.id, c.prev);
  return {
    statusCredit: o.status === undefined ? "ACTIVO" : o.status,
    capital: o.capital ?? 3000,
    moraActiva: o.moraActiva === undefined ? 0 : o.moraActiva,
    cuotasConMora: conMora,
    cuotasAbiertas: abiertas,
    monto: o.monto ?? 0,
    hoy,
    rubrosPendientes: o.rubros ?? 0,
    ajusteFechaIdeal: o.ajuste ?? null,
    fechaBoleta: o.boleta ?? "2026-09-30",
    vencimientoCuotaAnterior: prev,
  };
}

/** Caso base feliz: cuota 12 vence 30-sep, boleta 30-sep, hoy 03-oct (3 días), mora 3.36, pago exacto 300. */
const base = (extra: Partial<Parameters<typeof escenario>[0]> = {}) =>
  escenario({
    cuotas: [{ id: 12, venc: "2026-09-30", prev: "2026-08-30" }],
    moraActiva: "3.36",
    monto: 300,
    ...extra,
  });

/** Variante: misma cuota 12 pero con `hoy` y vencimiento dados (días = hoy - venc). */
const conDias = (venc: string, hoy: string, boleta = venc, prev = "2026-01-01") => {
  const dias = diasEntre(venc, hoy);
  const mora = new Big("1.12").times(Math.min(dias, 30)).toFixed(2);
  return escenario({
    hoy,
    boleta,
    cuotas: [{ id: 12, venc, prev }],
    moraActiva: mora,
    monto: 300,
  });
};

const razon = (d: ReturnType<typeof decidirCondonacionBoletaTardia>) => (d.condonar ? null : d.razon);

// ─────────────────────────────────────────────────────────────────────────────
describe("1. tope por cuota (hoy - vencimiento <= 5)", () => {
  test("vence hoy (0 días): no hay mora que condonar", () => {
    const d = decidirCondonacionBoletaTardia(conDias("2026-10-03", "2026-10-03"));
    expect(d.condonar).toBe(false);
  });
  test("1 día: entra, condona 1.12", () => {
    const d = decidirCondonacionBoletaTardia(conDias("2026-10-02", "2026-10-03"));
    expect(d.condonar).toBe(true);
    if (d.condonar) expect(d.monto.toFixed(2)).toBe("1.12");
  });
  test("5 días: entra, condona 5.60", () => {
    const d = decidirCondonacionBoletaTardia(conDias("2026-09-28", "2026-10-03"));
    expect(d.condonar).toBe(true);
    if (d.condonar) expect(d.monto.toFixed(2)).toBe("5.60");
  });
  test("6 días: no entra (fuera_de_tope) aunque la boleta sea a tiempo", () => {
    const d = decidirCondonacionBoletaTardia(conDias("2026-09-27", "2026-10-03"));
    expect(razon(d)).toBe("fuera_de_tope");
  });
  test("30 y 90 días: fuera_de_tope", () => {
    expect(razon(decidirCondonacionBoletaTardia(conDias("2026-09-03", "2026-10-03")))).toBe("fuera_de_tope");
    expect(razon(decidirCondonacionBoletaTardia(conDias("2026-07-05", "2026-10-03")))).toBe("fuera_de_tope");
  });
  test("la constante del tope es 5", () => {
    expect(TOPE_DIAS_BOLETA_TARDIA).toBe(5);
  });
  test("cambio de año: vence 31-dic, registro 03-ene (3 días) entra", () => {
    const d = decidirCondonacionBoletaTardia(conDias("2026-12-31", "2027-01-03", "2026-12-31", "2026-11-30"));
    expect(d.condonar).toBe(true);
    if (d.condonar) expect(d.monto.toFixed(2)).toBe("3.36");
  });
  test("cambio de año: vence 31-dic, registro 05-ene (5 días) entra; 06-ene (6) no", () => {
    expect(decidirCondonacionBoletaTardia(conDias("2026-12-31", "2027-01-05", "2026-12-31", "2026-11-30")).condonar).toBe(true);
    expect(razon(decidirCondonacionBoletaTardia(conDias("2026-12-31", "2027-01-06", "2026-12-31", "2026-11-30")))).toBe("fuera_de_tope");
  });
  test("bisiesto: vence 29-feb-2028, registro 05-mar (5 días) entra; 06-mar (6) no", () => {
    expect(decidirCondonacionBoletaTardia(conDias("2028-02-29", "2028-03-05")).condonar).toBe(true);
    expect(razon(decidirCondonacionBoletaTardia(conDias("2028-02-29", "2028-03-06")))).toBe("fuera_de_tope");
  });
  test("no bisiesto: vence 28-feb-2027, registro 05-mar (5 días) entra; 06-mar no", () => {
    expect(decidirCondonacionBoletaTardia(conDias("2027-02-28", "2027-03-05")).condonar).toBe(true);
    expect(razon(decidirCondonacionBoletaTardia(conDias("2027-02-28", "2027-03-06")))).toBe("fuera_de_tope");
  });
  test("el tope es por cuota: la cuota de 7 días queda fuera, la de 3 sí (vencimientos cercanos, boleta a tiempo para ambas)", () => {
    const p = escenario({
      boleta: "2026-09-25",
      cuotas: [
        { id: 11, venc: "2026-09-26", prev: "2026-08-26" }, // 7 días: fuera de tope
        { id: 12, venc: "2026-09-30", prev: "2026-08-30" }, // 3 días (sintético: la previa no es la 11)
      ],
      moraActiva: "11.20", // 7.84 + 3.36
      monto: 7.84 + 600,
    });
    const d = decidirCondonacionBoletaTardia(p);
    expect(d.condonar).toBe(true);
    if (d.condonar) {
      expect(d.monto.toFixed(2)).toBe("3.36");
      expect(d.moraACobrar.toFixed(2)).toBe("7.84");
      expect(d.cuotas.map((c) => c.cuota_id)).toEqual([12]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("2. boleta 'a tiempo' y control de período", () => {
  test("boleta = vencimiento: entra", () => {
    expect(decidirCondonacionBoletaTardia(base({ boleta: "2026-09-30" })).condonar).toBe(true);
  });
  test("boleta = vencimiento + 1: no entra", () => {
    const d = decidirCondonacionBoletaTardia(base({ boleta: "2026-10-01" }));
    expect(d.condonar).toBe(false);
  });
  test("boleta = hoy (posterior al vencimiento): no entra", () => {
    expect(decidirCondonacionBoletaTardia(base({ boleta: "2026-10-03" })).condonar).toBe(false);
  });
  test("boleta anterior pero posterior al vencimiento de la cuota previa: entra", () => {
    expect(decidirCondonacionBoletaTardia(base({ boleta: "2026-08-31" })).condonar).toBe(true);
  });
  test("boleta = vencimiento de la cuota previa: boleta_de_otro_periodo (estrictamente posterior)", () => {
    expect(razon(decidirCondonacionBoletaTardia(base({ boleta: "2026-08-30" })))).toBe("boleta_de_otro_periodo");
  });
  test("boleta anterior al vencimiento de la cuota previa: boleta_de_otro_periodo", () => {
    expect(razon(decidirCondonacionBoletaTardia(base({ boleta: "2026-07-01" })))).toBe("boleta_de_otro_periodo");
  });
  test("cuota nº1 (sin cuota anterior, prev null): cualquier boleta <= vencimiento entra", () => {
    const p = escenario({
      cuotas: [{ id: 1, numero: 1, venc: "2026-09-30", prev: null }],
      moraActiva: "3.36",
      monto: 300,
      boleta: "2026-09-01",
    });
    expect(decidirCondonacionBoletaTardia(p).condonar).toBe(true);
  });
  test("cuota nº1 sin entrada en el mapa (ausente): NO califica (ausente ≠ cuota 1)", () => {
    const p = escenario({
      cuotas: [{ id: 1, numero: 1, venc: "2026-09-30" }],
      moraActiva: "3.36",
      monto: 300,
    });
    expect(decidirCondonacionBoletaTardia(p)).toEqual({ condonar: false, razon: "boleta_de_otro_periodo" });
  });
  test("cuota nº1 con previa = desembolso y boleta anterior al desembolso: no califica", () => {
    const p = escenario({
      cuotas: [{ id: 1, numero: 1, venc: "2026-09-30", prev: "2026-09-10" }],
      moraActiva: "3.36",
      monto: 300,
      boleta: "2026-09-05",
    });
    expect(decidirCondonacionBoletaTardia(p)).toEqual({ condonar: false, razon: "boleta_de_otro_periodo" });
  });
  test("cuota nº1 con boleta posterior al vencimiento: no entra", () => {
    const p = escenario({
      cuotas: [{ id: 1, numero: 1, venc: "2026-09-30", prev: null }],
      moraActiva: "3.36",
      monto: 300,
      boleta: "2026-10-01",
    });
    expect(decidirCondonacionBoletaTardia(p).condonar).toBe(false);
  });
  test("E-3: tope y período a la vez, con datos consistentes: previa de la 12 = venc de la 11 -> otro periodo", () => {
    const p = escenario({
      boleta: "2026-08-30",
      cuotas: [{ id: 12, venc: "2026-09-30", prev: "2026-08-30" }],
      moraActiva: "3.36",
      monto: 300,
    });
    expect(razon(decidirCondonacionBoletaTardia(p))).toBe("boleta_de_otro_periodo");
  });
  test("vencimientos como Date (campos locales) funcionan igual que strings", () => {
    const p = base();
    const conDate: ParamsBoletaTardia = {
      ...p,
      cuotasConMora: p.cuotasConMora.map((c) => ({ ...c, fecha_vencimiento: new Date(2026, 8, 30) })),
      cuotasAbiertas: p.cuotasAbiertas.map((c) => ({ ...c, fecha_vencimiento: new Date(2026, 8, 30) })),
      hoy: new Date(2026, 9, 3),
    };
    const d = decidirCondonacionBoletaTardia(conDate);
    expect(d.condonar).toBe(true);
    if (d.condonar) expect(d.monto.toFixed(2)).toBe("3.36");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("3. validarFechaBoleta / boleta inválida", () => {
  const HOY = "2026-10-03";
  const invalidos: [string, unknown][] = [
    ["sin cero a la izquierda", "2026-9-30"],
    ["formato dd/mm/yyyy", "30/09/2026"],
    ["string vacío", ""],
    ["null", null],
    ["undefined", undefined],
    ["número", 20260930],
    ["Date", new Date(2026, 8, 30)],
    ["30 de febrero", "2026-02-30"],
    ["mes 13", "2026-13-01"],
    ["mes 00", "2026-00-10"],
    ["día 00", "2026-09-00"],
    ["31 de abril", "2026-04-31"],
    ["29-feb en año no bisiesto", "2027-02-29"],
    ["con hora Z", "2026-09-30T00:00:00Z"],
    ["con hora y espacio", "2026-09-30 00:00:00"],
    ["espacio al final", "2026-09-30 "],
    ["espacio al inicio", " 2026-09-30"],
    ["solo año-mes", "2026-09"],
    ["texto", "ayer"],
    ["objeto", {}],
    ["booleano", true],
  ];
  for (const [nombre, valor] of invalidos) {
    test(`inválida: ${nombre}`, () => {
      const r = validarFechaBoleta(valor, HOY);
      expect(typeof r).toBe("string");
      expect((r as string).length).toBeGreaterThan(0);
    });
  }
  test("válida: ayer, hoy, bisiesto real", () => {
    expect(validarFechaBoleta("2026-09-30", HOY)).toBeNull();
    expect(validarFechaBoleta("2026-10-03", HOY)).toBeNull();
    expect(validarFechaBoleta("2028-02-29", "2028-03-01")).toBeNull();
  });
  test("futura: mañana y muy futura son inválidas", () => {
    expect(validarFechaBoleta("2026-10-04", HOY)).not.toBeNull();
    expect(validarFechaBoleta("2099-01-01", HOY)).not.toBeNull();
  });
  test("zona horaria: el 'hoy' lo da el llamador (GT), no el reloj del proceso", () => {
    // Si en UTC ya es 04-oct pero en Guatemala sigue siendo 03-oct, la boleta del 04 es futura.
    expect(validarFechaBoleta("2026-10-04", "2026-10-03")).not.toBeNull();
    // Y con hoy=04 la misma boleta es válida.
    expect(validarFechaBoleta("2026-10-04", "2026-10-04")).toBeNull();
  });
  test("borde de año: boleta 01-ene con hoy 31-dic es futura", () => {
    expect(validarFechaBoleta("2027-01-01", "2026-12-31")).not.toBeNull();
    expect(validarFechaBoleta("2026-12-31", "2027-01-01")).toBeNull();
  });

  test("la regla rechaza con boleta_invalida: formato malo", () => {
    for (const mala of ["2026-9-30", "30/09/2026", "", "2026-02-30", "2026-09-30T00:00:00Z"]) {
      const d = decidirCondonacionBoletaTardia(base({ boleta: mala }));
      expect(razon(d)).toBe("boleta_invalida");
    }
  });
  test("la regla rechaza con boleta_invalida: valores no string", () => {
    for (const mala of [null, undefined, 20260930, new Date(2026, 8, 30)]) {
      const p = { ...base(), fechaBoleta: mala as unknown as string };
      expect(razon(decidirCondonacionBoletaTardia(p))).toBe("boleta_invalida");
    }
  });
  test("la regla rechaza con boleta_invalida: boleta futura (aunque sea <= vencimiento de otra cuota)", () => {
    // Vencimiento 30-sep, hoy 03-oct, boleta 05-oct: futura.
    expect(razon(decidirCondonacionBoletaTardia(base({ boleta: "2026-10-05" })))).toBe("boleta_invalida");
  });
  test("la regla acepta boleta = hoy en su validez, pero rechaza por no ser a tiempo", () => {
    const d = decidirCondonacionBoletaTardia(base({ boleta: "2026-10-03" }));
    expect(d.condonar).toBe(false);
    expect(razon(d)).not.toBe("boleta_invalida");
  });
  test("estado excluido gana sobre boleta inválida (orden de la spec)", () => {
    expect(decidirCondonacionBoletaTardia(base({ boleta: "xx", status: "CANCELADO" })))
      .toEqual({ condonar: false, razon: "estado_no_aplica" });
  });
  test("ymdDeFechaCalendario: Date local, string con hora, inválida lanza", () => {
    expect(ymdDeFechaCalendario(new Date(2026, 8, 30))).toBe("2026-09-30");
    expect(ymdDeFechaCalendario("2026-09-30 00:00:00")).toBe("2026-09-30");
    expect(ymdDeFechaCalendario("2026-09-30T00:00:00.000Z")).toBe("2026-09-30");
    expect(() => ymdDeFechaCalendario("basura")).toThrow();
    expect(() => ymdDeFechaCalendario("2026-09")).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("4. mora legítima vs mora del retraso", () => {
  test("cuota anterior a la boleta con mora (34 días) se cobra; solo la de la ventana se condona", () => {
    const p = escenario({
      cuotas: [
        { id: 11, venc: "2026-08-30", prev: "2026-07-30" },
        { id: 12, venc: "2026-09-30", prev: "2026-08-30" },
      ],
      moraActiva: "36.96", // 33.60 + 3.36
      monto: 633.6, // 33.60 mora legítima + 2 cuotas de 300
    });
    const d = decidirCondonacionBoletaTardia(p);
    expect(d.condonar).toBe(true);
    if (d.condonar) {
      expect(d.monto.toFixed(2)).toBe("3.36");
      expect(d.moraACobrar.toFixed(2)).toBe("33.60");
      expect(d.cuotas.map((c) => [c.cuota_id, c.monto.toFixed(2)])).toEqual([[12, "3.36"]]);
    }
  });
  test("con mora legítima, si el pago no alcanza para ella: no_alcanza_mora", () => {
    const p = escenario({
      cuotas: [
        { id: 11, venc: "2026-08-30", prev: "2026-07-30" },
        { id: 12, venc: "2026-09-30", prev: "2026-08-30" },
      ],
      moraActiva: "36.96",
      monto: 20,
    });
    expect(razon(decidirCondonacionBoletaTardia(p))).toBe("no_alcanza_mora");
  });
  test("con mora legítima y pago que no cubre la cuota vieja: no_queda_al_dia", () => {
    const p = escenario({
      cuotas: [
        { id: 11, venc: "2026-08-30", prev: "2026-07-30" },
        { id: 12, venc: "2026-09-30", prev: "2026-08-30" },
      ],
      moraActiva: "36.96",
      monto: 33.6 + 300, // solo alcanza la 11
    });
    expect(razon(decidirCondonacionBoletaTardia(p))).toBe("no_queda_al_dia");
  });
  test("dos cuotas en ventana (vencimientos cercanos): se condonan ambas, reparto suma el monto", () => {
    const p = escenario({
      boleta: "2026-09-27",
      cuotas: [
        { id: 11, venc: "2026-09-28", prev: "2026-08-28" }, // 5 días
        { id: 12, venc: "2026-09-30", prev: "2026-09-28" }, // 3 días
      ],
      moraActiva: "8.96",
      monto: 600,
    });
    const d = decidirCondonacionBoletaTardia(p);
    expect(d.condonar).toBe(true);
    if (d.condonar) {
      expect(d.monto.toFixed(2)).toBe("8.96");
      expect(d.moraACobrar.toFixed(2)).toBe("0.00");
      expect(d.cuotas.reduce((a, c) => a.plus(c.monto), new Big(0)).toFixed(2)).toBe("8.96");
      expect(d.cuotas.map((c) => c.cuota_id).sort()).toEqual([11, 12]);
    }
  });
  test("dos cuotas, la boleta alcanza a una sola (11 venció antes que la boleta): solo 12 en ventana", () => {
    const p = escenario({
      boleta: "2026-09-29",
      cuotas: [
        { id: 11, venc: "2026-09-28", prev: "2026-08-28" },
        { id: 12, venc: "2026-09-30", prev: "2026-09-28" },
      ],
      moraActiva: "8.96",
      monto: 5.6 + 600,
    });
    const d = decidirCondonacionBoletaTardia(p);
    expect(d.condonar).toBe(true);
    if (d.condonar) {
      expect(d.monto.toFixed(2)).toBe("3.36");
      expect(d.moraACobrar.toFixed(2)).toBe("5.60");
      expect(d.cuotas.map((c) => c.cuota_id)).toEqual([12]);
    }
  });
  test("mora activa MENOR que el devengado (ajuste manual a la baja): no se condona más que la mora activa", () => {
    const d = decidirCondonacionBoletaTardia(base({ moraActiva: "2.00" }));
    expect(d.condonar).toBe(true);
    if (d.condonar) {
      expect(d.monto.toNumber()).toBeLessThanOrEqual(2);
      expect(d.monto.plus(d.moraACobrar).toFixed(2)).toBe("2.00");
    }
  });
  test("mora activa MAYOR que el devengado (ajuste manual al alza): solo se condona lo del retraso", () => {
    const d = decidirCondonacionBoletaTardia(base({ moraActiva: "13.36", monto: 310 }));
    expect(d.condonar).toBe(true);
    if (d.condonar) {
      expect(d.monto.toFixed(2)).toBe("3.36");
      expect(d.moraACobrar.toFixed(2)).toBe("10.00");
    }
  });
  test("mora activa menor que la legítima + retraso: no inventa condonación de la mora legítima", () => {
    const p = escenario({
      cuotas: [
        { id: 11, venc: "2026-08-30", prev: "2026-07-30" },
        { id: 12, venc: "2026-09-30", prev: "2026-08-30" },
      ],
      moraActiva: "20.00", // menor que la legítima (33.60)
      monto: 700,
    });
    // mora activa 20 − legítima 33.60 < 0 → nada que condonar de la mora del retraso.
    expect(decidirCondonacionBoletaTardia(p)).toEqual({ condonar: false, razon: "fuera_de_ventana" });
  });
  test("ledger: ya se había pagado 1.00 de mora de la cuota 12 -> solo se condona el pendiente 2.36", () => {
    const p = escenario({
      cuotas: [{ id: 12, venc: "2026-09-30", prev: "2026-08-30", pagadoMora: "1.00" }],
      moraActiva: "2.36",
      monto: 300,
    });
    const d = decidirCondonacionBoletaTardia(p);
    expect(d.condonar).toBe(true);
    if (d.condonar) expect(d.monto.toFixed(2)).toBe("2.36");
  });
  test("ledger: la mora de la cuota 12 ya estaba pagada/condonada completa -> nada que condonar", () => {
    const p = escenario({
      cuotas: [{ id: 12, venc: "2026-09-30", prev: "2026-08-30", pagadoMora: "3.36" }],
      moraActiva: "5.00", // algo distinto sigue activo
      monto: 305,
    });
    expect(decidirCondonacionBoletaTardia(p).condonar).toBe(false);
  });
  test("ledger: sobrepago de mora en la 12 no reduce el pendiente de la 11 (por cuota)", () => {
    const p = escenario({
      boleta: "2026-09-27",
      cuotas: [
        { id: 11, venc: "2026-09-28", prev: "2026-08-28" },
        { id: 12, venc: "2026-09-30", prev: "2026-09-28", pagadoMora: "50" },
      ],
      moraActiva: "5.60",
      monto: 600,
    });
    const d = decidirCondonacionBoletaTardia(p);
    expect(d.condonar).toBe(true);
    if (d.condonar) {
      expect(d.monto.toFixed(2)).toBe("5.60");
      expect(d.cuotas.map((c) => c.cuota_id)).toEqual([11]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("5. 'queda al día' (tolerancia Q0.01) y disponible", () => {
  test("pago exacto: condona", () => {
    expect(decidirCondonacionBoletaTardia(base({ monto: 300 })).condonar).toBe(true);
  });
  test("pago corto por Q0.01: sigue al día (saldo <= 0.01 se tolera)", () => {
    expect(decidirCondonacionBoletaTardia(base({ monto: "299.99" })).condonar).toBe(true);
  });
  test("pago corto por Q0.02: no queda al día", () => {
    expect(razon(decidirCondonacionBoletaTardia(base({ monto: "299.98" })))).toBe("no_queda_al_dia");
  });
  test("pago de 0 o mucho menor: no queda al día", () => {
    expect(razon(decidirCondonacionBoletaTardia(base({ monto: 0 })))).toBe("no_queda_al_dia");
    expect(razon(decidirCondonacionBoletaTardia(base({ monto: 100 })))).toBe("no_queda_al_dia");
  });
  test("excedente: paga de más, condona igual y el monto no cambia", () => {
    const d = decidirCondonacionBoletaTardia(base({ monto: 5000 }));
    expect(d.condonar).toBe(true);
    if (d.condonar) expect(d.monto.toFixed(2)).toBe("3.36");
  });
  test("rubros: cubre todo menos un rubro (corto por 0.02): no condona", () => {
    expect(razon(decidirCondonacionBoletaTardia(base({ rubros: 50, monto: "349.98" })))).toBe("no_queda_al_dia");
  });
  test("rubros: cubre rubros + cuota exacto: condona", () => {
    expect(decidirCondonacionBoletaTardia(base({ rubros: 50, monto: 350 })).condonar).toBe(true);
  });
  test("rubros mayores que el disponible: no condona (los rubros se comen todo)", () => {
    expect(razon(decidirCondonacionBoletaTardia(base({ rubros: 500, monto: 300 })))).toBe("no_queda_al_dia");
  });
  test("ajuste de fecha ideal (cuota 1): exige pagar cuota + ajuste", () => {
    const mk = (monto: number) =>
      escenario({
        cuotas: [{ id: 1, numero: 1, venc: "2026-09-30", prev: null }],
        moraActiva: "3.36",
        monto,
        ajuste: { id: 9, monto_total: 20 },
      });
    expect(decidirCondonacionBoletaTardia(mk(320)).condonar).toBe(true);
    expect(razon(decidirCondonacionBoletaTardia(mk(300)))).toBe("no_queda_al_dia");
  });
  test("ajuste de fecha ideal NO se descuenta si la cuota 1 no está abierta (cuota 12)", () => {
    expect(decidirCondonacionBoletaTardia(base({ monto: 300, ajuste: { id: 9, monto_total: 20 } })).condonar).toBe(true);
  });
  test("disponibleParaCuotas: boleta - otros - abono", () => {
    expect(disponibleParaCuotas({ montoBoleta: 1000, otros: 100, abonoDirectoCapital: 200 }).toFixed(2)).toBe("700.00");
    expect(disponibleParaCuotas({ montoBoleta: "1000.50" }).toFixed(2)).toBe("1000.50");
    expect(disponibleParaCuotas({ montoBoleta: 1000, otros: null, abonoDirectoCapital: null }).toFixed(2)).toBe("1000.00");
    expect(disponibleParaCuotas({ montoBoleta: new Big("10.10"), otros: "0.10" }).toFixed(2)).toBe("10.00");
  });
  test("disponibleParaCuotas: abono > boleta nunca es negativo", () => {
    const d = disponibleParaCuotas({ montoBoleta: 100, otros: 50, abonoDirectoCapital: 500 });
    expect(d.toFixed(2)).toBe("0.00");
    expect(d.gte(0)).toBe(true);
  });
  test("con otros y abono_directo_capital reduciendo el disponible: 350 - 30 - 20 = 300 alcanza", () => {
    const monto = disponibleParaCuotas({ montoBoleta: 350, otros: 30, abonoDirectoCapital: 20 });
    expect(decidirCondonacionBoletaTardia(base({ monto })).condonar).toBe(true);
  });
  test("con otros y abono: 350 - 30 - 21 = 299 no alcanza", () => {
    const monto = disponibleParaCuotas({ montoBoleta: 350, otros: 30, abonoDirectoCapital: 21 });
    expect(razon(decidirCondonacionBoletaTardia(base({ monto })))).toBe("no_queda_al_dia");
  });
  test("abono > boleta: disponible 0 -> no queda al día", () => {
    const monto = disponibleParaCuotas({ montoBoleta: 100, abonoDirectoCapital: 5000 });
    expect(razon(decidirCondonacionBoletaTardia(base({ monto })))).toBe("no_queda_al_dia");
  });
  test("cuota posterior aún no vencida con saldo no obliga a pagarla", () => {
    const p = base();
    p.cuotasAbiertas = [
      ...p.cuotasAbiertas,
      { cuota_id: 13, numero_cuota: 13, fecha_vencimiento: "2026-10-30", saldo: 300 },
    ];
    expect(decidirCondonacionBoletaTardia(p).condonar).toBe(true);
  });
  test("otra cuota vencida (sin mora registrada) con saldo sin cubrir: no queda al día", () => {
    const p = base();
    p.cuotasAbiertas = [
      { cuota_id: 10, numero_cuota: 10, fecha_vencimiento: "2026-07-30", saldo: 300 },
      ...p.cuotasAbiertas,
    ];
    expect(razon(decidirCondonacionBoletaTardia(p))).toBe("no_queda_al_dia");
  });
  test("el monto en string, number o Big da el mismo resultado", () => {
    const a = decidirCondonacionBoletaTardia(base({ monto: 300 }));
    const b = decidirCondonacionBoletaTardia(base({ monto: "300" }));
    const c = decidirCondonacionBoletaTardia(base({ monto: new Big(300) }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("6. pagos pendientes (E-2)", () => {
  test("cuota vencida cubierta solo por un pago pendiente: no_queda_al_dia", () => {
    const p = base();
    p.cuotasAbiertas = [{ cuota_id: 12, numero_cuota: 12, fecha_vencimiento: "2026-09-30", saldo: 0, pagosPendientes: [777] }];
    p.monto = 0;
    expect(razon(decidirCondonacionBoletaTardia(p))).toBe("no_queda_al_dia");
  });
  test("pendiente de otra cuota vencida del crédito que hace falta: no condona", () => {
    const p = escenario({
      cuotas: [
        { id: 11, venc: "2026-08-30", prev: "2026-07-30", saldo: 0, pendientes: [555] },
        { id: 12, venc: "2026-09-30", prev: "2026-08-30" },
      ],
      moraActiva: "36.96",
      monto: 33.6 + 300,
    });
    expect(razon(decidirCondonacionBoletaTardia(p))).toBe("no_queda_al_dia");
  });
  test("pendiente con cierre diferido y el pago le toca plata: no condona", () => {
    const p = base();
    p.cuotasAbiertas = [{ ...p.cuotasAbiertas[0], cierreDiferido: true }];
    expect(razon(decidirCondonacionBoletaTardia(p))).toBe("no_queda_al_dia");
  });
  test("pendiente de una cuota NO vencida (no hace falta): condona y no lista pendientes", () => {
    const p = base();
    p.cuotasAbiertas = [
      ...p.cuotasAbiertas,
      { cuota_id: 13, numero_cuota: 13, fecha_vencimiento: "2026-10-30", saldo: 0, pagosPendientes: [888] },
    ];
    const d = decidirCondonacionBoletaTardia(p);
    expect(d.condonar).toBe(true);
    if (d.condonar) expect(d.pagosPendientes).toEqual([]);
  });
  test("sin pendientes: condona con pagosPendientes vacío", () => {
    const d = decidirCondonacionBoletaTardia(base());
    expect(d.condonar).toBe(true);
    if (d.condonar) expect(d.pagosPendientes).toEqual([]);
  });
  test("pagosPendientes: [] vacío explícito en la cuota no bloquea", () => {
    const p = base();
    p.cuotasAbiertas = [{ ...p.cuotasAbiertas[0], pagosPendientes: [] }];
    expect(decidirCondonacionBoletaTardia(p).condonar).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("7. cuotas duplicadas por numero_cuota", () => {
  test("la cuota con mora no está entre las abiertas (la duplicada vieja): no aplica", () => {
    const p = base();
    // insertPayment solo paga la de mayor cuota_id (99); la 12 con mora queda sin pagar.
    p.cuotasAbiertas = [{ cuota_id: 99, numero_cuota: 12, fecha_vencimiento: "2026-09-30", saldo: 300 }];
    expect(decidirCondonacionBoletaTardia(p).condonar).toBe(false);
  });
  test("ninguna cuota abierta: no aplica", () => {
    const p = base();
    p.cuotasAbiertas = [];
    expect(decidirCondonacionBoletaTardia(p).condonar).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("8. estado del crédito y mora", () => {
  for (const ok of ["ACTIVO", "MOROSO"]) {
    test(`${ok} aplica`, () => {
      expect(decidirCondonacionBoletaTardia(base({ status: ok })).condonar).toBe(true);
    });
  }
  for (const mal of ["EN_CONVENIO", "INCOBRABLE", "CANCELADO", "PENDIENTE_CANCELACION", "CAIDO", "activo", "", "XYZ"]) {
    test(`${JSON.stringify(mal)} no aplica (estado_no_aplica)`, () => {
      expect(razon(decidirCondonacionBoletaTardia(base({ status: mal })))).toBe("estado_no_aplica");
    });
  }
  test("estado null no aplica", () => {
    expect(razon(decidirCondonacionBoletaTardia(base({ status: null })))).toBe("estado_no_aplica");
  });
  for (const [nombre, v] of [["null", null], ["0", 0], ["'0'", "0"], ["'0.00'", "0.00"], ["Big(0)", new Big(0)], ["negativa", "-1"]] as const) {
    test(`sin mora activa (${nombre}) -> sin_mora`, () => {
      expect(razon(decidirCondonacionBoletaTardia(base({ moraActiva: v as number | string | null | Big })))).toBe("sin_mora");
    });
  }
  test("mora activa en 0.00 aunque haya cuotas con días de atraso: no aplica", () => {
    expect(decidirCondonacionBoletaTardia(base({ moraActiva: "0.00" })).condonar).toBe(false);
  });
  test("sin cuotas con mora (lista vacía): no aplica", () => {
    const p = base();
    p.cuotasConMora = [];
    expect(decidirCondonacionBoletaTardia(p).condonar).toBe(false);
  });
  test("capital 0 / null: no hay devengado -> no condona", () => {
    expect(decidirCondonacionBoletaTardia(base({ capital: 0 })).condonar).toBe(false);
    const p = { ...base(), capital: null };
    expect(decidirCondonacionBoletaTardia(p).condonar).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("9. redondeo y tipos numéricos", () => {
  test("capital con decimales: 3333.33 x 3 días = 3.7333296; mora activa 3.73 -> condona 3.73", () => {
    const d = decidirCondonacionBoletaTardia(base({ capital: "3333.33", moraActiva: "3.73" }));
    expect(d.condonar).toBe(true);
    if (d.condonar) {
      expect(d.monto.toFixed(2)).toBe("3.73");
      expect(d.moraACobrar.toFixed(2)).toBe("0.00");
    }
  });
  test("mora activa redondeada hacia arriba (3.74) no condona más que el techo del devengado", () => {
    const d = decidirCondonacionBoletaTardia(base({ capital: "3333.33", moraActiva: "3.74", monto: 304 }));
    expect(d.condonar).toBe(true);
    if (d.condonar) {
      expect(d.monto.toNumber()).toBeLessThanOrEqual(3.74);
      expect(d.monto.plus(d.moraACobrar).toFixed(2)).toBe("3.74");
    }
  });
  test("mora activa con 3 decimales: el monto condonado tiene a lo sumo 2 decimales y nunca supera la activa", () => {
    const d = decidirCondonacionBoletaTardia(base({ capital: "3333.33", moraActiva: "3.739", monto: 304 }));
    expect(d.condonar).toBe(true);
    if (d.condonar) {
      expect(d.monto.round(2, Big.roundDown).eq(d.monto)).toBe(true);
      expect(d.monto.toNumber()).toBeLessThanOrEqual(3.739);
    }
  });
  test("centavos: 1 día con capital 100 (0.0373) -> mora activa 0.04 condona a lo sumo 0.04", () => {
    const p = escenario({
      cuotas: [{ id: 12, venc: "2026-10-02", prev: "2026-09-02" }],
      capital: 100,
      moraActiva: "0.04",
      monto: 300,
    });
    const d = decidirCondonacionBoletaTardia(p);
    expect(d.condonar).toBe(true);
    if (d.condonar) expect(d.monto.toFixed(2)).toBe("0.04");
  });
  test("mora diminuta (0.003 devengado): condona el techo redondeado hacia arriba (0.01)", () => {
    const p = escenario({
      cuotas: [{ id: 12, venc: "2026-10-02", prev: "2026-09-02" }],
      capital: 8,
      moraActiva: "0.01",
      monto: 300,
    });
    const d = decidirCondonacionBoletaTardia(p);
    expect(d.condonar).toBe(true);
    if (d.condonar) expect(d.monto.toFixed(2)).toBe("0.01"); // techo del devengado (0.00299) redondeado hacia arriba
  });
  test("capital/mora/monto/saldo como string, number o Big son equivalentes", () => {
    const a = decidirCondonacionBoletaTardia(base());
    const p = base();
    const b = decidirCondonacionBoletaTardia({
      ...p,
      capital: new Big(3000),
      moraActiva: new Big("3.36"),
      monto: new Big(300),
      cuotasAbiertas: p.cuotasAbiertas.map((c) => ({ ...c, saldo: new Big(300) })),
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  test("saldo de la cuota con 3 decimales 300.005 y pago 300: dentro de tolerancia (0.005 <= 0.01)", () => {
    const p = base();
    p.cuotasAbiertas = [{ ...p.cuotasAbiertas[0], saldo: "300.005" }];
    expect(decidirCondonacionBoletaTardia(p).condonar).toBe(true);
  });
  test("saldo 300.011 y pago 300: excede la tolerancia", () => {
    const p = base();
    p.cuotasAbiertas = [{ ...p.cuotasAbiertas[0], saldo: "300.011" }];
    expect(razon(decidirCondonacionBoletaTardia(p))).toBe("no_queda_al_dia");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("10. no regresión de Nexa (ventana de 3 días hábiles intacta)", () => {
  const nexa = (fechaBanco: string, venc = "2026-09-25", hoy = "2026-10-05") => {
    const dias = diasEntre(venc, hoy);
    return decidirCondonacionNexaATiempo({
      statusCredit: "ACTIVO",
      capital: 3000,
      moraActiva: new Big("1.12").times(Math.min(dias, 30)).toFixed(2),
      cuotasConMora: [{ cuota_id: 12, diasAtraso: dias, pagado: 0, fecha_vencimiento: venc }],
      cuotasAbiertas: [{ cuota_id: 12, numero_cuota: 12, fecha_vencimiento: venc, saldo: 300 }],
      monto: 300,
      hoy,
      rubrosPendientes: 0,
      ajusteFechaIdeal: null,
      fechaBanco,
    });
  };
  test("fin de semana: vence viernes 25-sep, +3 hábiles = miércoles 30-sep -> aplica", () => {
    expect(nexa("2026-09-30").condonar).toBe(true);
  });
  test("fin de semana: jueves 01-oct queda fuera de la ventana", () => {
    const d = nexa("2026-10-01");
    expect(d.condonar).toBe(false);
    if (!d.condonar) expect(d.razon).toBe("fuera_de_ventana");
  });
  test("Nexa aplica con fechaBanco posterior al vencimiento (la boleta tardía no)", () => {
    expect(nexa("2026-09-28").condonar).toBe(true);
    expect(decidirCondonacionBoletaTardia(base({ boleta: "2026-10-01" })).condonar).toBe(false);
  });
  test("feriado: vence viernes 16-oct, el 20-oct (Revolución) no cuenta -> ventana hasta jueves 22-oct", () => {
    expect(nexa("2026-10-22", "2026-10-16", "2026-10-26").condonar).toBe(true);
    const fuera = nexa("2026-10-23", "2026-10-16", "2026-10-26");
    expect(fuera.condonar).toBe(false);
    if (!fuera.condonar) expect(fuera.razon).toBe("fuera_de_ventana");
  });
  test("Nexa NO hereda el tope de 5 días: 10 días de atraso y fechaBanco dentro de ventana aplica", () => {
    expect(nexa("2026-09-30", "2026-09-25", "2026-10-05").condonar).toBe(true);
    // 16 días de atraso entre vencimiento y hoy:
    expect(nexa("2026-09-30", "2026-09-25", "2026-10-11").condonar).toBe(true);
  });
  test("Nexa NO hereda E-2: se apoya en un pago pendiente y condona listando el pendiente", () => {
    const d = decidirCondonacionNexaATiempo({
      statusCredit: "ACTIVO",
      capital: 3000,
      moraActiva: "5.60",
      cuotasConMora: [{ cuota_id: 12, diasAtraso: 5, pagado: 0, fecha_vencimiento: "2026-09-28" }],
      cuotasAbiertas: [{ cuota_id: 12, numero_cuota: 12, fecha_vencimiento: "2026-09-28", saldo: 0, pagosPendientes: [777] }],
      monto: 0,
      hoy: "2026-10-03",
      rubrosPendientes: 0,
      ajusteFechaIdeal: null,
      fechaBanco: "2026-09-29",
    });
    expect(d.condonar).toBe(true);
    if (d.condonar) expect(d.pagosPendientes).toEqual([777]);
  });
  test("Nexa conserva estado_no_aplica y sin_mora", () => {
    const base0 = {
      capital: 3000,
      cuotasConMora: [{ cuota_id: 12, diasAtraso: 3, pagado: 0, fecha_vencimiento: "2026-09-30" }],
      cuotasAbiertas: [{ cuota_id: 12, numero_cuota: 12, fecha_vencimiento: "2026-09-30", saldo: 300 }],
      monto: 300,
      hoy: "2026-10-03",
      rubrosPendientes: 0,
      ajusteFechaIdeal: null,
      fechaBanco: "2026-10-01",
    };
    const a = decidirCondonacionNexaATiempo({ ...base0, statusCredit: "EN_CONVENIO", moraActiva: "3.36" });
    const b = decidirCondonacionNexaATiempo({ ...base0, statusCredit: "ACTIVO", moraActiva: null });
    expect(a.condonar === false && a.razon).toBe("estado_no_aplica");
    expect(b.condonar === false && b.razon).toBe("sin_mora");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("11. propiedades", () => {
  test("barrido: monto <= mora activa, monto <= techo del devengado en ventana, >= 0, 2 decimales, reparto suma el monto", () => {
    let evaluados = 0;
    let condonados = 0;
    const capitales = ["100", "999.99", "3000", "3333.33", "12500.5", "50000"];
    const dias = [0, 1, 2, 3, 4, 5, 6, 10, 30, 45];
    const ajustes = ["-5", "-0.01", "0", "0.01", "1", "50"];
    const montos = [0, 100, 299.98, 300, 305, 400, 100000];
    for (const capital of capitales) {
      for (const d of dias) {
        const hoy = "2026-10-03";
        const ms = Date.parse(`${hoy}T00:00:00Z`) - d * DIA;
        const venc = new Date(ms).toISOString().slice(0, 10);
        const dev = new Big(capital).times("0.0112").times(d >= 30 ? 1 : new Big(d).div(30));
        for (const aj of ajustes) {
          for (const monto of montos) {
            const moraActiva = dev.round(2, Big.roundHalfUp).plus(aj);
            const p = escenario({
              hoy,
              cuotas: [{ id: 12, venc, prev: "2026-01-01" }],
              capital,
              moraActiva,
              monto,
              boleta: venc,
            });
            const dec = decidirCondonacionBoletaTardia(p);
            evaluados++;
            if (!dec.condonar) continue;
            condonados++;
            expect(dec.monto.gt(0)).toBe(true);
            expect(dec.monto.lte(moraActiva)).toBe(true);
            expect(dec.monto.lte(dev.round(2, Big.roundUp))).toBe(true);
            expect(dec.monto.round(2, Big.roundDown).eq(dec.monto)).toBe(true);
            expect(dec.moraACobrar.gte(0)).toBe(true);
            expect(dec.monto.plus(dec.moraACobrar).eq(moraActiva)).toBe(true);
            // El reparto por cuota usa el devengado SIN redondear: puede quedar por debajo del monto
            // (redondeado) en menos de un centavo, nunca por encima. Ver reporte (ambigüedad A-1).
            const sumaCuotas = dec.cuotas.reduce((a, c) => a.plus(c.monto), new Big(0));
            expect(sumaCuotas.lte(dec.monto)).toBe(true);
            expect(dec.monto.minus(sumaCuotas).lt("0.01")).toBe(true);
            expect(dec.cuotas.every((c) => c.monto.gt(0))).toBe(true);
            expect(d).toBeLessThanOrEqual(TOPE_DIAS_BOLETA_TARDIA);
            expect(d).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(evaluados).toBeGreaterThan(1000);
    expect(condonados).toBeGreaterThan(0);
  });

  test("con mora legítima + retraso: monto <= devengado de la ventana y <= mora activa - legítima redondeada", () => {
    let condonados2 = 0;
    for (const legitDias of [6, 15, 29, 60]) {
      const venc11 = new Date(Date.parse("2026-10-03T00:00:00Z") - legitDias * DIA).toISOString().slice(0, 10);
      const dev11 = new Big(3000).times("0.0112").times(legitDias >= 30 ? 1 : new Big(legitDias).div(30));
      for (const extra of ["-10", "0", "7"]) {
        const moraActiva = dev11.plus("3.36").round(2, Big.roundHalfUp).plus(extra);
        const p = escenario({
          boleta: "2026-09-30",
          cuotas: [
            { id: 11, venc: venc11, prev: "2020-01-01" },
            { id: 12, venc: "2026-09-30", prev: venc11 > "2026-09-29" ? "2020-01-01" : "2026-08-30" },
          ],
          moraActiva,
          monto: 100000,
        });
        // Para que la boleta (30-sep) sea posterior al venc 11 si legitDias >= 5; si no, la 11 también estaría en ventana.
        const d = decidirCondonacionBoletaTardia(p);
        if (!d.condonar) continue;
        condonados2++;
        expect(d.monto.lte(moraActiva)).toBe(true);
        expect(d.monto.gte(0)).toBe(true);
        expect(d.moraACobrar.gte(0)).toBe(true);
        if (venc11 < "2026-09-30") {
          // la 11 es legítima: la condonación no puede pasar de la mora de la 12
          expect(d.monto.lte(new Big("3.36"))).toBe(true);
          expect(d.cuotas.every((c) => c.cuota_id === 12)).toBe(true);
        }
      }
    }
    expect(condonados2).toBeGreaterThan(0);
  });
});
