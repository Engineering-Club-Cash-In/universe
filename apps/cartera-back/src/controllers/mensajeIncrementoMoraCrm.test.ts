import { describe, expect, it, mock } from "bun:test";

/**
 * PUNTA A PUNTA entre los dos lados del anuncio de la mora: los números los
 * calcula cartera-back (latefee.ts) y la oración la arma el CRM
 * (apps/crm/apps/server/src/lib/cobros-plantillas.ts). Las dos mitades se
 * prueban por separado en sus suites; esto prueba la COSTURA, que es donde
 * vivía el defecto: el CRM borraba la cláusula entera al ver un ritmo en 0 y
 * se llevaba el techo, que sí era distinto de cero.
 *
 * Se corre acá y no en el CRM porque el server del CRM no compila nada fuera
 * de su `src/` y porque latefee.ts arrastra la conexión a la base; acá la
 * conexión se reemplaza por un objeto vacío (mismo truco que
 * moraProporcional.test.ts) y el archivo del CRM solo depende de big.js, que
 * cartera-back ya tiene. NO toca la base.
 *
 * El calendario del caso es el real: capital Q10,000 con cuotas al 30-mar y al
 * 30-abr. El 29-abr —la víspera— la cuota vieja ya tocó su techo de 30 días y
 * la nueva todavía no vence, así que el delta de UN día da Q0.00. Pasa cada
 * vez que el mes trae 31 días, o sea ~7 veces al año en cualquier crédito
 * mensual.
 */
mock.module("../database", () => ({ db: {}, client: {} }));

const {
  calcularMoraProporcional,
  diasAtrasoMoraConSigno,
  incrementoDiarioMora,
  incrementoMaximoMensualMora,
} = await import("./latefee");

/**
 * El archivo del CRM se carga por una ruta ARMADA, no por un especificador
 * literal, a propósito: así el módulo no entra en el programa de `tsc` de
 * cartera-back. Compilarlo desde acá lo haría resolver sus dependencias
 * (big.js) contra el árbol equivocado y agregaría errores de tipos ajenos a
 * este app — el mismo motivo por el que el CRM lee el fuente de cartera-back
 * en vez de importarlo (ver estados-cobranza.test.ts). En tiempo de
 * ejecución es un import normal.
 */
type PlantillasCrm = {
  PLANTILLAS_MENSAJES: Array<{ id: string; cuerpo: string }>;
  interpolar: (texto: string, variables: Record<string, unknown>) => string;
  formatearIncrementoMora: (valor: string) => string;
  calcularExpectativaMora: (capital: string) => string;
  calcularExpectativaMoraDiaria: (capital: string) => string;
};

const RUTA_PLANTILLAS_CRM = new URL(
  "../../../crm/apps/server/src/lib/cobros-plantillas.ts",
  import.meta.url,
).pathname;

const {
  PLANTILLAS_MENSAJES,
  interpolar,
  formatearIncrementoMora,
  calcularExpectativaMora,
  calcularExpectativaMoraDiaria,
} = (await import(RUTA_PLANTILLAS_CRM)) as PlantillasCrm;

const VENCIMIENTOS = ["2026-03-30", "2026-04-30"];

function anuncioDelDia(capital: string, hoyISO: string) {
  const hoy = new Date(`${hoyISO}T12:00:00.000Z`);
  const dias = VENCIMIENTOS.map((v) => diasAtrasoMoraConSigno(v, hoy));
  const mora = calcularMoraProporcional({
    capital,
    diasAtrasadosPorCuota: dias.map((d) => Math.max(0, d)),
  }).toFixed(2);
  const ritmo = incrementoDiarioMora({ capital, diasAtrasadosPorCuota: dias }).toFixed(2);
  const techo = incrementoMaximoMensualMora({ capital, diasAtrasadosPorCuota: dias }).toFixed(2);

  const cuerpo = (id: string) =>
    PLANTILLAS_MENSAJES.find((p) => p.id === id)?.cuerpo ?? "";

  const variables = {
    clienteNombre: "ANA LOPEZ",
    fechaPago: "30",
    cuotaMensual: "1,500.00",
    placa: "P123ABC",
    marcaLineaModelo: "Toyota Yaris 2018",
    montoAdeudado: mora,
    cuotasAtraso: dias.filter((d) => d > 0).length,
    telefonoAsesor: "41286630",
    nombreAsesor: "Carlos Pérez",
    expectativaMora: calcularExpectativaMora(capital),
    expectativaMoraDiaria: calcularExpectativaMoraDiaria(capital),
    incrementoDiarioMora: formatearIncrementoMora(ritmo),
    incrementoMaximoMensualMora: formatearIncrementoMora(techo),
  };

  return {
    mora,
    ritmo,
    techo,
    mora30: interpolar(cuerpo("mora_30"), variables),
    alDia: interpolar(cuerpo("al_dia"), variables),
  };
}

describe("el mensaje del CRM contra los números reales de latefee", () => {
  const CAPITAL = "10000";

  it("28-abr (antevíspera): ritmo y techo, los dos vivos", () => {
    const a = anuncioDelDia(CAPITAL, "2026-04-28");
    expect([a.mora, a.ritmo, a.techo]).toEqual(["108.27", "3.73", "108.26"]);
    expect(a.mora30).toContain(
      "al día de hoy, que sube alrededor de Q3.73 por día, y puede aumentar hasta Q108.26 más en los próximos 30 días.",
    );
  });

  it("29-abr (VÍSPERA): el ritmo es 0 y el mensaje anuncia el techo igual", () => {
    const a = anuncioDelDia(CAPITAL, "2026-04-29");
    // El ritmo de UN día es cero, pero la mora va a crecer: mañana vence la
    // cuota nueva y el techo a 30 días lo dice.
    expect([a.mora, a.ritmo, a.techo]).toEqual(["112.00", "0.00", "108.27"]);
    expect(a.mora30).toContain(
      "al día de hoy, y puede aumentar hasta Q108.27 más en los próximos 30 días.",
    );
    // Y NO se queda mudo (el defecto: antes el mensaje terminaba en "hoy.").
    expect(a.mora30).not.toContain("al día de hoy.");
    expect(a.mora30).not.toContain("Q0.00");
    expect(a.mora30).not.toContain("{incremento");
  });

  it("30-abr (vence): vuelve el ritmo, con el techo del mes completo", () => {
    const a = anuncioDelDia(CAPITAL, "2026-04-30");
    expect([a.mora, a.ritmo, a.techo]).toEqual(["112.00", "3.73", "112.00"]);
    expect(a.mora30).toContain(
      "al día de hoy, que sube alrededor de Q3.73 por día, y puede aumentar hasta Q112.00 más en los próximos 30 días.",
    );
  });

  it("01-may: el ritmo cambia de un día para otro (3.73 → 3.74)", () => {
    const a = anuncioDelDia(CAPITAL, "2026-05-01");
    expect([a.mora, a.ritmo, a.techo]).toEqual(["115.73", "3.74", "108.27"]);
    // Por eso la oración dice "alrededor de" y no promete un ritmo fijo.
    expect(a.mora30).toContain("que sube alrededor de Q3.74 por día");
  });

  it("el techo nunca es cero mientras la mora vaya a crecer", () => {
    for (const dia of ["2026-04-28", "2026-04-29", "2026-04-30", "2026-05-01"]) {
      expect(Number(anuncioDelDia(CAPITAL, dia).techo)).toBeGreaterThan(0);
      // …y el mensaje del día SIEMPRE trae una cifra de aumento.
      expect(anuncioDelDia(CAPITAL, dia).mora30).toContain("puede aumentar hasta Q");
    }
  });

  it("capital sin división exacta: 30 × el ritmo NO da el cargo mensual", () => {
    // Q10,000 → cargo mensual Q112.00, y 112/30 = 3.7333… → Q3.73.
    // 30 × 3.73 = Q111.90 ≠ Q112.00: por eso la plantilla del día de pago dice
    // "alrededor de" en vez de prometer una multiplicación que no cierra.
    const a = anuncioDelDia(CAPITAL, "2026-04-28");
    expect(a.alDia).toContain(
      "un recargo por mora de alrededor de Q3.73 por cada día de atraso, hasta un máximo de Q112.00 al mes.",
    );
    expect(30 * 3.73).not.toBe(112);
  });

  it("capital con división exacta (múltiplo de Q187.50): los números cierran", () => {
    // Q187.50 → cargo mensual Q2.10, y 2.10/30 = Q0.07 exacto: 30 × 0.07 = 2.10.
    const a = anuncioDelDia("187.50", "2026-04-28");
    expect(a.alDia).toContain(
      "un recargo por mora de alrededor de Q0.07 por cada día de atraso, hasta un máximo de Q2.10 al mes.",
    );
    expect(a.mora30).toContain(
      "al día de hoy, que sube alrededor de Q0.07 por día, y puede aumentar hasta Q2.03 más en los próximos 30 días.",
    );
  });

  it("víspera con capital exacto: tampoco se queda mudo", () => {
    const a = anuncioDelDia("187.50", "2026-04-29");
    expect([a.ritmo, a.techo]).toEqual(["0.00", "2.03"]);
    expect(a.mora30).toContain(
      "al día de hoy, y puede aumentar hasta Q2.03 más en los próximos 30 días.",
    );
  });
});
