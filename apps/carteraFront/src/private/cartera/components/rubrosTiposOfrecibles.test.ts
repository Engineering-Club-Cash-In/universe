import { describe, expect, it } from "bun:test";
import { motivoTipoNoCobrable } from "./rubrosTiposOfrecibles";

// ─────────────────────────────────────────────────────────────────────────────
// Por qué un tipo NO se puede cobrar AHORA en este crédito.
//
// El patrón que esto cierra es "la pantalla ofrece una acción que el backend va
// a rechazar", y en este stack ya apareció tres veces. Acá el desplegable de
// crear ofrecía todos los tipos activos y el envío se comía un 409 con el
// formulario lleno.
//
// Se DESHABILITA con el motivo, no se filtra, y la diferencia no es estética:
//
//   * si todos los tipos activos fueran opcionales, la lista filtrada queda
//     vacía y la pantalla imprime "No hay tipos de rubro activos configurados"
//     —que es FALSO— y manda a crear un tipo duplicado;
//   * y al que ya había elegido un tipo se le borra la selección sola, porque el
//     efecto que limpia el borrador no distingue "desapareció" de "no se puede
//     ahora".
//
// ⚠️ El gate del front es una COMODIDAD, no una garantía, y por dos razones:
// el `statusCredit` que tiene es la foto de la fila con que se abrió el modal
// —el cron de moras lo mueve por atrás— y el front NUNCA puede ver
// `moraActivaMonto`, así que un crédito ACTIVO con mora viva también rechaza los
// opcionales y desde acá es invisible. Por eso ante la duda se OFRECE: el falso
// permisivo cuesta un formulario y un 409 redactado, y el falso restrictivo deja
// al ADMIN sin poder hacer algo legítimo y sin salida desde la pantalla.
// ─────────────────────────────────────────────────────────────────────────────

const tipo = (over: Record<string, unknown> = {}) => ({
  tipo_id: 3,
  nombre: "Calcomanía",
  obligatorio: false,
  ...over,
});

describe("motivoTipoNoCobrable", () => {
  it("un tipo sin impedimentos se puede cobrar", () => {
    expect(
      motivoTipoNoCobrable({ tipo: tipo(), statusCredit: "ACTIVO", rubros: [] })
    ).toBeNull();
  });

  it("🔴 el tipo que YA tiene un cobro vivo en este crédito no se puede repetir", () => {
    // Rechazo DETERMINÍSTICO: el índice único es sobre (credito_id, tipo_id)
    // WHERE completado = false, así que el 409 es seguro. Y el dato ya está en
    // memoria — la lista de rubros del crédito trae `tipo_id` y `completado`.
    const m = motivoTipoNoCobrable({
      tipo: tipo(),
      statusCredit: "ACTIVO",
      rubros: [{ tipo_id: 3, completado: false }],
    });

    expect(m).toContain("ya tiene un cobro vivo");
  });

  it("un cobro SALDADO del mismo tipo no impide crear otro", () => {
    // El índice mira `completado = false`. Un rubro ya cobrado entero no ocupa
    // el lugar: tras un cobro legítimo puede hacer falta el del año siguiente.
    expect(
      motivoTipoNoCobrable({
        tipo: tipo(),
        statusCredit: "ACTIVO",
        rubros: [{ tipo_id: 3, completado: true }],
      })
    ).toBeNull();
  });

  it("un cobro vivo de OTRO tipo no estorba", () => {
    expect(
      motivoTipoNoCobrable({
        tipo: tipo(),
        statusCredit: "ACTIVO",
        rubros: [{ tipo_id: 99, completado: false }],
      })
    ).toBeNull();
  });

  it("🔴 un tipo OPCIONAL no entra en un crédito MOROSO", () => {
    const m = motivoTipoNoCobrable({ tipo: tipo(), statusCredit: "MOROSO", rubros: [] });

    expect(m).toContain("MOROSO");
    expect(m).toContain("obligatorios");
  });

  it("tampoco en EN_CONVENIO", () => {
    expect(
      motivoTipoNoCobrable({ tipo: tipo(), statusCredit: "EN_CONVENIO", rubros: [] })
    ).toContain("EN_CONVENIO");
  });

  it("los OBLIGATORIOS sí entran en un crédito moroso", () => {
    // Es la razón de ser de la marca `obligatorio`, que vive en el TIPO.
    expect(
      motivoTipoNoCobrable({
        tipo: tipo({ obligatorio: true }),
        statusCredit: "MOROSO",
        rubros: [],
      })
    ).toBeNull();
  });

  it("el cobro vivo pesa MÁS que el estado del crédito", () => {
    // El duplicado es un rechazo seguro; el estado es una foto que puede estar
    // vieja. Se nombra el que sabemos cierto.
    const m = motivoTipoNoCobrable({
      tipo: tipo({ obligatorio: true }),
      statusCredit: "MOROSO",
      rubros: [{ tipo_id: 3, completado: false }],
    });

    expect(m).toContain("ya tiene un cobro vivo");
  });

  it("sin estado conocido se OFRECE, no se bloquea", () => {
    // Ante la duda, permisivo: el backend es la autoridad y su 409 viene
    // redactado. Bloquear con información que no tenemos deja al ADMIN sin
    // salida desde la pantalla.
    expect(
      motivoTipoNoCobrable({ tipo: tipo(), statusCredit: null, rubros: [] })
    ).toBeNull();
  });
});
