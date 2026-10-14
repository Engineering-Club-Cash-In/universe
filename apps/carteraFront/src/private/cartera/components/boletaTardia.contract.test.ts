import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BoletaTardiaRecuadro } from "./BoletaTardiaRecuadro";
import { AVISO_VISTA_PREVIA_FALLIDA, cascadaSinCondonar, confirmacionEsperaVistaPrevia, estadoRecuadroBoletaTardia, moraAntesDeCondonar, moraEfectivaParaCobrar, type VistaPreviaBoletaTardia } from "./boletaTardia";

const form = readFileSync(new URL("./PagoForm.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../hooks/registerPayment.ts", import.meta.url), "utf8");

/** Recorta el fuente entre dos anclas; explota si el ancla ya no existe. */
function region(src: string, desde: string, hasta: string | null, que: string) {
  const i = src.indexOf(desde);
  if (i < 0) throw new Error(`Ancla inicial de "${que}" no encontrada: ${desde}`);
  const j = hasta ? src.indexOf(hasta, i + desde.length) : src.length;
  if (j < 0) throw new Error(`Ancla final de "${que}" no encontrada: ${hasta}`);
  return src.slice(i, j);
}

const ramaCancelacion = region(form, "{creditoCanceladoInfo ? (", "/* MODAL DE CONFIRMACION PARA PAGO NORMAL */", "rama de cancelación");
const ramaPagoNormal = region(form, "/* MODAL DE CONFIRMACION PARA PAGO NORMAL */", "Distribucion del Pago", "pago normal hasta el título");
const iife = region(form, "/* MODAL DE CONFIRMACION PARA PAGO NORMAL */", "const consumo = escalonesQueConsumenLaBoleta", "cálculo de la distribución");

describe("el recuadro del modal", () => {
  test("va en la rama de pago normal, ARRIBA de 'Distribucion del Pago'", () => {
    expect(ramaPagoNormal).toContain("<BoletaTardiaRecuadro");
  });
  test("en la cancelación de crédito NO se muestra", () => {
    expect(ramaCancelacion).toContain("Resumen de Cancelación");
    expect(ramaCancelacion).not.toContain("BoletaTardiaRecuadro");
  });
  test("el estado sale de la lógica pura y la casilla ata la aceptación al intentoId de la vista", () => {
    expect(form).toContain("estadoRecuadroBoletaTardia(vistaBoletaTardia, entornoRecuadro)");
    expect(form).toContain("esCancelacion: !!creditoCanceladoInfo");
    expect(form).toContain("numeroAutorizacion: formik.values.numeroAutorizacion ?? \"\"");
    expect(ramaPagoNormal).toContain("onCambiarAceptada={(v) => setAceptadaIntentoId(v ? vistaBoletaTardia!.intentoId : null)}");
  });
  test("el componente pinta la casilla solo en 'casilla', y en 'oculto' no pinta nada", () => {
    const v = vista();
    const texto = (el: unknown): string => JSON.stringify(el);
    expect(BoletaTardiaRecuadro({ estado: { tipo: "oculto" }, aceptada: false, onCambiarAceptada: () => {} })).toBeNull();
    expect(texto(BoletaTardiaRecuadro({ estado: { tipo: "casilla", vista: v }, aceptada: false, onCambiarAceptada: () => {} }))).toContain('"type":"checkbox"');
    expect(texto(BoletaTardiaRecuadro({ estado: { tipo: "gris", motivo: "x", vista: v }, aceptada: false, onCambiarAceptada: () => {} }))).not.toContain('"type":"checkbox"');
  });
});

const vista = (o: Partial<VistaPreviaBoletaTardia> = {}): VistaPreviaBoletaTardia => ({
  aplica: true, razon: null, fechaVencimiento: "2026-10-05", fechaBoleta: "2026-10-05", fechaRegistro: "2026-10-08",
  diasRetraso: 3, montoCondonar: "45.00", moraACobrar: "0.00",
  porCuota: [{ cuota_id: 7, numero_cuota: 7, fecha_vencimiento: "2026-10-05", monto: "45.00" }],
  intentoId: "11111111-1111-4111-8111-111111111111", ...o,
});

describe("F1/F2: una sola mora efectiva para el modal y para handleFormSubmit", () => {
  test("aceptada: sale moraACobrar del servidor, no mora - montoCondonar", () => {
    expect(moraEfectivaParaCobrar(45, vista(), true)).toBe(0);
    expect(moraEfectivaParaCobrar(80, vista({ moraACobrar: "35.00" }), true)).toBe(35);
  });
  test("sin aceptar, sin vista, que no aplica o con monto inválido: la mora local", () => {
    expect(moraEfectivaParaCobrar(45, vista(), false)).toBe(45);
    expect(moraEfectivaParaCobrar(45, undefined, true)).toBe(45);
    expect(moraEfectivaParaCobrar(45, vista({ aplica: false }), true)).toBe(45);
    expect(moraEfectivaParaCobrar(45, vista({ moraACobrar: "abc" }), true)).toBe(45);
  });
  test("lo tachado es moraACobrar + montoCondonar (valores del servidor)", () => {
    expect(moraAntesDeCondonar(999, vista({ moraACobrar: "35.00" }), true)).toBe(80);
    expect(moraAntesDeCondonar(999, vista({ moraACobrar: "35.00" }), false)).toBe(999);
  });
  test("ejemplo del hallazgo: boleta 1100, cuota 1000, mora 45 condonada → excedente 100 igual en ambos lados", () => {
    const mora = moraEfectivaParaCobrar(45, vista(), true);
    expect(1100 - mora - 1000).toBe(100);
  });
  test("el modal y handleFormSubmit usan el MISMO helper", () => {
    expect(iife).toContain("const moraMonto = moraEfectivaParaCobrar(mora || 0, vistaBoletaTardia, aceptada);");
    expect(iife).toContain("tachado: aceptada ? moraAntesDeCondonar(mora || 0, vistaBoletaTardia, aceptada) : undefined");
    const submit = region(hook, "const moraNum = ", "const cuotaConvenioNum", "mora de handleFormSubmit");
    expect(submit).toContain("moraEfectivaParaCobrar(Number(mora || 0), vistaCondonacion.current.vista, vistaCondonacion.current.aceptada)");
  });
});

describe("F3: el gris exige fecha de vencimiento", () => {
  test("no_queda_al_dia sin fechaVencimiento → oculto", () => {
    const e = { esCancelacion: false, numeroAutorizacion: "A", bancoId: 1, hayBoleta: true };
    expect(estadoRecuadroBoletaTardia(vista({ aplica: false, razon: "no_queda_al_dia", fechaVencimiento: null }), e).tipo).toBe("oculto");
    expect(estadoRecuadroBoletaTardia(vista({ aplica: false, razon: "no_queda_al_dia" }), e).tipo).toBe("gris");
  });
});

describe("F4: Cancelar y Abonar todo a Capital limpian la aceptación", () => {
  test("Cancelar", () => {
    expect(region(form, 'variant="outline"', "</Button>", "Cancelar")).toContain("setAceptadaIntentoId(null)");
  });
  test("Abonar todo a Capital limpia en el front y el hook borra el bloque ANTES de enviar", () => {
    const abonar = region(form, "onClick={() => {\n            setModalConfirmacionOpen(false);", "Abonar todo a Capital", "abonar");
    expect(abonar).toContain("setAceptadaIntentoId(null)");
    const directo = region(hook, "const handleAbonoCapitalDirecto = () => {", "const handleAbonoSiguienteCuota", "directo");
    expect(directo).toContain("fijarCondonacion(undefined, undefined, false)");
    expect(directo.indexOf("fijarCondonacion(undefined, undefined, false)")).toBeLessThan(directo.indexOf("formik.handleSubmit()"));
  });
  test("el envío lee el bloque de una ref (no de un closure viejo)", () => {
    expect(hook).toContain("...(vistaCondonacion.current.bloque ? { condonacionBoletaTardia: vistaCondonacion.current.bloque } : {})");
  });
});

describe("cada apertura es un intento nuevo", () => {
  test("al abrir se sube aperturaId, se desmarca la casilla y la consulta lo recibe", () => {
    const abrir = region(form, "// Abrir modal", "setModalConfirmacionOpen(true);", "apertura del modal");
    expect(abrir).toContain("setAperturaId((a) => a + 1)");
    expect(abrir).toContain("setAceptadaIntentoId(null)");
    expect(form).toContain("useBoletaTardiaPreview(paramsPreviewBoletaTardia, modalConfirmacionOpen, aperturaId)");
  });
  test("al cerrar el modal sin confirmar se limpia la aceptación; confirmar NO la limpia (el envío la necesita)", () => {
    expect(form).toContain("if (!abierto) setAceptadaIntentoId(null);");
    const confirmar = region(form, "const handleConfirmarPago = async () => {", "// 🎯 Calcular datos", "confirmar");
    expect(confirmar).not.toContain("setAceptadaIntentoId");
  });
});

describe("la distribución usa el monto condonado", () => {
  test("la mora del cálculo sale de moraDespuesDeCondonar y la línea '2. Mora' se tacha al aceptar", () => {
        expect(iife).toContain('concepto: aceptada ? "2. Mora (sin la del retraso)" : "2. Mora"');
        expect(iife).toContain("if (moraMonto > 0 || aceptada)");
  });
  test("el renglón tachado se pinta con line-through", () => {
    const lista = region(form, "{distribucion.map((item, idx) => (", "montoRestante > 0.01", "lista de la distribución");
    expect(lista).toContain("item.tachado !== undefined");
    expect(lista).toContain("line-through");
  });
});

describe("la casilla viaja en el body", () => {
  test("PagoForm empuja el bloque al hook solo vía bloqueCondonacionParaEnviar y aceptada = !!bloque (F8)", () => {
    expect(form).toContain("const bloque = bloqueCondonacionParaEnviar(vistaBoletaTardia, aceptadaIntentoId, entornoRecuadro);");
    expect(form).toContain("fijarCondonacion(bloque, vistaBoletaTardia, !!bloque);");
  });
  test("el hook lo suma a valuesToSend solo si hay bloque, y el esquema lo conoce", () => {
    const envio = region(hook, "const valuesToSend = {", "const response = await createPago(valuesToSend)", "valuesToSend");
    expect(envio).toContain("condonacionBoletaTardia: vistaCondonacion.current.bloque");
    expect(hook).toContain("condonacionBoletaTardia: z.object({");
  });
});

describe("respuesta del servidor", () => {
  test("409: el catch distingue el conflicto ANTES del toast genérico y avisa con el texto en español", () => {
    const captura = region(hook, "const response = await createPago(valuesToSend)", "setStatus({ success: false, error: backendMessage });", "envío y catch");
    const iConflicto = captura.indexOf("esConflictoDeCondonacion(error)");
    const iGenerico = captura.indexOf("toast.error(backendMessage)");
    expect(iConflicto).toBeGreaterThan(-1);
    expect(iGenerico).toBeGreaterThan(iConflicto);
    expect(captura).toContain("mensajeConflictoCondonacion(error)");
    expect(captura).toContain("conflictoCondonacion: true");
  });
  test("E-11: tras el éxito, si el servidor anuló la condonación se avisa con un toast", () => {
    const exito = region(hook, "const response = await createPago(valuesToSend)", "setStatus({ success: true });", "éxito");
    expect(exito).toContain("avisoCondonacionAnulada(response)");
    expect(exito).toContain("toast.warning(");
  });
  test("PagoForm pide una consulta nueva, desmarca la casilla y REABRE el modal ante el conflicto", () => {
    const efecto = region(form, "if (formik.status?.conflictoCondonacion) {", "}, [formik.status]", "efecto del conflicto");
    expect(efecto).toContain("setAperturaId((a) => a + 1)");
    expect(efecto).toContain("setAceptadaIntentoId(null)");
    expect(efecto).toContain("setModalConfirmacionOpen(true)");
  });
});

describe("F6: al confirmar se congela la condonación (el excedente cambia otros/abono y con ello la vista)", () => {
  test("handleFormSubmit congela en vistaCondonacion lo que el efecto dejó en vistaEnVivo, ANTES de cualquier rama", () => {
    const ini = region(hook, "const handleFormSubmit = (e: React.FormEvent) => {", "if (creditoCanceladoInfo) {", "inicio de handleFormSubmit");
    expect(ini).toContain("vistaCondonacion.current = vistaEnVivo.current;");
  });
  test("el efecto del preview (fijarCondonacion) solo escribe la ref en vivo, nunca la congelada", () => {
    const fijar = region(hook, "const fijarCondonacion = (", "};", "fijarCondonacion");
    expect(fijar).toContain("vistaEnVivo.current = ");
    expect(fijar).not.toContain("vistaCondonacion.current");
  });
  test("soltarCondonacion limpia las dos refs", () => {
    const soltar = region(hook, "const soltarCondonacion = () => {", "\n  };", "soltarCondonacion");
    expect(soltar).toContain("vistaEnVivo.current = ");
    expect(soltar).toContain("vistaCondonacion.current = ");
  });
  test("se suelta en éxito, en error y en Abonar todo a Capital (antes de enviar)", () => {
    expect(region(hook, "setStatus({ success: true });", "setDataCredito(null);", "éxito")).toContain("soltarCondonacion();");
    expect(region(hook, "} catch (error: any) {", "if (esConflictoDeCondonacion(error)) {", "catch")).toContain("soltarCondonacion();");
    const directo = region(hook, "const handleAbonoCapitalDirecto = () => {", "const handleAbonoSiguienteCuota", "directo");
    expect(directo.indexOf("soltarCondonacion();")).toBeGreaterThan(-1);
    expect(directo.indexOf("soltarCondonacion();")).toBeLessThan(directo.indexOf("formik.handleSubmit()"));
  });
  test("las vías de excedente 'a otros' y 'a capital' NO sueltan la condonación (viaja la congelada)", () => {
    const otros = region(hook, "const handleAbonoCapital = () => {", "const handleAbonoCapitalDirecto", "a capital");
    expect(otros).not.toContain("soltarCondonacion");
    const aOtros = region(hook, "const handleAbonoOtros = () => {", "formik.handleSubmit();", "a otros");
    expect(aOtros).not.toContain("soltarCondonacion");
  });
  test("PagoForm suelta al abrir y al Cancelar", () => {
    expect(region(form, "// Abrir modal", "setModalConfirmacionOpen(true);", "abrir")).toContain("soltarCondonacion();");
    expect(region(form, 'variant="outline"', "</Button>", "Cancelar")).toContain("soltarCondonacion();");
  });
});

describe("F7: el aviso de 'Abonar todo a Capital' usa la mora SIN condonar", () => {
  test("noSeAplica recibe la mora local aplicada, no la condonada", () => {
    const aviso = region(form, "const noSeAplica = loQueElAbonoACapitalNoAplica(", "const textoCausas", "aviso abonar a capital");
    expect(aviso).toContain("mora: moraAntesDeCondonar(Number(mora || 0), vistaBoletaTardia, aceptada),"); // la del servidor (la misma del tachado)
  });
  test("ejemplo 80/20: mora local 999, vista 35 + 45, boleta 100 y rubros 60 -> Q80 a mora y Q20 a rubros", () => {
    const v = vista({ moraACobrar: "35.00", montoCondonar: "45.00" });
    expect(cascadaSinCondonar({ disponible: 100, mora: moraAntesDeCondonar(999, v, true), rubros: 60, convenio: 0, cuotaNormal: 0 }))
      .toMatchObject({ mora: 80, rubros: 20 });
  });
});

describe("Codex r1 #11: Confirmar Pago espera la vista previa", () => {
  test("toma isLoading de la vista previa y lo pasa por la lógica pura (error o params null no bloquean)", () => {
    expect(form).toContain("const { data: vistaBoletaTardia, isLoading: cargandoVistaPrevia, isError: falloVistaPrevia } = useBoletaTardiaPreview(");
    expect(form).toContain(
      "const esperaVistaPrevia = confirmacionEsperaVistaPrevia({ params: paramsPreviewBoletaTardia, abierto: modalConfirmacionOpen, cargando: cargandoVistaPrevia });",
    );
  });
  test("el botón se deshabilita mientras espera y lo dice", () => {
    const pie = region(form, "<DialogFooter", "</DialogFooter>", "pie del modal");
    const confirmar = region(pie, "onClick={handleConfirmarPago}", "</Button>", "botón confirmar");
    expect(confirmar).toContain("disabled={formik.isSubmitting || esperaVistaPrevia}");
    expect(confirmar).toContain('esperaVistaPrevia ? "Calculando condonación…"');
  });
});

describe("la vista previa fallida no bloquea el pago", () => {
  test("PagoForm lee isError de la consulta y muestra el aviso en la rama de pago normal, junto al recuadro", () => {
    expect(form).toContain("isError: falloVistaPrevia");
    expect(ramaPagoNormal).toContain("{falloVistaPrevia && <p role=\"status\"");
    expect(ramaPagoNormal).toContain("{AVISO_VISTA_PREVIA_FALLIDA}");
    expect(ramaCancelacion).not.toContain("falloVistaPrevia");
  });
  test("el aviso dice que el pago se registra sin condonar, y confirmar solo espera la primera carga (con error no espera)", () => {
    expect(AVISO_VISTA_PREVIA_FALLIDA).toBe("No se pudo calcular la condonación por boleta tardía; el pago se registra sin condonar.");
    const params = { credito_id: 1, monto_boleta: 1, otros: 0, abono_directo_capital: 0, fecha_boleta: "2026-10-01" };
    expect(confirmacionEsperaVistaPrevia({ params, abierto: true, cargando: false })).toBe(false);
    expect(estadoRecuadroBoletaTardia(undefined, { esCancelacion: false, numeroAutorizacion: "A", bancoId: 1, hayBoleta: true })).toEqual({ tipo: "oculto" });
  });
});
