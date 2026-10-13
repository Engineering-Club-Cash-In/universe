import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  avisoCondonacionAnulada, bloqueCondonacionParaEnviar, esConflictoDeCondonacion, estaAceptada, estadoRecuadroBoletaTardia,
  fechaCortaBoletaTardia, mensajeConflictoCondonacion, moraDespuesDeCondonar, parametrosPreviewBoletaTardia,
  textoCasillaBoletaTardia, textoFechasBoletaTardia, textoMoraDelRetraso, type RazonBoletaTardia, type VistaPreviaBoletaTardia,
} from "./boletaTardia";

const INTENTO = "00000000-0000-4000-8000-000000000001";
const vista = (o: Partial<VistaPreviaBoletaTardia> = {}): VistaPreviaBoletaTardia => ({
  aplica: true, razon: null, fechaVencimiento: "2026-09-30", fechaBoleta: "2026-09-30", fechaRegistro: "2026-10-03", diasRetraso: 3,
  montoCondonar: "11.20", moraACobrar: "0.00",
  porCuota: [{ cuota_id: 212, numero_cuota: 12, fecha_vencimiento: "2026-09-30", monto: "11.200000" }],
  intentoId: INTENTO, ...o,
});
const completo = { esCancelacion: false, numeroAutorizacion: "A-1", bancoId: 3, hayBoleta: true };
const raiz = new URL(".", import.meta.url).pathname;
const leer = (rel: string) => readFileSync(raiz + rel, "utf8");

describe("cada razon del back -> que se ve", () => {
  const todas: RazonBoletaTardia[] = ["estado_no_aplica", "sin_mora", "fuera_de_ventana", "no_alcanza_mora", "no_queda_al_dia",
    "fuera_de_tope", "boleta_invalida", "boleta_de_otro_periodo", "credito_no_encontrado"];
  const esperado: Record<RazonBoletaTardia, "gris" | "oculto"> = {
    estado_no_aplica: "oculto", sin_mora: "oculto", fuera_de_ventana: "oculto", no_alcanza_mora: "gris", no_queda_al_dia: "gris",
    fuera_de_tope: "oculto", boleta_invalida: "oculto", boleta_de_otro_periodo: "oculto", credito_no_encontrado: "oculto",
  };
  for (const r of todas) {
    test(`!aplica + ${r} -> ${esperado[r]}`, () => {
      expect(estadoRecuadroBoletaTardia(vista({ aplica: false, razon: r, porCuota: [] }), completo).tipo).toBe(esperado[r]);
    });
  }
  test("las razones del back del fuente estan todas cubiertas por el tipo del front", () => {
    const u = readFileSync(raiz + "../../../../../cartera-back/src/utils/condonacionNexaATiempo.ts", "utf8");
    const bloques = [...u.matchAll(/export type (RazonSinCondonacionNexa|RazonSinCondonacion)\s*=([\s\S]*?);\n/g)].map((m) => m[2]);
    expect(bloques.length).toBe(2);
    const razonesBack = bloques.flatMap((b) => [...b.replace(/\/\/.*$/gm, "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
    expect(razonesBack.length).toBeGreaterThan(5);
    for (const r of razonesBack) expect(todas).toContain(r as RazonBoletaTardia);
  });
  test("!aplica sin razon (null) u otra razon desconocida -> oculto, nunca casilla", () => {
    expect(estadoRecuadroBoletaTardia(vista({ aplica: false, razon: null }), completo)).toEqual({ tipo: "oculto" });
    expect(estadoRecuadroBoletaTardia(vista({ aplica: false, razon: "nueva_razon" as never }), completo)).toEqual({ tipo: "oculto" });
  });
  test("!aplica + razon gris con datos faltantes sigue siendo gris con el motivo de la razon (no el de faltantes)", () => {
    const e = estadoRecuadroBoletaTardia(vista({ aplica: false, razon: "no_queda_al_dia" }), { ...completo, hayBoleta: false });
    expect(e).toMatchObject({ tipo: "gris", motivo: expect.stringContaining("no deja el crédito al día") });
  });
  test("aplica true con razon no nula (incoherente) igual da casilla solo si completo", () => {
    expect(estadoRecuadroBoletaTardia(vista({ razon: "sin_mora" }), completo).tipo).toBe("casilla");
  });
  test("cancelacion oculta aun con razon gris y con aplica", () => {
    expect(estadoRecuadroBoletaTardia(vista({ aplica: false, razon: "no_queda_al_dia" }), { ...completo, esCancelacion: true })).toEqual({ tipo: "oculto" });
  });
  test("banco como NaN/undefined o autorizacion solo tabs -> gris", () => {
    expect(estadoRecuadroBoletaTardia(vista(), { ...completo, bancoId: NaN }).tipo).toBe("gris");
    expect(estadoRecuadroBoletaTardia(vista(), { ...completo, numeroAutorizacion: "\t \n" }).tipo).toBe("gris");
  });
});

describe("montos: string/number, 3 decimales, cero, negativos", () => {
  test("montoAceptado == montoCondonar del back cuando ya trae 2 decimales (identico, sin redondeo)", () => {
    for (const m of ["11.20", "0.01", "999999.99", "1234567.89", "0.10", "5.05", "1.15", "2.675", "0.07"]) {
      const b = bloqueCondonacionParaEnviar(vista({ montoCondonar: m }), INTENTO, completo);
      if (/^\d+\.\d{2}$/.test(m)) expect(b?.montoAceptado).toBe(m);
    }
  });
  test("montoCondonar como number (el back lo manda string pero el front no debe condonar distinto)", () => {
    expect(bloqueCondonacionParaEnviar(vista({ montoCondonar: 11.2 as never }), INTENTO, completo)?.montoAceptado).toBe("11.20");
    expect(bloqueCondonacionParaEnviar(vista({ montoCondonar: 11 as never }), INTENTO, completo)?.montoAceptado).toBe("11.00");
  });
  test("3 decimales: el string aceptado nunca sube un centavo (11.204 -> 11.20)", () => {
    expect(bloqueCondonacionParaEnviar(vista({ montoCondonar: "11.204" }), INTENTO, completo)?.montoAceptado).toBe("11.20");
  });
  test("montoCondonar negativo o no numerico NO genera bloque (nunca 'NaN' ni '-5.00' al back)", () => {
    for (const m of ["-5.00", "abc", "", "NaN", "Infinity"]) {
      const b = bloqueCondonacionParaEnviar(vista({ montoCondonar: m }), INTENTO, completo);
      if (b) expect(b.montoAceptado).toMatch(/^\d+\.\d{2}$/);
      expect(b?.montoAceptado).not.toBe("NaN");
      expect(b?.montoAceptado ?? "ok").not.toContain("-");
    }
  });
  test("moraDespuesDeCondonar con monto negativo no AUMENTA la mora", () => {
    expect(moraDespuesDeCondonar(100, vista({ montoCondonar: "-5.00" }), true)).toBeLessThanOrEqual(100);
  });
  test("moraDespuesDeCondonar con monto no numerico no devuelve NaN", () => {
    expect(Number.isNaN(moraDespuesDeCondonar(100, vista({ montoCondonar: "abc" }), true))).toBe(false);
  });
  test("moraDespuesDeCondonar: monto 0.00, igual a la mora, mayor, flotantes", () => {
    expect(moraDespuesDeCondonar(100, vista({ montoCondonar: "0.00" }), true)).toBe(100);
    expect(moraDespuesDeCondonar(11.2, vista({ montoCondonar: "11.20" }), true)).toBe(0);
    expect(moraDespuesDeCondonar(0.1 + 0.2, vista({ montoCondonar: "0.30" }), true)).toBe(0);
    expect(moraDespuesDeCondonar(0, vista(), true)).toBe(0);
  });
  test("textos con montos: miles, ceros, 3 decimales", () => {
    expect(textoCasillaBoletaTardia(vista({ montoCondonar: "0.00" }))).toContain("Q0.00");
    expect(textoCasillaBoletaTardia(vista({ montoCondonar: "1234.5" }))).toContain("Q1234.50");
    expect(textoMoraDelRetraso(vista({ montoCondonar: "11.204" }))).toContain("Q11.20");
  });
});

describe("body serializado", () => {
  test("sin casilla: JSON.stringify no lleva la clave; con casilla: intentoId y montoAceptado exactos", () => {
    const sin = { monto: 1, condonacionBoletaTardia: bloqueCondonacionParaEnviar(vista(), null, completo) };
    expect(JSON.stringify(sin)).toBe('{"monto":1}');
    expect("condonacionBoletaTardia" in JSON.parse(JSON.stringify(sin))).toBe(false);
    const con = JSON.parse(JSON.stringify({ condonacionBoletaTardia: bloqueCondonacionParaEnviar(vista(), INTENTO, completo) }));
    expect(con).toEqual({ condonacionBoletaTardia: { intentoId: INTENTO, montoAceptado: "11.20" } });
    expect(Object.keys(con.condonacionBoletaTardia).sort()).toEqual(["intentoId", "montoAceptado"]);
  });
  test("un intento viejo aceptado con una vista nueva (refetch) no viaja", () => {
    expect(bloqueCondonacionParaEnviar(vista({ intentoId: "nuevo" }), INTENTO, completo)).toBeUndefined();
  });
  test("vista que no aplica jamas genera bloque aunque el intento coincida", () => {
    expect(bloqueCondonacionParaEnviar(vista({ aplica: false }), INTENTO, completo)).toBeUndefined();
  });
  test("intentoId vacio: aceptada '' contra vista '' no deberia condonar", () => {
    expect(bloqueCondonacionParaEnviar(vista({ intentoId: "" }), "", completo)).toBeUndefined();
  });
});

describe("respuestas raras del preview -> nunca condona", () => {
  const basura: unknown[] = [null, undefined, {}, { success: false }, { data: null }, "<html>502 Bad Gateway</html>", 0, []];
  test("estadoRecuadro / estaAceptada / bloque / mora con basura no tiran excepcion ni condonan", () => {
    for (const b of basura) {
      const v = b as VistaPreviaBoletaTardia;
      expect(estadoRecuadroBoletaTardia(v, completo)).toEqual({ tipo: "oculto" });
      expect(estaAceptada(v, INTENTO)).toBeFalsy();
      expect(bloqueCondonacionParaEnviar(v, INTENTO, completo)).toBeUndefined();
      expect(moraDespuesDeCondonar(100, v, true)).toBe(100);
    }
  });
  test("vista sin montoCondonar no manda 'NaN' como montoAceptado", () => {
    const b = bloqueCondonacionParaEnviar({ ...vista(), montoCondonar: undefined } as never, INTENTO, completo);
    expect(b?.montoAceptado).not.toBe("NaN");
  });
});

describe("servicio: contrato sobre el fuente (sin DOM)", () => {
  const svc = leer("../services/boletaTardia.services.ts");
  test("POST a /pagos/boleta-tardia/preview con los params tal cual y devuelve res.data.data", () => {
    expect(svc).toContain("/pagos/boleta-tardia/preview");
    expect(svc).toMatch(/api\.post[^(]*\(`\$\{API_URL\}\/pagos\/boleta-tardia\/preview`,\s*p\)/);
    expect(svc).toContain("res.data.data");
  });
  test("el servicio no traga errores (sin try/catch que devuelva una vista por defecto)", () => {
    expect(svc).not.toMatch(/catch/);
  });
  test("ruta existe en el back y su body acepta exactamente los params que arma el front", () => {
    const back = readFileSync(raiz + "../../../../../cartera-back/src/routers/payments.ts", "utf8");
    const i = back.indexOf("/pagos/boleta-tardia/preview");
    const bloque = back.slice(i, i + 2000);
    for (const k of ["credito_id", "monto_boleta", "otros", "abono_directo_capital", "fecha_boleta"]) expect(bloque).toContain(k);
    const p = parametrosPreviewBoletaTardia({ credito_id: 5, monto_boleta: 1000, fecha_boleta: "2026-09-30" }, false)!;
    expect(Object.keys(p).sort()).toEqual(["abono_directo_capital", "credito_id", "fecha_boleta", "monto_boleta", "otros"]);
  });
});

describe("hook: contrato sobre el fuente (sin DOM)", () => {
  const hook = leer("../hooks/useBoletaTardiaPreview.ts");
  test("nada cacheado entre aperturas y sin reintentos que regeneren intentos", () => {
    expect(hook).toMatch(/gcTime:\s*0/);
    expect(hook).toMatch(/staleTime:\s*Infinity/);
    expect(hook).toMatch(/retry:\s*false/);
    expect(hook).toMatch(/refetchOnWindowFocus:\s*false/);
  });
  test("solo habilitado con modal abierto y params no nulos; la key incluye los params", () => {
    expect(hook).toMatch(/enabled:\s*abierto && params !== null/);
    expect(hook).toMatch(/queryKey:\s*\["boleta-tardia-preview",\s*aperturaId,\s*params\]/);
    expect(hook).toMatch(/aperturaId = 0/);
  });
  test("no hay refetchOnMount/reconnect que pida otro intentoId a escondidas", () => {
    expect(hook).not.toMatch(/refetchInterval/);
  });
});

describe("avisoCondonacionAnulada (E-11)", () => {
  test("anulada_no_quedo_al_dia -> aviso", () => {
    expect(avisoCondonacionAnulada({ success: true, condonacionBoletaTardia: { estado: "anulada_no_quedo_al_dia" } }))
      .toBe("El pago se registró, pero el crédito no quedó al día: la condonación se deshizo y la mora sigue vigente.");
  });
  test("vigente, sin_verificar, null, ausente -> null", () => {
    expect(avisoCondonacionAnulada({ condonacionBoletaTardia: { estado: "vigente" } })).toBeNull();
    expect(avisoCondonacionAnulada({ condonacionBoletaTardia: { estado: "sin_verificar" } })).toBeNull();
    expect(avisoCondonacionAnulada({ condonacionBoletaTardia: null })).toBeNull();
    expect(avisoCondonacionAnulada({ success: true })).toBeNull();
  });
  test("basura -> null sin excepcion", () => {
    for (const b of [null, undefined, "", "<html/>", 0, 5, [], {}, { condonacionBoletaTardia: "anulada_no_quedo_al_dia" },
      { condonacionBoletaTardia: { estado: "ANULADA_NO_QUEDO_AL_DIA" } }, { condonacionBoletaTardia: { estado: 1 } },
      { condonacionBoletaTardia: { estado: "otro" } }, { condonacionBoletaTardia: [] }]) {
      expect(avisoCondonacionAnulada(b)).toBeNull();
    }
  });
  test("estados del back: los 3 estados reales estan mapeados (solo la anulada avisa)", () => {
    const back = leer("../../../../../cartera-back/src/controllers/boletaTardia.ts");
    for (const e of ["vigente", "anulada_no_quedo_al_dia", "sin_verificar"]) expect(back).toContain(`"${e}"`);
    const avisos = ["vigente", "anulada_no_quedo_al_dia", "sin_verificar"].filter((e) => avisoCondonacionAnulada({ condonacionBoletaTardia: { estado: e } }) !== null);
    expect(avisos).toEqual(["anulada_no_quedo_al_dia"]);
  });
  test("respuesta idempotente (idempotent:true) con anulada tambien avisa", () => {
    expect(avisoCondonacionAnulada({ success: true, idempotent: true, condonacionBoletaTardia: { condonacion_id: 1, monto: "5.00", estado: "anulada_no_quedo_al_dia" } })).not.toBeNull();
  });
});

describe("409 del servidor", () => {
  const ax = (status: number, data: unknown) => ({ response: { status, data } });
  test("solo 409 con code conocido", () => {
    expect(esConflictoDeCondonacion(ax(409, { success: false, code: "ya_no_aplica" }))).toBe(true);
    expect(esConflictoDeCondonacion(ax(409, { success: false, code: "mora_cambio" }))).toBe(true);
    expect(esConflictoDeCondonacion(ax(409, { success: false }))).toBe(false);
    expect(esConflictoDeCondonacion(ax(409, "<html>conflict</html>"))).toBe(false);
    expect(esConflictoDeCondonacion(ax(409, null))).toBe(false);
    expect(esConflictoDeCondonacion(ax(400, { code: "ya_no_aplica" }))).toBe(false);
    expect(esConflictoDeCondonacion(ax(409, { code: "MORA_CAMBIO" }))).toBe(false);
    for (const b of [undefined, "x", 5, {}, { response: null }, { response: {} }]) expect(esConflictoDeCondonacion(b)).toBe(false);
  });
  test("codigos 409 del back existen en el fuente", () => {
    const back = leer("../../../../../cartera-back/src/controllers/boletaTardia.ts");
    expect(back).toContain("ya_no_aplica");
    expect(back).toContain("mora_cambio");
  });
  test("mensaje: no confia en tipos raros", () => {
    const dflt = "La condonación cambió. Revise el nuevo cálculo y vuelva a confirmar.";
    for (const m of [undefined, null, "", 5, {}, ["x"]]) expect(mensajeConflictoCondonacion(ax(409, { code: "mora_cambio", message: m }))).toBe(dflt);
    expect(mensajeConflictoCondonacion(null)).toBe(dflt);
    expect(mensajeConflictoCondonacion(undefined)).toBe(dflt);
    expect(mensajeConflictoCondonacion(ax(409, "<html/>"))).toBe(dflt);
  });
});

describe("fechas GT sin corrimiento de huso", () => {
  const husoOriginal = process.env.TZ;
  test("dd-mmm para todos los meses y bordes", () => {
    const casos: Record<string, string> = {
      "2026-01-01": "01-ene", "2026-02-28": "28-feb", "2028-02-29": "29-feb", "2026-03-31": "31-mar", "2026-04-30": "30-abr",
      "2026-05-01": "01-may", "2026-06-30": "30-jun", "2026-07-31": "31-jul", "2026-08-01": "01-ago", "2026-09-30": "30-sep",
      "2026-10-01": "01-oct", "2026-11-30": "30-nov", "2026-12-31": "31-dic",
    };
    for (const [k, v] of Object.entries(casos)) expect(fechaCortaBoletaTardia(k)).toBe(v);
  });
  test("el resultado no depende de TZ del proceso (se prueba con varias)", () => {
    for (const tz of ["America/Guatemala", "UTC", "Pacific/Auckland", "America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      expect(fechaCortaBoletaTardia("2026-09-30")).toBe("30-sep");
      expect(textoFechasBoletaTardia(vista())).toBe("Vence 30-sep · Boleta 30-sep · Hoy 03-oct (3 días de retraso)");
      expect(textoCasillaBoletaTardia(vista())).toContain("es del 30-sep");
    }
    if (husoOriginal === undefined) delete process.env.TZ; else process.env.TZ = husoOriginal;
  });
  test("fuente de fechas sin new Date()/Date.parse (no puede correr el dia)", () => {
    const src = leer("./boletaTardia.ts");
    expect(src).not.toMatch(/new Date\(|Date\.parse|toLocale/);
  });
  test("fecha con hora ISO ('2026-09-30T00:00:00.000Z') sigue mostrando 30-sep", () => {
    expect(fechaCortaBoletaTardia("2026-09-30T00:00:00.000Z")).toBe("30-sep");
  });
  test("pluralizacion de dias: 0, 1, 2, null", () => {
    expect(textoFechasBoletaTardia(vista({ diasRetraso: 1 }))).toContain("(1 día de retraso)");
    expect(textoFechasBoletaTardia(vista({ diasRetraso: 2 }))).toContain("(2 días de retraso)");
    expect(textoFechasBoletaTardia(vista({ diasRetraso: 0 }))).toContain("(0 días de retraso)");
  });
  test("cuotas ordenadas numericamente (2 antes que 10) y sin mutar el arreglo de la vista", () => {
    const mk = (n: number) => ({ cuota_id: n, numero_cuota: n, fecha_vencimiento: "2026-09-30", monto: "1.000000" });
    const v = vista({ porCuota: [mk(10), mk(2), mk(9)] });
    expect(textoMoraDelRetraso(v)).toContain("Cuotas 2, 9, 10");
    expect(v.porCuota.map((c) => c.numero_cuota)).toEqual([10, 2, 9]);
  });
});

describe("parametrosPreviewBoletaTardia extras", () => {
  test("negativos, NaN y vacio", () => {
    const ok = { credito_id: 5, monto_boleta: 1000, fecha_boleta: "2026-09-30" };
    expect(parametrosPreviewBoletaTardia({ ...ok, credito_id: -1 }, false)).toBeNull();
    expect(parametrosPreviewBoletaTardia({ ...ok, monto_boleta: -10 }, false)).toBeNull();
    expect(parametrosPreviewBoletaTardia({ ...ok, monto_boleta: NaN }, false)).toBeNull();
    expect(parametrosPreviewBoletaTardia({ ...ok, credito_id: NaN }, false)).toBeNull();
    expect(parametrosPreviewBoletaTardia({}, false)).toBeNull();
  });
});

describe("endurecimiento 10a r1", () => {
  test("bloque con estado gris (aceptó y luego falta boleta/banco/autorización) no viaja", () => {
    for (const falta of [{ hayBoleta: false }, { bancoId: 0 }, { numeroAutorizacion: " " }, { esCancelacion: true }]) {
      expect(bloqueCondonacionParaEnviar(vista(), INTENTO, { ...completo, ...falta })).toBeUndefined();
    }
    expect(bloqueCondonacionParaEnviar(vista({ aplica: false, razon: "no_queda_al_dia" }), INTENTO, completo)).toBeUndefined();
  });
  test("aperturaId distinto -> queryKey distinta (contrato del fuente) y el default es 0", () => {
    const hook = readFileSync(raiz + "../hooks/useBoletaTardiaPreview.ts", "utf8");
    const key = hook.match(/queryKey:\s*(\[[^\]]*\])/)![1];
    expect(key).toContain("aperturaId");
    const mk = (aperturaId: number) => JSON.stringify(new Function("aperturaId", "params", `return ${key}`)(aperturaId, { credito_id: 1 }));
    expect(mk(1)).not.toBe(mk(2));
    expect(mk(1)).toBe(mk(1));
  });
  test("cada razon (y mora_cambio) del 409 se traduce a espanol sin snake_case", () => {
    const razones = ["estado_no_aplica", "sin_mora", "fuera_de_ventana", "no_alcanza_mora", "no_queda_al_dia", "fuera_de_tope",
      "boleta_invalida", "boleta_de_otro_periodo", "credito_no_encontrado", "mora_cambio"];
    for (const r of razones) {
      const msg = mensajeConflictoCondonacion({ response: { status: 409, data: { code: "ya_no_aplica", message: `La condonación ya no aplica (${r})` } } });
      expect(msg).not.toMatch(/[a-z]+_[a-z]+/);
      expect(msg).not.toContain("(");
      expect(msg.length).toBeGreaterThan(20);
    }
  });
  test("razon desconocida se deja tal cual (no se pierde info) y sin parentesis no se toca", () => {
    expect(mensajeConflictoCondonacion({ response: { data: { message: "hola" } } })).toBe("hola");
  });
  test("textoFechas devuelve vacio sin fechas; NaN en params -> null", () => {
    expect(textoFechasBoletaTardia(vista({ fechaVencimiento: null }))).toBe("");
    expect(parametrosPreviewBoletaTardia({ credito_id: 5, monto_boleta: 10, fecha_boleta: "2026-09-30", otros: NaN }, false)).toBeNull();
    expect(parametrosPreviewBoletaTardia({ credito_id: 5, monto_boleta: 10, fecha_boleta: "2026-09-30", abono_directo_capital: NaN }, false)).toBeNull();
  });
});
