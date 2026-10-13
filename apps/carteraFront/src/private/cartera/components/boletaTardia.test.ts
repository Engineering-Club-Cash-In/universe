import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  avisoCondonacionAnulada, bloqueCondonacionParaEnviar, esConflictoDeCondonacion, estaAceptada, estadoRecuadroBoletaTardia, fechaCortaBoletaTardia,
  mensajeConflictoCondonacion, moraDespuesDeCondonar, parametrosPreviewBoletaTardia, textoCasillaBoletaTardia,
  textoFechasBoletaTardia, textoMoraDelRetraso, type VistaPreviaBoletaTardia,
} from "./boletaTardia";

const INTENTO = "00000000-0000-4000-8000-000000000001";
const vista = (o: Partial<VistaPreviaBoletaTardia> = {}): VistaPreviaBoletaTardia => ({
  aplica: true, razon: null, fechaVencimiento: "2026-09-30", fechaBoleta: "2026-09-30", fechaRegistro: "2026-10-03", diasRetraso: 3,
  montoCondonar: "11.20", moraACobrar: "0.00",
  porCuota: [{ cuota_id: 212, numero_cuota: 12, fecha_vencimiento: "2026-09-30", monto: "11.200000" }],
  intentoId: INTENTO, ...o,
});
const completo = { esCancelacion: false, numeroAutorizacion: "A-1", bancoId: 3, hayBoleta: true };

describe("estadoRecuadroBoletaTardia", () => {
  test("aplica y está completo → casilla", () => {
    expect(estadoRecuadroBoletaTardia(vista(), completo).tipo).toBe("casilla");
  });
  test("sin vista, o en cancelación de crédito → oculto", () => {
    expect(estadoRecuadroBoletaTardia(null, completo)).toEqual({ tipo: "oculto" });
    expect(estadoRecuadroBoletaTardia(undefined, completo)).toEqual({ tipo: "oculto" });
    expect(estadoRecuadroBoletaTardia(vista(), { ...completo, esCancelacion: true })).toEqual({ tipo: "oculto" });
  });
  test("a tiempo pero no queda al día / no alcanza la mora legítima → gris con motivo y sin casilla", () => {
    const a = estadoRecuadroBoletaTardia(vista({ aplica: false, razon: "no_queda_al_dia", montoCondonar: "0.00", porCuota: [] }), completo);
    expect(a).toMatchObject({ tipo: "gris", motivo: "Pagó a tiempo, pero este pago no deja el crédito al día: no se puede condonar." });
    const b = estadoRecuadroBoletaTardia(vista({ aplica: false, razon: "no_alcanza_mora", porCuota: [] }), completo);
    expect(b).toMatchObject({ tipo: "gris", motivo: "El pago no alcanza ni para la mora de cuotas anteriores: no se puede condonar." });
  });
  test("aplica pero falta banco, número de autorización o imagen → gris (no se puede marcar)", () => {
    for (const falta of [{ bancoId: 0 }, { numeroAutorizacion: "  " }, { hayBoleta: false }]) {
      const e = estadoRecuadroBoletaTardia(vista(), { ...completo, ...falta });
      expect(e).toMatchObject({ tipo: "gris", motivo: "Para condonar hace falta el banco, el número de autorización y la imagen de la boleta." });
    }
  });
  test("el resto de razones no muestran recuadro (boleta posterior, más de 5 días, estado excluido, sin mora…)", () => {
    for (const razon of ["fuera_de_ventana", "fuera_de_tope", "estado_no_aplica", "sin_mora", "boleta_invalida", "boleta_de_otro_periodo", "credito_no_encontrado"] as const) {
      expect(estadoRecuadroBoletaTardia(vista({ aplica: false, razon, porCuota: [] }), completo)).toEqual({ tipo: "oculto" });
    }
  });
});

describe("la mora de la distribución se recalcula en vivo al marcar la casilla", () => {
  test("marcada: mora − condonado; sin marcar: la mora tal cual", () => {
    expect(moraDespuesDeCondonar(175.8, vista({ montoCondonar: "11.20" }), true)).toBe(164.6);
    expect(moraDespuesDeCondonar(175.8, vista(), false)).toBe(175.8);
  });
  test("nunca negativa, sin colas de flotante, y sin vista o sin aplicar no cambia nada", () => {
    expect(moraDespuesDeCondonar(5, vista({ montoCondonar: "11.20" }), true)).toBe(0);
    expect(moraDespuesDeCondonar(0.3, vista({ montoCondonar: "0.10" }), true)).toBe(0.2);
    expect(moraDespuesDeCondonar(100, null, true)).toBe(100);
    expect(moraDespuesDeCondonar(100, vista({ aplica: false, montoCondonar: "0.00" }), true)).toBe(100);
  });
});

describe("aceptación atada al intento", () => {
  test("solo cuenta si el intento aceptado es el de la vista vigente (un refetch la desmarca)", () => {
    expect(estaAceptada(vista(), INTENTO)).toBe(true);
    expect(estaAceptada(vista(), "otro-intento")).toBe(false);
    expect(estaAceptada(vista(), null)).toBe(false);
    expect(estaAceptada(null, INTENTO)).toBe(false);
    expect(estaAceptada(vista({ aplica: false }), INTENTO)).toBe(false);
  });
  test("F3/F4: no viaja si el recuadro pasó a gris, ni con monto inválido o sin intentoId", () => {
    expect(bloqueCondonacionParaEnviar(vista(), INTENTO, { ...completo, hayBoleta: false })).toBeUndefined();
    expect(bloqueCondonacionParaEnviar(vista({ montoCondonar: "0.00" }), INTENTO, completo)).toBeUndefined();
    expect(bloqueCondonacionParaEnviar(vista({ montoCondonar: "abc" }), INTENTO, completo)).toBeUndefined();
    expect(bloqueCondonacionParaEnviar(vista({ intentoId: "" }), "", completo)).toBeUndefined();
    expect(moraDespuesDeCondonar(100, vista({ montoCondonar: "abc" }), true)).toBe(100);
    expect(moraDespuesDeCondonar(100, vista({ montoCondonar: "-5" }), true)).toBe(100);
  });
  test("el bloque que viaja en el body lleva intentoId y montoAceptado con dos decimales; sin aceptar, nada", () => {
    expect(bloqueCondonacionParaEnviar(vista(), INTENTO, completo)).toEqual({ intentoId: INTENTO, montoAceptado: "11.20" });
    expect(bloqueCondonacionParaEnviar(vista({ montoCondonar: "11.2" }), INTENTO, completo)).toEqual({ intentoId: INTENTO, montoAceptado: "11.20" });
    expect(bloqueCondonacionParaEnviar(vista(), null, completo)).toBeUndefined();
    expect(bloqueCondonacionParaEnviar(null, INTENTO, completo)).toBeUndefined();
  });
});

describe("textos del recuadro", () => {
  test("fechas cortas y línea de tiempo", () => {
    expect(fechaCortaBoletaTardia("2026-09-30")).toBe("30-sep");
    expect(fechaCortaBoletaTardia("2027-01-02")).toBe("02-ene");
    expect(textoFechasBoletaTardia(vista())).toBe("Vence 30-sep · Boleta 30-sep · Hoy 03-oct (3 días de retraso)");
    expect(textoFechasBoletaTardia(vista({ diasRetraso: 1, fechaRegistro: "2026-10-01" }))).toBe("Vence 30-sep · Boleta 30-sep · Hoy 01-oct (1 día de retraso)");
  });
  test("mora del retraso y casilla (una y varias cuotas)", () => {
    expect(textoMoraDelRetraso(vista())).toBe("Mora generada por el retraso: Q11.20 · Cuota 12");
    expect(textoMoraDelRetraso(vista({ porCuota: [
      { cuota_id: 1, numero_cuota: 12, fecha_vencimiento: "2026-09-30", monto: "5.000000" },
      { cuota_id: 2, numero_cuota: 13, fecha_vencimiento: "2026-10-01", monto: "6.200000" }] }))).toBe("Mora generada por el retraso: Q11.20 · Cuotas 12, 13");
    expect(textoCasillaBoletaTardia(vista())).toBe("Verifiqué la boleta: es del 30-sep. Acepto condonar Q11.20 (queda a mi nombre)");
  });
});

describe("parametrosPreviewBoletaTardia", () => {
  const ok = { credito_id: 5, monto_boleta: 1000, otros: 100, abono_directo_capital: 0, fecha_boleta: "2026-09-30" };
  test("arma los parámetros con 0 por defecto", () => {
    expect(parametrosPreviewBoletaTardia(ok, false)).toEqual(ok);
    expect(parametrosPreviewBoletaTardia({ credito_id: 5, monto_boleta: 1000, fecha_boleta: "2026-09-30" }, false))
      .toEqual({ credito_id: 5, monto_boleta: 1000, otros: 0, abono_directo_capital: 0, fecha_boleta: "2026-09-30" });
  });
  test("null si falta crédito, monto o fecha, o si es cancelación", () => {
    expect(parametrosPreviewBoletaTardia({ ...ok, credito_id: 0 }, false)).toBeNull();
    expect(parametrosPreviewBoletaTardia({ ...ok, monto_boleta: 0 }, false)).toBeNull();
    expect(parametrosPreviewBoletaTardia({ ...ok, fecha_boleta: "" }, false)).toBeNull();
    expect(parametrosPreviewBoletaTardia(ok, true)).toBeNull();
  });
});

describe("conflicto 409 del servidor", () => {
  const axios409 = (code: string, message = "La mora cambió") => ({ response: { status: 409, data: { success: false, code, message } } });
  test("solo mora_cambio / ya_no_aplica con 409 son conflicto de condonación", () => {
    expect(esConflictoDeCondonacion(axios409("mora_cambio"))).toBe(true);
    expect(esConflictoDeCondonacion(axios409("ya_no_aplica"))).toBe(true);
    expect(esConflictoDeCondonacion(axios409("otro"))).toBe(false);
    expect(esConflictoDeCondonacion({ response: { status: 500, data: { code: "mora_cambio" } } })).toBe(false);
    expect(esConflictoDeCondonacion(new Error("x"))).toBe(false);
    expect(esConflictoDeCondonacion(null)).toBe(false);
  });
  test("mensaje: el del servidor, o uno por defecto", () => {
    expect(mensajeConflictoCondonacion(axios409("mora_cambio", "La mora cambió desde que se mostró el cálculo."))).toBe("La mora cambió desde que se mostró el cálculo.");
    expect(mensajeConflictoCondonacion({ response: { status: 409, data: { code: "mora_cambio" } } })).toBe("La condonación cambió. Revise el nuevo cálculo y vuelva a confirmar.");
  });
});

describe("el body de /newPayment", () => {
  const base = { credito_id: 5, monto_boleta: 1000 };
  test("casilla sin marcar: el body serializado NO lleva la clave condonacionBoletaTardia", () => {
    const body = JSON.stringify({ ...base, condonacionBoletaTardia: bloqueCondonacionParaEnviar(vista(), null, completo) });
    expect(body).not.toContain("condonacionBoletaTardia");
  });
  test("casilla marcada: viaja intentoId y montoAceptado", () => {
    const body = JSON.parse(JSON.stringify({ ...base, condonacionBoletaTardia: bloqueCondonacionParaEnviar(vista(), INTENTO, completo) }));
    expect(body.condonacionBoletaTardia).toEqual({ intentoId: INTENTO, montoAceptado: "11.20" });
  });
});

describe("aviso E-11", () => {
  test("solo si la respuesta trae la condonación anulada por no quedar al día", () => {
    expect(avisoCondonacionAnulada({ condonacionBoletaTardia: { estado: "anulada_no_quedo_al_dia" } }))
      .toBe("El pago se registró, pero el crédito no quedó al día: la condonación se deshizo y la mora sigue vigente.");
    expect(avisoCondonacionAnulada({ condonacionBoletaTardia: { estado: "vigente" } })).toBeNull();
    expect(avisoCondonacionAnulada({ condonacionBoletaTardia: null })).toBeNull();
    expect(avisoCondonacionAnulada({})).toBeNull();
    expect(avisoCondonacionAnulada(undefined)).toBeNull();
  });
});

describe("F2 razones del 409 en español", () => {
  const razones = ["estado_no_aplica", "sin_mora", "fuera_de_ventana", "no_alcanza_mora", "no_queda_al_dia", "fuera_de_tope", "boleta_invalida", "boleta_de_otro_periodo", "credito_no_encontrado"];
  for (const r of razones) {
    test(r, () => {
      const t = mensajeConflictoCondonacion({ response: { status: 409, data: { code: "ya_no_aplica", message: `La condonación ya no aplica (${r}). Revise el cálculo.` } } });
      expect(t).not.toContain(r);
      expect(t).toMatch(/^La condonación ya no aplica: .+\. Revise el cálculo\.$/);
    });
  }
  test("fuera_de_tope y no_queda_al_dia", () => {
    const m = (r: string) => mensajeConflictoCondonacion({ response: { status: 409, data: { message: `x (${r}) y` } } });
    expect(m("fuera_de_tope")).toContain("pasaron más de 5 días desde el vencimiento");
    expect(m("no_queda_al_dia")).toContain("con este pago el crédito no queda al día");
  });
});

describe("F5 nulos y NaN", () => {
  test("fechas null no rompen", () => {
    expect(textoFechasBoletaTardia(vista({ fechaVencimiento: null }))).toBe("");
  });
  test("NaN → null", () => {
    expect(parametrosPreviewBoletaTardia({ credito_id: 5, monto_boleta: NaN, fecha_boleta: "2026-09-30" }, false)).toBeNull();
    expect(parametrosPreviewBoletaTardia({ credito_id: 5, monto_boleta: 10, otros: NaN, fecha_boleta: "2026-09-30" }, false)).toBeNull();
  });
});

describe("F1 hook: la apertura va en la queryKey", () => {
  test("contrato sobre el fuente", () => {
    const src = readFileSync(new URL("../hooks/useBoletaTardiaPreview.ts", import.meta.url), "utf8");
    expect(src).toContain("aperturaId = 0");
    expect(src).toContain('queryKey: ["boleta-tardia-preview", aperturaId, params]');
  });
});
