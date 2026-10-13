// Pruebas exhaustivas 10.b (caja negra desde brief/spec §3/enmiendas E-11). Sin DOM: la cascada del modal se EJECUTA
// extrayéndola del fuente de PagoForm (no se copia), el body se ejecuta desde el fuente del hook, el componente se
// invoca como función y el cableado se fija con contratos acotados por región y en positivo.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BoletaTardiaRecuadro } from "./BoletaTardiaRecuadro";
import {
  avisoCondonacionAnulada,
  bloqueCondonacionParaEnviar,
  estadoRecuadroBoletaTardia,
  moraDespuesDeCondonar,
  moraEfectivaParaCobrar,
  moraAntesDeCondonar,
  parametrosPreviewBoletaTardia,
  type EntornoRecuadro,
  type VistaPreviaBoletaTardia,
} from "./boletaTardia";
import { escalonesQueConsumenLaBoleta, loQueElAbonoACapitalNoAplica } from "./escalonesQueConsumenLaBoleta";
import { montoParaAbonoDirectoACapital } from "./abonoDirectoACapital";

const form = readFileSync(new URL("./PagoForm.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../hooks/registerPayment.ts", import.meta.url), "utf8");
const previewHook = readFileSync(new URL("../hooks/useBoletaTardiaPreview.ts", import.meta.url), "utf8");

function region(src: string, desde: string, hasta: string | null, que: string) {
  const i = src.indexOf(desde);
  if (i < 0) throw new Error(`Ancla inicial de "${que}" no encontrada: ${desde}`);
  const j = hasta ? src.indexOf(hasta, i + desde.length) : src.length;
  if (j < 0) throw new Error(`Ancla final de "${que}" no encontrada: ${hasta}`);
  return src.slice(i, j);
}
const cuenta = (src: string, aguja: string) => src.split(aguja).length - 1;

const r2 = (n: number) => Math.round(n * 100) / 100;
// ───────────────────────── vistas y entornos ─────────────────────────
const vista = (o: Partial<VistaPreviaBoletaTardia> = {}): VistaPreviaBoletaTardia => ({
  aplica: true, razon: null, fechaVencimiento: "2026-10-05", fechaBoleta: "2026-10-05", fechaRegistro: "2026-10-08",
  diasRetraso: 3, montoCondonar: "45.00", moraACobrar: "35.00",
  porCuota: [{ cuota_id: 7, numero_cuota: 7, fecha_vencimiento: "2026-10-05", monto: "45.00" }],
  intentoId: "11111111-1111-4111-8111-111111111111", ...o,
});
// Vista coherente con la mora local del caso: el servidor condona 45 y cobra el resto (moraACobrar).
const vistaPara = (mora: number) => vista({ montoCondonar: "45.00", moraACobrar: Math.max(0, r2(mora - 45)).toFixed(2) });
const entorno = (o: Partial<EntornoRecuadro> = {}): EntornoRecuadro => ({ esCancelacion: false, numeroAutorizacion: "A1", bancoId: 3, hayBoleta: true, ...o });

// ───────────────────────── la cascada REAL de PagoForm, ejecutada ─────────────────────────
const ancla = region(form, "/* MODAL DE CONFIRMACION PARA PAGO NORMAL */", null, "pago normal");
const cascadaSrc = region(ancla, "const montoBoleta = Number(formik.values.monto_boleta) || 0;", "return (\n          <div className=\"bg-gradient-to-br from-green-50", "cascada");
const NOMBRES = ["formik", "mora", "vistaBoletaTardia", "aceptada", "rubrosActual", "convenioActivoInfo", "dataCredito",
  "displayedPartialContribution", "cuotaSeleccionada", "moraEfectivaParaCobrar", "moraAntesDeCondonar", "escalonesQueConsumenLaBoleta",
  "loQueElAbonoACapitalNoAplica", "montoParaAbonoDirectoACapital"];
const SALIDA = "{ distribucion, montoRestante, montoOtrosAplicado, montoMoraAplicado, montoRubrosAplicado, montoConvenioAplicado, montoCuotaAplicado, cuotaNormal, cuotaQuedaCorta, textoCausas, moraMonto }";
function compilar(cuerpo: string) {
  const js = new (globalThis as any).Bun.Transpiler({ loader: "ts" }).transformSync(`function f(${NOMBRES.join(",")}){\n${cuerpo}\nreturn ${SALIDA};}\nf;`);
  return (0, eval)(`(()=>{${js.replace(/^f;?\s*$/m, "")}\n return f;})()`) as (...a: unknown[]) => Cascada;
}
type Cascada = {
  distribucion: { concepto: string; monto: number; tachado?: number }[]; montoRestante: number; montoOtrosAplicado: number;
  montoMoraAplicado: number; montoRubrosAplicado: number; montoConvenioAplicado: number; montoCuotaAplicado: number;
  cuotaNormal: number; cuotaQuedaCorta: boolean; textoCausas: string; moraMonto: number;
};
function reemplazar(src: string, de: string, a: string) {
  if (!src.includes(de)) throw new Error(`No existe en la cascada: ${de}`);
  return src.replace(de, a);
}
const cascada = compilar(cascadaSrc);
// La lógica PREVIA al cambio (git b902bd280): sin moraDespuesDeCondonar, sin tachado.
const previaSrc = reemplazar(reemplazar(reemplazar(reemplazar(cascadaSrc,
  "const moraMonto = moraEfectivaParaCobrar(mora || 0, vistaBoletaTardia, aceptada);", "const moraMonto = mora || 0;"),
  "if (moraMonto > 0 || aceptada) {", "if (moraMonto > 0) {"),
  'concepto: aceptada ? "2. Mora (sin la del retraso)" : "2. Mora",', 'concepto: "2. Mora",'),
  "tachado: aceptada ? moraAntesDeCondonar(mora || 0, vistaBoletaTardia, aceptada) : undefined,", "");
const cascadaPrevia = compilar(previaSrc);

type Caso = { boleta: number; otros: number; mora: number; rubros: number; cuota: number; abonos?: number; convenio?: number; abonoCapital?: number; saldo?: number };
function correr(fn: ReturnType<typeof compilar>, c: Caso, v: VistaPreviaBoletaTardia | undefined, aceptada: boolean) {
  return fn(
    { values: { monto_boleta: c.boleta, otros: c.otros, abono_directo_capital: c.abonoCapital ?? 0 } },
    c.mora, v, aceptada, c.rubros, { cuotaConvenioAPagar: c.convenio ?? 0 },
    { cuotaMensualAPagar: c.cuota, usuario: { saldo_a_favor: c.saldo ?? 0 } },
    c.abonos ?? 0, 7, moraEfectivaParaCobrar, moraAntesDeCondonar, escalonesQueConsumenLaBoleta, loQueElAbonoACapitalNoAplica, montoParaAbonoDirectoACapital,
  );
}

function grilla(): Caso[] {
  const out: Caso[] = [];
  for (const boleta of [0, 30, 50, 100, 335, 480, 500, 1000])
    for (const otros of [0, 20])
      for (const mora of [0, 45, 80, 300])
        for (const rubros of [0, 60])
          for (const cuota of [0, 200, 400])
            for (const convenio of [0, 100])
              for (const abonoCapital of [0, 300]) out.push({ boleta, otros, mora, rubros, cuota, convenio, abonoCapital });
  return out;
}

describe("cascada: extracción de la región real", () => {
  test("las anclas existen y la cascada compilada corre (si esto explota, el fuente cambió de forma)", () => {
    const s = correr(cascada, { boleta: 500, otros: 0, mora: 80, rubros: 0, cuota: 400 }, vista(), false);
    expect(s.distribucion.map((d) => d.concepto)).toEqual(["2. Mora", "5. Cuota #7"]);
  });
});

describe("sin casilla: cálculo IDÉNTICO al de antes del cambio (960 combinaciones)", () => {
  test("distribución, restante, aplicados, aviso de cobro corto y causas coinciden exactamente con la lógica previa", () => {
    for (const c of grilla()) {
      for (const v of [undefined, vista(), vista({ aplica: false, razon: "no_queda_al_dia" })]) {
        const nuevo = correr(cascada, c, v, false);
        const previo = correr(cascadaPrevia, c, v, false);
        expect({ ...nuevo, distribucion: nuevo.distribucion.map((d) => ({ concepto: d.concepto, monto: d.monto })) })
          .toEqual({ ...previo, distribucion: previo.distribucion.map((d) => ({ concepto: d.concepto, monto: d.monto })) });
        // sin casilla jamás hay renglón tachado ni rótulo de condonación
        for (const d of nuevo.distribucion) {
          expect(d.tachado).toBeUndefined();
          expect(d.concepto).not.toContain("sin la del retraso");
        }
      }
    }
  });
  test("con vista que aplica pero SIN marcar la mora es la completa (no se condona por tener la vista)", () => {
    const s = correr(cascada, { boleta: 500, otros: 0, mora: 80, rubros: 0, cuota: 400 }, vista(), false);
    expect(s.montoMoraAplicado).toBe(80);
    expect(s.montoCuotaAplicado).toBe(400);
    expect(s.montoRestante).toBe(20);
  });
});

describe("con casilla: la mora mostrada = mora − condonado, la cuota se completa", () => {
  test("oráculo independiente sobre toda la grilla", () => {
    for (const c of grilla()) {
      const v = vistaPara(c.mora); // el servidor condona 45; moraACobrar = lo que queda
      const s = correr(cascada, c, v, true);
      let resto = Math.max(0, c.boleta - c.abonoCapital!);
      const otrosAp = Math.min(resto, c.otros); resto -= otrosAp;
      const moraBase = Math.max(0, r2(c.mora - 45));
      const moraAp = Math.min(resto, moraBase); resto -= moraAp;
      const rubrosAp = Math.min(resto, c.rubros); resto -= rubrosAp;
      const cuotaAp = c.cuota > 0 && resto > 0 ? Math.min(resto, c.cuota) : 0; resto -= cuotaAp;
      expect(s.montoOtrosAplicado).toBeCloseTo(otrosAp, 9);
      expect(s.montoMoraAplicado).toBeCloseTo(moraAp, 9);
      expect(s.montoRubrosAplicado).toBeCloseTo(rubrosAp, 9);
      expect(s.montoCuotaAplicado).toBeCloseTo(cuotaAp, 9);
      expect(s.montoRestante).toBeCloseTo(resto, 9);
      expect(s.moraMonto).toBe(moraBase);
      // la línea de mora existe siempre con casilla (aunque quede en 0) y trae la mora completa tachada
      const linea = s.distribucion.find((d) => d.concepto.startsWith("2. Mora"));
      expect(linea?.concepto).toBe("2. Mora (sin la del retraso)");
      expect(linea?.tachado).toBe(r2(Number(v.moraACobrar) + 45));
      expect(linea?.monto).toBeCloseTo(moraAp, 9);
      // nunca se muestra más mora que la que tenía el crédito
      expect(s.montoMoraAplicado).toBeLessThanOrEqual(c.mora + 1e-9);
      // la cuota con casilla jamás recibe menos que sin casilla (la boleta que se liberó va a la cuota/excedente)
      const sin = correr(cascada, c, v, false);
      if (c.mora >= 45) expect(s.montoCuotaAplicado).toBeGreaterThanOrEqual(sin.montoCuotaAplicado - 1e-9);
      if (c.mora >= 45) expect(s.montoRestante).toBeGreaterThanOrEqual(sin.montoRestante - 1e-9);
    }
  });
  test("conservación: otros + mora + rubros + cuota + restante = boleta − abono directo (con y sin casilla)", () => {
    for (const c of grilla()) for (const acep of [false, true]) {
      const s = correr(cascada, c, vista(), acep);
      const disp = Math.max(0, c.boleta - c.abonoCapital!);
      expect(s.montoOtrosAplicado + s.montoMoraAplicado + s.montoRubrosAplicado + s.montoCuotaAplicado + s.montoRestante).toBeCloseTo(disp, 6);
      expect(s.montoRestante).toBeGreaterThanOrEqual(0);
    }
  });
  test("ejemplo del reporte: mora 80, condona 45, boleta 500, cuota 400 → mora 35 tachada 80, cuota 400, excedente 65", () => {
    const s = correr(cascada, { boleta: 500, otros: 0, mora: 80, rubros: 0, cuota: 400 }, vista(), true);
    expect(s.distribucion).toEqual([
      { concepto: "2. Mora (sin la del retraso)", monto: 35, tachado: 80 },
      { concepto: "5. Cuota #7", monto: 400 },
    ]);
    expect(s.montoRestante).toBe(65);
  });
  test("la cuota se COMPLETA: boleta 435 / mora 80 / cuota 400 → sin casilla la cuota queda en 355; con casilla en 400", () => {
    const c = { boleta: 435, otros: 0, mora: 80, rubros: 0, cuota: 400 };
    expect(correr(cascada, c, vista(), false).montoCuotaAplicado).toBe(355);
    const s = correr(cascada, c, vista(), true);
    expect(s.montoCuotaAplicado).toBe(400);
    expect(s.montoRestante).toBe(0);
  });
  test("moraACobrar del servidor en 0: la mora queda en 0, nunca negativa, el renglón se ve con Q0.00 y se tacha moraACobrar+condonado", () => {
    const s = correr(cascada, { boleta: 500, otros: 0, mora: 30, rubros: 0, cuota: 400 }, vista({ moraACobrar: "0.00" }), true);
    expect(s.moraMonto).toBe(0);
    expect(s.distribucion[0]).toEqual({ concepto: "2. Mora (sin la del retraso)", monto: 0, tachado: 45 });
  });
  test("la mora efectiva sale del servidor (moraACobrar), no de la local: mora local desfasada no cambia lo mostrado", () => {
    const s = correr(cascada, { boleta: 500, otros: 0, mora: 999, rubros: 0, cuota: 400 }, vista(), true);
    expect(s.moraMonto).toBe(35);
    expect(s.distribucion[0].tachado).toBe(80);
  });
  test("moraACobrar inválido con casilla marcada: la mora local queda intacta (nunca sube ni da NaN)", () => {
    for (const mc of ["abc", "-5.00", "NaN"]) {
      const s = correr(cascada, { boleta: 500, otros: 0, mora: 80, rubros: 0, cuota: 400 }, vista({ moraACobrar: mc }), true);
      expect(s.moraMonto).toBe(80);
      expect(Number.isNaN(s.montoRestante)).toBe(false);
    }
  });
});

describe("avisos: cobro corto y excedente siguen saliendo cuando corresponde", () => {
  test("cobro corto con casilla: el oráculo (algo antes que la cuota consumió y la cuota quedó corta) sobre toda la grilla", () => {
    for (const c of grilla()) for (const acep of [false, true]) {
      const s = correr(cascada, c, vista(), acep);
      const consumio = [s.montoOtrosAplicado, s.montoMoraAplicado, s.montoRubrosAplicado].some((m) => m > 0.005);
      const esperado = consumio && s.cuotaNormal > 0 && s.montoCuotaAplicado < s.cuotaNormal - 0.005;
      expect(s.cuotaQuedaCorta).toBe(esperado);
    }
  });
  test("cobro corto sigue saliendo con casilla cuando la mora que queda se come la boleta", () => {
    // boleta 300, mora 300 condona 45 → mora 255, cuota 400 → 45 para la cuota, corta
    const s = correr(cascada, { boleta: 300, otros: 0, mora: 300, rubros: 0, cuota: 400 }, vistaPara(300), true);
    expect(s.montoMoraAplicado).toBe(255);
    expect(s.montoCuotaAplicado).toBe(45);
    expect(s.cuotaQuedaCorta).toBe(true);
    expect(s.textoCausas).toBe("Q255.00 a mora");
  });
  test("cobro corto desaparece con casilla cuando la condonación libera la plata para completar la cuota", () => {
    const c = { boleta: 435, otros: 0, mora: 80, rubros: 0, cuota: 400 };
    expect(correr(cascada, c, vista(), false).cuotaQuedaCorta).toBe(true);
    expect(correr(cascada, c, vista(), true).cuotaQuedaCorta).toBe(false);
  });
  test("el excedente (restante > 0.01) aparece con casilla cuando la condonación libera más de lo que la cuota absorbe", () => {
    const c = { boleta: 480, otros: 0, mora: 80, rubros: 0, cuota: 400 };
    expect(correr(cascada, c, vista(), false).montoRestante).toBe(0);
    expect(correr(cascada, c, vista(), true).montoRestante).toBe(45);
  });
  test("el pie '- Mora:' usa lo aplicado (ya sin lo condonado) y 0 lo oculta", () => {
    const s = correr(cascada, { boleta: 500, otros: 0, mora: 45, rubros: 0, cuota: 400 }, vistaPara(45), true);
    expect(s.montoMoraAplicado).toBe(0);
  });
  test("decimales: 80.10 − 45.05 = 35.05 sin cola de flotante", () => {
    expect(moraDespuesDeCondonar(80.1, vista({ montoCondonar: "45.05" }), true)).toBe(35.05);
    expect(moraDespuesDeCondonar(0.3, vista({ montoCondonar: "0.10" }), true)).toBe(0.2);
    expect(moraDespuesDeCondonar(80, vista({ montoCondonar: "45.00", aplica: false }), true)).toBe(80);
    expect(moraDespuesDeCondonar(80, undefined, true)).toBe(80);
  });
});

// ───────────────────────── el body de createPago ─────────────────────────
const envioSrc = region(hook, "const valuesToSend = {", "};", "valuesToSend") + "};";
function armarBody(src: string, values: Record<string, unknown>, bloque: unknown, ref?: { current: unknown }) {
  const js = new (globalThis as any).Bun.Transpiler({ loader: "ts" }).transformSync(`function g(values, cuotaSeleccionada, url_boletas, vistaCondonacion){ ${src}\n return valuesToSend; }`);
  const g = (0, eval)(`(()=>{${js}\n return g;})()`) as (...a: unknown[]) => Record<string, unknown>;
  return g(values, 7, ["a.png"], ref ?? { current: { bloque } });
}
// Body previo (b902bd280): { ...values, cuotaApagar, url_boletas }
const bodyPrevio = (values: Record<string, unknown>) => ({ ...values, cuotaApagar: 7, url_boletas: ["a.png"] });
const values = { credito_id: 9, monto_boleta: 500, otros: 0, abono_directo_capital: 0, fecha_boleta: "2026-10-05", numeroAutorizacion: "A1", banco_id: 3, registerBy: "x@y.z", origen_pago: "boleta", cuotaApagar: 0, url_boletas: [] };

describe("body de createPago", () => {
  test("sin casilla: no existe la clave y el body es idéntico (clave por clave, orden y JSON) al de antes", () => {
    const body = armarBody(envioSrc, values, undefined);
    expect(Object.keys(body)).not.toContain("condonacionBoletaTardia");
    expect("condonacionBoletaTardia" in body).toBe(false);
    expect(Object.keys(body)).toEqual(Object.keys(bodyPrevio(values)));
    expect(JSON.stringify(body)).toBe(JSON.stringify(bodyPrevio(values)));
  });
  test("tras la aceptación + desmarcado el bloque es undefined y el body vuelve a ser el de antes", () => {
    const aceptada = bloqueCondonacionParaEnviar(vista(), vista().intentoId, entorno());
    expect(armarBody(envioSrc, values, aceptada)).toHaveProperty("condonacionBoletaTardia");
    const desmarcada = bloqueCondonacionParaEnviar(vista(), null, entorno());
    expect(JSON.stringify(armarBody(envioSrc, values, desmarcada))).toBe(JSON.stringify(bodyPrevio(values)));
  });
  test("con casilla: exactamente { intentoId, montoAceptado } de la vista vigente, y el resto del body no cambia", () => {
    const v = vista({ intentoId: "22222222-2222-4222-8222-222222222222", montoCondonar: "45" });
    const bloque = bloqueCondonacionParaEnviar(v, v.intentoId, entorno());
    const body = armarBody(envioSrc, values, bloque);
    expect(Object.keys(body.condonacionBoletaTardia as object).sort()).toEqual(["intentoId", "montoAceptado"]);
    expect(body.condonacionBoletaTardia).toEqual({ intentoId: v.intentoId, montoAceptado: "45.00" });
    const { condonacionBoletaTardia: _, ...resto } = body;
    expect(JSON.stringify(resto)).toBe(JSON.stringify(bodyPrevio(values)));
  });
  test("una casilla de la vista ANTERIOR (otro intentoId) no viaja", () => {
    const vieja = vista({ intentoId: "33333333-3333-4333-8333-333333333333" });
    const nueva = vista();
    expect(bloqueCondonacionParaEnviar(nueva, vieja.intentoId, entorno())).toBeUndefined();
  });
  test("el esquema del front (fragmento real del hook) acepta el bloque válido y rechaza uuid / monto mal formados", async () => {
    // registerPayment.ts importa con alias "@/" que bun no resuelve: se evalúa el fragmento zod del propio fuente.
    const frag = region(hook, "condonacionBoletaTardia: z.object({", ".optional(),", "esquema").replace("condonacionBoletaTardia:", "").trim() + ".optional()";
    const { z } = await import("zod");
    const esquema = new Function("z", `return ${frag};`)(z) as import("zod").ZodTypeAny;
    const ok = (b: unknown) => esquema.safeParse(b).success;
    expect(ok(undefined)).toBe(true); // opcional: sin casilla el body valida igual que antes
    expect(ok({ intentoId: vista().intentoId, montoAceptado: "45.00" })).toBe(true);
    expect(ok({ intentoId: "no-uuid", montoAceptado: "45.00" })).toBe(false);
    expect(ok({ intentoId: vista().intentoId, montoAceptado: "45" })).toBe(false);
    expect(ok({ intentoId: vista().intentoId, montoAceptado: "45.5" })).toBe(false);
    expect(ok({ intentoId: vista().intentoId, montoAceptado: "-1.00" })).toBe(false);
    expect(ok({ intentoId: vista().intentoId })).toBe(false);
    // el bloque que arma la lógica pura SIEMPRE pasa el esquema
    for (const m of ["45", "45.00", "0.01", "12345.6", "9999999.99", "100"]) {
      const v = vista({ montoCondonar: m });
      expect(ok(bloqueCondonacionParaEnviar(v, v.intentoId, entorno()))).toBe(true);
    }
  });
});

// ───────────────────────── aperturaId, casilla, cancelación, doble clic ─────────────────────────
describe("aperturaId", () => {
  test("va en la queryKey y la consulta solo corre con el modal abierto", () => {
    expect(previewHook).toContain('queryKey: ["boleta-tardia-preview", aperturaId, params]');
    expect(previewHook).toContain("enabled: abierto && params !== null");
    expect(form).toContain("useBoletaTardiaPreview(paramsPreviewBoletaTardia, modalConfirmacionOpen, aperturaId)");
  });
  test("sube en cada apertura y en el 409 con actualización funcional (nunca se pisa con un valor fijo)", () => {
    const abrir = region(form, "const handleAbrirConfirmacion = async", "const handleConfirmarPago", "abrir");
    const efecto409 = region(form, "if (formik.status?.conflictoCondonacion) {", "}, [formik.status]", "409");
    expect(abrir).toContain("setAperturaId((a) => a + 1);");
    expect(efecto409).toContain("setAperturaId((a) => a + 1);");
    expect(cuenta(form, "setAperturaId(")).toBe(2); // abrir + 409 (ningún otro lugar lo toca; el 3er uso es el useState)
    // el updater funcional da la secuencia estricta 1,2,3…
    let n = 0; const subir = (f: (a: number) => number) => { n = f(n); return n; };
    expect([subir((a) => a + 1), subir((a) => a + 1), subir((a) => a + 1)]).toEqual([1, 2, 3]);
  });
  test("la apertura sube ANTES de abrir el modal y solo tras validar el formulario (validación fallida no sube ni abre)", () => {
    const abrir = region(form, "const handleAbrirConfirmacion = async", "const handleConfirmarPago", "abrir");
    const iRet = abrir.indexOf("return;");
    const iSube = abrir.indexOf("setAperturaId((a) => a + 1);");
    const iAbre = abrir.indexOf("setModalConfirmacionOpen(true);");
    expect(iRet).toBeGreaterThan(-1);
    expect(iSube).toBeGreaterThan(iRet);
    expect(iAbre).toBeGreaterThan(iSube);
  });
});

describe("la casilla se limpia", () => {
  test("al abrir el modal", () => {
    const abrir = region(form, "const handleAbrirConfirmacion = async", "const handleConfirmarPago", "abrir");
    const iLimpia = abrir.indexOf("setAceptadaIntentoId(null);");
    expect(iLimpia).toBeGreaterThan(-1);
    expect(iLimpia).toBeLessThan(abrir.indexOf("setModalConfirmacionOpen(true);"));
  });
  test("al cerrar el Dialog sin confirmar (Esc / overlay / X)", () => {
    const dialog = region(form, "<Dialog\n  open={modalConfirmacionOpen}", "<DialogContent", "Dialog");
    expect(dialog).toContain("if (!abierto) setAceptadaIntentoId(null);");
    expect(dialog).toContain("setModalConfirmacionOpen(abierto);");
  });
  test("al cerrar con el botón Cancelar (la forma más común de cerrar sin confirmar)", () => {
    const cancelar = region(form, 'variant="outline"', "</Button>", "botón Cancelar");
    expect(cancelar).toContain("setAceptadaIntentoId(null)"); // ROJA si Cancelar cierra con setModalConfirmacionOpen(false) a secas
  });
  test("confirmar NO la limpia (el envío la necesita) y cierra el modal antes de enviar", () => {
    const confirmar = region(form, "const handleConfirmarPago = async", "// 🎯 Calcular datos", "confirmar");
    expect(confirmar).not.toContain("setAceptadaIntentoId");
    expect(confirmar).toContain("setModalConfirmacionOpen(false);");
    expect(confirmar).toContain("await handleFormSubmit(");
  });
  test("el 409 la desmarca y reabre el modal; limpia el status para no reabrir en bucle", () => {
    const efecto = region(form, "if (formik.status?.conflictoCondonacion) {", "}, [formik.status]", "409");
    expect(efecto).toContain("setAceptadaIntentoId(null);");
    expect(efecto).toContain("setModalConfirmacionOpen(true);");
    expect(efecto).toContain("formik.setStatus(undefined);");
  });
  test("'Abonar todo a Capital' dentro del modal no arrastra una condonación ya marcada", () => {
    const abonar = region(form, "onClick={() => {\n            setModalConfirmacionOpen(false);", "Abonar todo a Capital", "abonar");
    expect(abonar).toContain("setAceptadaIntentoId(null);");
    expect(abonar).toContain("handleAbonoCapitalDirecto();");
    // y el handler NUNCA envía el bloque: lo borra de la ref ANTES de formik.handleSubmit()
    const h = region(hook, "const handleAbonoCapitalDirecto = () => {", "const handleAbonoSiguienteCuota", "abono directo");
    expect(h.indexOf("fijarCondonacion(undefined, undefined, false);")).toBeGreaterThan(-1);
    expect(h.indexOf("fijarCondonacion(undefined, undefined, false);")).toBeLessThan(h.indexOf("formik.handleSubmit();"));
  });
  test("estaAceptada se invalida sola al cambiar la vista (otro intentoId)", () => {
    const a = vista(); const b = vista({ intentoId: "44444444-4444-4444-8444-444444444444" });
    expect(bloqueCondonacionParaEnviar(a, a.intentoId, entorno())).toBeDefined();
    expect(bloqueCondonacionParaEnviar(b, a.intentoId, entorno())).toBeUndefined();
  });
  test("aceptada pero luego el recuadro pasa a gris (falta autorización / banco / boleta): no viaja", () => {
    const a = vista();
    for (const e of [entorno({ numeroAutorizacion: "  " }), entorno({ bancoId: 0 }), entorno({ hayBoleta: false })])
      expect(bloqueCondonacionParaEnviar(a, a.intentoId, e)).toBeUndefined();
  });
  test("el hook empuja el bloque con TODAS las dependencias del entorno (si cambia el banco/boleta, se recalcula)", () => {
    const ef = region(form, "const bloque = bloqueCondonacionParaEnviar(", "// Un 409", "efecto del bloque");
    for (const dep of ["vistaBoletaTardia", "aceptadaIntentoId", "entornoRecuadro.esCancelacion", "entornoRecuadro.numeroAutorizacion", "entornoRecuadro.bancoId", "entornoRecuadro.hayBoleta"])
      expect(ef).toContain(dep);
  });
});

describe("el recuadro no se muestra en la cancelación de crédito", () => {
  const ramaCancelacion = region(form, "{creditoCanceladoInfo ? (", "/* MODAL DE CONFIRMACION PARA PAGO NORMAL */", "cancelación");
  test("fuente: el recuadro aparece UNA vez y solo en la rama de pago normal", () => {
    expect(cuenta(form, "<BoletaTardiaRecuadro")).toBe(1);
    expect(ramaCancelacion).not.toContain("BoletaTardiaRecuadro");
    expect(ancla).toContain("<BoletaTardiaRecuadro");
  });
  test("lógica: con esCancelacion no hay recuadro, ni consulta, ni bloque, sea cual sea la vista", () => {
    for (const v of [vista(), vista({ aplica: false, razon: "no_queda_al_dia" }), vista({ aplica: false, razon: "no_alcanza_mora" })]) {
      expect(estadoRecuadroBoletaTardia(v, entorno({ esCancelacion: true }))).toEqual({ tipo: "oculto" });
      expect(bloqueCondonacionParaEnviar(v, v.intentoId, entorno({ esCancelacion: true }))).toBeUndefined();
    }
    expect(parametrosPreviewBoletaTardia({ credito_id: 9, monto_boleta: 500, otros: 0, abono_directo_capital: 0, fecha_boleta: "2026-10-05" }, true)).toBeNull();
    expect(form).toContain("!!creditoCanceladoInfo,\n  );"); // el flag de cancelación llega a parametrosPreview
    expect(form).toContain("esCancelacion: !!creditoCanceladoInfo,");
  });
});

describe("componente BoletaTardiaRecuadro (se invoca como función, sin DOM)", () => {
  type Nodo = { type: unknown; props?: { children?: unknown; [k: string]: unknown } } | string | number | null | undefined | boolean | Nodo[];
  function buscar(n: Nodo, pred: (e: { type: unknown; props: Record<string, unknown> }) => boolean, acc: { type: unknown; props: Record<string, unknown> }[] = []) {
    if (Array.isArray(n)) n.forEach((x) => buscar(x, pred, acc));
    else if (n && typeof n === "object") {
      const e = n as { type: unknown; props: Record<string, unknown> };
      if (pred(e)) acc.push(e);
      buscar((e.props?.children ?? null) as Nodo, pred, acc);
    }
    return acc;
  }
  const textos = (n: Nodo): string => (Array.isArray(n) ? n.map(textos).join("") : n && typeof n === "object" ? textos((n.props?.children ?? null) as Nodo) : typeof n === "string" || typeof n === "number" ? String(n) : "");
  const casillas = (n: Nodo) => buscar(n, (e) => e.type === "input" && e.props.type === "checkbox");

  test("oculto → null", () => {
    expect(BoletaTardiaRecuadro({ estado: { tipo: "oculto" }, aceptada: false, onCambiarAceptada: () => {} })).toBeNull();
  });
  test("casilla → hay un checkbox con los textos de la lógica pura; marcarlo/desmarcarlo notifica true/false", () => {
    const v = vista();
    const llamadas: boolean[] = [];
    const el = BoletaTardiaRecuadro({ estado: { tipo: "casilla", vista: v }, aceptada: false, onCambiarAceptada: (x) => llamadas.push(x) }) as unknown as Nodo;
    const cs = casillas(el);
    expect(cs).toHaveLength(1);
    expect(cs[0].props.checked).toBe(false);
    (cs[0].props.onChange as (e: unknown) => void)({ target: { checked: true } });
    (cs[0].props.onChange as (e: unknown) => void)({ target: { checked: false } });
    expect(llamadas).toEqual([true, false]);
    const t = textos(el);
    expect(t).toContain("Boleta pagada a tiempo, registrada tarde");
    expect(t).toContain("Vence 05-oct · Boleta 05-oct · Hoy 08-oct (3 días de retraso)");
    expect(t).toContain("Mora generada por el retraso: Q45.00 · Cuota 7");
    expect(t).toContain("Acepto condonar Q45.00 (queda a mi nombre)");
  });
  test("casilla marcada se pinta checked", () => {
    const el = BoletaTardiaRecuadro({ estado: { tipo: "casilla", vista: vista() }, aceptada: true, onCambiarAceptada: () => {} }) as unknown as Nodo;
    expect(casillas(el)[0].props.checked).toBe(true);
  });
  test("gris → SIN casilla, con el motivo; sin fecha de vencimiento no hay línea de fechas", () => {
    const estado = estadoRecuadroBoletaTardia(vista({ aplica: false, razon: "no_queda_al_dia" }), entorno());
    expect(estado.tipo).toBe("gris");
    const el = BoletaTardiaRecuadro({ estado, aceptada: true, onCambiarAceptada: () => {} }) as unknown as Nodo;
    expect(casillas(el)).toHaveLength(0);
    expect(textos(el)).toContain("no deja el crédito al día");
    const sinFecha = BoletaTardiaRecuadro({ estado: { tipo: "gris", motivo: "m", vista: vista({ fechaVencimiento: null }) }, aceptada: false, onCambiarAceptada: () => {} }) as unknown as Nodo;
    expect(textos(sinFecha)).not.toContain("Vence");
  });
  test("faltan datos (autorización / banco / boleta) → gris con el motivo de datos, sin casilla", () => {
    for (const e of [entorno({ numeroAutorizacion: "" }), entorno({ bancoId: 0 }), entorno({ hayBoleta: false })]) {
      const estado = estadoRecuadroBoletaTardia(vista(), e);
      expect(estado.tipo).toBe("gris");
      expect(casillas(BoletaTardiaRecuadro({ estado, aceptada: false, onCambiarAceptada: () => {} }) as unknown as Nodo)).toHaveLength(0);
    }
  });
  test("razones que no son 'gris' (sin_mora, fuera_de_ventana, …) → oculto", () => {
    for (const razon of ["estado_no_aplica", "sin_mora", "fuera_de_ventana", "fuera_de_tope", "boleta_invalida", "boleta_de_otro_periodo", "credito_no_encontrado"] as const)
      expect(estadoRecuadroBoletaTardia(vista({ aplica: false, razon }), entorno())).toEqual({ tipo: "oculto" });
    expect(estadoRecuadroBoletaTardia(undefined, entorno())).toEqual({ tipo: "oculto" });
  });
});

// ───────────────────────── 409 y toast E-11 ─────────────────────────
describe("409 de condonación", () => {
  const catchSrc = region(hook, "} catch (error: any) {", "} finally {\n        setSubmitting(false);", "catch de onSubmit");
  test("avisa, deja el status para que PagoForm reabra y SALE (no cae al toast.error genérico)", () => {
    const conflicto = region(catchSrc, "if (esConflictoDeCondonacion(error)) {", "const backendMessage", "rama del conflicto");
    expect(conflicto).toContain("toast.warning(mensaje, { duration: 7000 });");
    expect(conflicto).toContain("setStatus({ success: false, conflictoCondonacion: true, error: mensaje });");
    expect(conflicto).toContain("return;");
    expect(conflicto).not.toContain("toast.error");
    expect(catchSrc.indexOf("toast.error(backendMessage)")).toBeGreaterThan(catchSrc.indexOf("return;"));
  });
  test("el catch SUELTA la condonación (ambas refs) antes de decidir; el reintento exige reconfirmar y PagoForm desmarca la casilla", () => {
    expect(catchSrc.indexOf("soltarCondonacion();")).toBeGreaterThan(-1);
    expect(catchSrc.indexOf("soltarCondonacion();")).toBeLessThan(catchSrc.indexOf("if (esConflictoDeCondonacion(error)) {"));
    const efecto409 = region(form, "if (formik.status?.conflictoCondonacion) {", "}, [formik.status]", "409");
    expect(efecto409).toContain("setAceptadaIntentoId(null);"); // aceptadaIntentoId=null → el efecto del bloque lo manda a undefined
  });
  test("solo los 409 con code mora_cambio / ya_no_aplica son conflicto de condonación", async () => {
    const { esConflictoDeCondonacion } = await import("./boletaTardia");
    const e = (status: number, code?: string) => ({ response: { status, data: { code } } });
    expect(esConflictoDeCondonacion(e(409, "mora_cambio"))).toBe(true);
    expect(esConflictoDeCondonacion(e(409, "ya_no_aplica"))).toBe(true);
    for (const x of [e(409, "otro"), e(409), e(400, "mora_cambio"), e(500, "ya_no_aplica"), e(422, "mora_cambio"), null, undefined, {}, new Error("x"), "409"])
      expect(esConflictoDeCondonacion(x)).toBe(false);
  });
  test("el éxito limpia el bloque del hook tras resetForm", () => {
    const ok = region(hook, "setStatus({ success: true });", "setDataCredito(null);", "éxito");
    expect(ok).toContain("resetForm();");
    expect(ok).toContain("fijarCondonacion(undefined, undefined, false);");
  });
});

describe("toast E-11 (anulada_no_quedo_al_dia)", () => {
  test("se dispara solo con estado 'anulada_no_quedo_al_dia'", () => {
    const base = { success: true, message: "ok" };
    expect(avisoCondonacionAnulada({ ...base, condonacionBoletaTardia: { estado: "anulada_no_quedo_al_dia", monto: "45.00" } })).toBeString();
    expect(avisoCondonacionAnulada({ condonacionBoletaTardia: { estado: "anulada_no_quedo_al_dia" } })).toContain("la condonación se deshizo");
    for (const r of [
      { ...base, condonacionBoletaTardia: { estado: "vigente" } },
      { ...base, condonacionBoletaTardia: { estado: "ANULADA_NO_QUEDO_AL_DIA" } },
      { ...base, condonacionBoletaTardia: { estado: "anulada" } },
      { ...base, condonacionBoletaTardia: { estado: "" } },
      { ...base, condonacionBoletaTardia: { estado: null } },
      { ...base, condonacionBoletaTardia: {} },
      { ...base, condonacionBoletaTardia: null },
      { ...base, condonacionBoletaTardia: "anulada_no_quedo_al_dia" },
      base, {}, null, undefined, "anulada_no_quedo_al_dia", 0, [],
      { estado: "anulada_no_quedo_al_dia" }, // estado fuera de condonacionBoletaTardia
      { data: { condonacionBoletaTardia: { estado: "anulada_no_quedo_al_dia" } } }, // anidado: el hook pasa res.data, no el wrapper
    ]) expect(avisoCondonacionAnulada(r)).toBeNull();
  });
  test("cableado: tras toast.success, antes de setStatus de éxito, y en ningún otro lugar", () => {
    const exito = region(hook, "const response = await createPago(valuesToSend);", "resetForm();", "éxito");
    expect(exito.indexOf("toast.success(")).toBeGreaterThan(-1);
    expect(exito).toContain("const avisoAnulada = avisoCondonacionAnulada(response);");
    expect(exito).toContain("if (avisoAnulada) toast.warning(avisoAnulada, { duration: 10000 });");
    expect(exito.indexOf("avisoCondonacionAnulada(response)")).toBeGreaterThan(exito.indexOf("toast.success("));
    expect(exito.indexOf("setStatus({ success: true });")).toBeGreaterThan(exito.indexOf("toast.warning(avisoAnulada"));
    expect(cuenta(hook, "avisoCondonacionAnulada(")).toBe(1);
    expect(cuenta(form, "avisoCondonacionAnulada")).toBe(0);
  });
});

describe("doble clic en Confirmar", () => {
  test("el botón 'Confirmar Pago' queda deshabilitado mientras formik.isSubmitting", () => {
    const pie = region(form, "<DialogFooter", "</DialogFooter>", "pie del modal");
    const confirmar = region(pie, "onClick={handleConfirmarPago}", "</Button>", "botón confirmar");
    expect(confirmar).toContain("disabled={formik.isSubmitting}");
  });
  test("el envío real es formik.handleSubmit (pone isSubmitting en true) y el submit no tiene otra vía sin el candado", () => {
    expect(hook).toContain("formik.handleSubmit();");
    expect(hook).toContain("setSubmitting(false);"); // el candado se libera también tras el 409 (finally)
    const fin = region(hook, "} finally {", "},\n  });", "finally");
    expect(fin).toContain("setSubmitting(false);");
  });
  test("el botón 'Registrar Pago' del formulario también se deshabilita al enviar", () => {
    expect(region(form, 'type="submit"', "</Button>", "Registrar Pago")).toContain("disabled={formik.isSubmitting}");
  });
});

// ───────────────────────── handleFormSubmit REAL (excedente / modo pagada) ─────────────────────────
import { getConvenioAplicado } from "../services/convenioContribution";
import { getDisplayedPartialContribution } from "../services/installmentContribution";

const submitSrc = region(hook, "const { monto_boleta, otros } = formik.values;", "const handleAbonoCapital = ", "handleFormSubmit (pago normal)");
const PARAMS_SUBMIT = ["formik", "dataCredito", "mora", "vistaCondonacion", "convenioActivoInfo", "rubrosActual", "abonosCuota", "cuotaSeleccionada",
  "cuotaActualInfo", "toast", "setModalMode", "setExcedente", "setModalExcesoOpen", "getConvenioAplicado", "getDisplayedPartialContribution", "moraEfectivaParaCobrar"];
function compilarSubmit(src: string) {
  const js = new (globalThis as any).Bun.Transpiler({ loader: "ts" }).transformSync(`function h(${PARAMS_SUBMIT.join(",")}){\n${src.slice(0, src.lastIndexOf("};"))}\n}`);
  return (0, eval)(`(()=>{${js}\n return h;})()`) as (...a: unknown[]) => void;
}
const submitActual = compilarSubmit(submitSrc);
const submitPrevio = compilarSubmit(reemplazar(submitSrc,
  "const moraNum = moraEfectivaParaCobrar(Number(mora || 0), vistaCondonacion.current.vista, vistaCondonacion.current.aceptada);", "const moraNum = Number(mora || 0);"));
type SalidaSubmit = { modo?: string; excedente?: number; abierto?: boolean; enviado: boolean; errores: string[] };
function enviar(fn: ReturnType<typeof compilarSubmit>, c: Caso & { pagada?: boolean }, v: VistaPreviaBoletaTardia | undefined, aceptada: boolean): SalidaSubmit {
  const out: SalidaSubmit = { enviado: false, errores: [] };
  const formik = { values: { monto_boleta: c.boleta, otros: c.otros, cuotaApagar: 0 }, handleSubmit: () => { out.enviado = true; } };
  const log = console.log; console.log = () => {};
  try {
    fn(formik, { cuotaMensualAPagar: c.cuota, usuario: { saldo_a_favor: 0 } }, c.mora, { current: { vista: v, aceptada } },
      { cuotaConvenioAPagar: c.convenio ?? 0 }, c.rubros, [], 7, { pagada: !!c.pagada },
      { error: (m: string) => out.errores.push(m) }, (m: string) => { out.modo = m; }, (e: number) => { out.excedente = r2(e); }, (a: boolean) => { out.abierto = a; },
      getConvenioAplicado, getDisplayedPartialContribution, moraEfectivaParaCobrar);
  } finally { console.log = log; }
  return out;
}

describe("handleFormSubmit real: el excedente usa la misma mora efectiva que el modal (F1)", () => {
  test("boleta 1100 / cuota 1000 / mora 45 condonada → excedente 100 (antes del fix salía 55)", () => {
    const c = { boleta: 1100, otros: 0, mora: 45, rubros: 0, cuota: 1000 };
    const v = vista({ montoCondonar: "45.00", moraACobrar: "0.00" });
    const con = enviar(submitActual, c, v, true);
    expect(con).toMatchObject({ modo: "excedente", excedente: 100, abierto: true, enviado: false });
    expect(enviar(submitPrevio, c, v, true).excedente).toBe(55); // el defecto que se arregló
    // el modal dice lo mismo: restante 100
    expect(correr(cascada, c, v, true).montoRestante).toBe(100);
  });
  test("con otros: boleta 1120 / otros 20 / mora 45 condonada → el modal y el submit coinciden en 100", () => {
    const c = { boleta: 1120, otros: 20, mora: 45, rubros: 0, cuota: 1000 };
    const v = vista({ montoCondonar: "45.00", moraACobrar: "0.00" });
    expect(enviar(submitActual, c, v, true).excedente).toBe(100);
    expect(correr(cascada, c, v, true).montoRestante).toBe(100);
  });
  test("boleta 1030 / cuota 1000 / mora 45 condonada → SE ABRE la elección con excedente 30 (antes ni se abría)", () => {
    const c = { boleta: 1030, otros: 0, mora: 45, rubros: 0, cuota: 1000 };
    const v = vista({ montoCondonar: "45.00", moraACobrar: "0.00" });
    expect(enviar(submitActual, c, v, true)).toMatchObject({ modo: "excedente", excedente: 30, abierto: true, enviado: false });
    expect(enviar(submitPrevio, c, v, true)).toMatchObject({ enviado: true });
  });
  test("modo 'pagada' (cuota ya pagada): el excedente ofrecido es boleta − otros − mora efectiva", () => {
    const c = { boleta: 400, otros: 0, mora: 45, rubros: 0, cuota: 1000, pagada: true };
    const v = vista({ montoCondonar: "45.00", moraACobrar: "0.00" });
    expect(enviar(submitActual, c, v, true)).toMatchObject({ modo: "pagada", excedente: 400, abierto: true });
  });
  test("sin casilla (aunque la vista aplique): idéntico a antes en 960 combinaciones, incluida cuota ya pagada", () => {
    for (const c of grilla()) for (const pagada of [false, true]) for (const v of [undefined, vista(), vistaPara(c.mora)]) {
      expect(enviar(submitActual, { ...c, pagada }, v, false)).toEqual(enviar(submitPrevio, { ...c, pagada }, v, false));
    }
  });
  test("con casilla y mora efectiva = mora local (nada que condonar) el submit tampoco cambia", () => {
    for (const c of grilla()) {
      const v = vista({ montoCondonar: "45.00", moraACobrar: c.mora.toFixed(2) });
      expect(enviar(submitActual, c, v, true)).toEqual(enviar(submitPrevio, c, v, true));
    }
  });
  test("helpers: tachado = moraACobrar + condonado; sin aceptar o sin aplicar devuelven la local", () => {
    expect(moraAntesDeCondonar(999, vista(), true)).toBe(80);
    expect(moraAntesDeCondonar(999, vista(), false)).toBe(999);
    expect(moraAntesDeCondonar(999, vista({ aplica: false }), true)).toBe(999);
    expect(moraEfectivaParaCobrar(999, vista(), true)).toBe(35);
    expect(moraEfectivaParaCobrar(999, vista(), false)).toBe(999);
    expect(moraEfectivaParaCobrar(999, undefined, true)).toBe(999);
  });
  test("modal y submit usan el MISMO helper (contrato en ambas regiones)", () => {
    expect(submitSrc).toContain("moraEfectivaParaCobrar(");
    expect(cascadaSrc).toContain("moraEfectivaParaCobrar(");
  });
});

describe("F3: recuadro gris solo con fechaVencimiento", () => {
  test("sin fechaVencimiento (cuotas duplicadas → no_queda_al_dia con fecha null) el recuadro es oculto", () => {
    expect(estadoRecuadroBoletaTardia(vista({ aplica: false, razon: "no_queda_al_dia", fechaVencimiento: null }), entorno())).toEqual({ tipo: "oculto" });
    expect(estadoRecuadroBoletaTardia(vista({ aplica: false, razon: "no_alcanza_mora", fechaVencimiento: null }), entorno())).toEqual({ tipo: "oculto" });
    expect(estadoRecuadroBoletaTardia(vista({ aplica: false, razon: "no_queda_al_dia" }), entorno()).tipo).toBe("gris");
  });
});

// ───────────────────────── F6: la condonación congelada sobrevive al camino del excedente ─────────────────────────
const congelar = "vistaCondonacion.current = vistaEnVivo.current;";
if (!hook.includes(congelar)) throw new Error("falta la línea que congela la condonación en handleFormSubmit");
const soltarSrc = region(hook, "const fijarCondonacion = (", "// Rubros pendientes", "soltar").trimEnd();
const manejadoresSrc = region(hook, "const handleAbonoCapital = () => {", "function useLiquidatePagosInversionistas", "manejadores del modal de exceso");
const motivoSinNada = () => null;
function armarManejadores(refs: { vistaEnVivo: { current: unknown }; vistaCondonacion: { current: unknown } }, formik: unknown, excedente: number) {
  const js = new (globalThis as any).Bun.Transpiler({ loader: "ts" }).transformSync(
    `function m(vistaEnVivo, vistaCondonacion, formik, excedente, cuotaSeleccionada, toast, setModalExcesoOpen, montoParaAbonoDirectoACapital, motivoAbonoACapitalNoPosible, setExcedente, setModalMode){\n${soltarSrc}\n${manejadoresSrc.slice(0, manejadoresSrc.lastIndexOf("};") + 2)}\nreturn { handleAbonoCapital, handleAbonoCapitalDirecto, handleAbonoSiguienteCuota, handleAbonoOtros };}`);
  const m = (0, eval)(`(()=>{${js}\n return m;})()`) as (...a: unknown[]) => Record<string, () => void>;
  return m(refs.vistaEnVivo, refs.vistaCondonacion, formik, excedente, 7, { error: () => {} }, () => {}, montoParaAbonoDirectoACapital, motivoSinNada, () => {}, () => {});
}
describe("F6: boleta 1100 / cuota 1000 / mora 45 condonada, casilla marcada, camino del excedente", () => {
  const caso = { boleta: 1100, otros: 0, mora: 45, rubros: 0, cuota: 1000 };
  const v = vista({ montoCondonar: "45.00", moraACobrar: "0.00" });
  const bloque = bloqueCondonacionParaEnviar(v, v.intentoId, entorno())!;
  function escenario(eleccion: "handleAbonoOtros" | "handleAbonoCapital" | "handleAbonoSiguienteCuota" | "handleAbonoCapitalDirecto") {
    const vistaEnVivo = { current: { bloque, vista: v, aceptada: true } as unknown };
    const vistaCondonacion = { current: { aceptada: false } as unknown };
    const cuerpos: Record<string, unknown>[] = [];
    const formik = {
      values: { ...values, monto_boleta: caso.boleta, otros: 0, abono_directo_capital: 0 } as Record<string, unknown>,
      handleSubmit: () => { cuerpos.push(armarBody(envioSrc, formik.values, undefined, vistaCondonacion)); },
    };
    // 1) Confirmar: handleFormSubmit congela y abre la elección de excedente (moraNum sale de la congelada)
    expect(region(hook, "const handleFormSubmit = (e: React.FormEvent) => {", "vistaCondonacion.current = vistaEnVivo.current;", "inicio").replace(/\s+/g, "")).toBe("consthandleFormSubmit=(e:React.FormEvent)=>{e.preventDefault();");
    new Function("vistaEnVivo", "vistaCondonacion", congelar)(vistaEnVivo, vistaCondonacion);
    const fn = compilarSubmit(submitSrc);
    const out: SalidaSubmit = { enviado: false, errores: [] };
    const log = console.log; console.log = () => {};
    try {
      fn({ values: { monto_boleta: caso.boleta, otros: 0, cuotaApagar: 0 }, handleSubmit: () => { out.enviado = true; } }, { cuotaMensualAPagar: 1000, usuario: { saldo_a_favor: 0 } }, 45,
        vistaCondonacion, { cuotaConvenioAPagar: 0 }, 0, [], 7, { pagada: false }, { error: () => {} }, (m: string) => { out.modo = m; }, (e: number) => { out.excedente = r2(e); }, (a: boolean) => { out.abierto = a; },
        getConvenioAplicado, getDisplayedPartialContribution, moraEfectivaParaCobrar);
    } finally { console.log = log; }
    expect(out).toMatchObject({ modo: "excedente", excedente: 100, abierto: true });
    // 2) El efecto del preview vacía la vista en vivo (la query se recarga mientras el asesor decide)
    vistaEnVivo.current = { aceptada: false };
    // 3) El asesor elige
    armarManejadores({ vistaEnVivo, vistaCondonacion }, formik, 100)[eleccion]();
    return { cuerpos, vistaCondonacion, vistaEnVivo };
  }
  for (const eleccion of ["handleAbonoOtros", "handleAbonoCapital", "handleAbonoSiguienteCuota"] as const) {
    test(`${eleccion}: el body lleva el bloque congelado aunque la vista en vivo ya esté vacía`, () => {
      const { cuerpos } = escenario(eleccion);
      expect(cuerpos).toHaveLength(1);
      expect(cuerpos[0].condonacionBoletaTardia).toEqual(bloque);
      expect(Object.keys(cuerpos[0].condonacionBoletaTardia as object).sort()).toEqual(["intentoId", "montoAceptado"]);
    });
  }
  test("handleAbonoCapitalDirecto: el body NO lleva bloque y las dos refs quedan sueltas", () => {
    const { cuerpos, vistaCondonacion, vistaEnVivo } = escenario("handleAbonoCapitalDirecto");
    expect(cuerpos).toHaveLength(1);
    expect("condonacionBoletaTardia" in cuerpos[0]).toBe(false);
    expect(vistaCondonacion.current).toEqual({ aceptada: false });
    expect(vistaEnVivo.current).toEqual({ aceptada: false });
  });
  test("sin congelar (vistaCondonacion vacía) el mismo camino no llevaría el bloque: la congelación es lo que lo sostiene", () => {
    const vistaCondonacion = { current: { aceptada: false } };
    expect("condonacionBoletaTardia" in armarBody(envioSrc, values, undefined, vistaCondonacion)).toBe(false);
  });
  test("contrato: onSubmit lee la congelada, soltarCondonacion corre en éxito y catch", () => {
    expect(envioSrc).toContain("vistaCondonacion.current.bloque");
    expect(envioSrc).not.toContain("vistaEnVivo");
    const exito = region(hook, "setStatus({ success: true });", "setDataCredito(null);", "éxito");
    expect(exito).toContain("soltarCondonacion();");
  });
});
