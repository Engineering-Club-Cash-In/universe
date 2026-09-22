import { describe, expect, it } from "bun:test";
import { construirMoraTarjeta } from "./moraTarjeta";

// El caso del reporte: % Mora 1.12, Cuotas atrasadas 3, Monto Q37.33. Los tres
// correctos, pero quien los multiplica obtiene Q336 y cree que el monto está mal.
const CASO = {
  montoMora: "37.33",
  cuotasAtrasadas: 3,
  porcentajeMora: "1.12",
  incrementoDiarioMora: "16.80",
  incrementoMaximoMensualMora: "298.67",
};

describe("construirMoraTarjeta — la tarjeta vuelve a reconciliar", () => {
  it("el monto dice que es de HOY, no un total fijo", () => {
    const t = construirMoraTarjeta(CASO);
    expect(t.monto).toBe("Q 37.33");
    expect(t.rotuloMonto).toContain("hoy");
  });

  it("dice a qué ritmo crece y a dónde llega", () => {
    const t = construirMoraTarjeta(CASO);
    expect(t.ritmo).toContain("Q 16.80");
    expect(t.ritmo).toContain("día");
    // 37.33 + 298.67 = 336.00: el techo ES el resultado de la multiplicación que
    // el usuario iba a hacer, que así deja de contradecir al monto de hoy.
    expect(t.techo).toContain("Q 336.00");
    expect(t.techo).toContain("30 días");
  });

  it("desarma la multiplicación nombrándola en vez de dejarla flotando", () => {
    const t = construirMoraTarjeta(CASO);
    expect(t.explicacion).toContain("capital × 1.12% × 3");
    expect(t.explicacion).toContain("NO es");
    expect(t.explicacion).toContain("30 días de atraso");
  });

  it("cuando la mora ya topó, lo dice en vez de prometer que sube", () => {
    const t = construirMoraTarjeta({
      ...CASO,
      incrementoDiarioMora: "0.00",
      incrementoMaximoMensualMora: "0.00",
    });
    expect(t.ritmo).toContain("Ya no sube");
    expect(t.techo).toBeNull();
  });

  it("sin los campos nuevos no se inventa un ritmo", () => {
    // Backend viejo: `incrementoDiarioMora` no viene. Antes que mentir con una
    // cifra deducida de monto/cuotas —que sería volver a la fórmula vieja—, se
    // calla el ritmo y se queda la explicación.
    const t = construirMoraTarjeta({
      montoMora: "37.33",
      cuotasAtrasadas: 3,
      porcentajeMora: "1.12",
    });
    expect(t.ritmo).toBeNull();
    expect(t.techo).toBeNull();
    expect(t.explicacion.length).toBeGreaterThan(0);
  });

  it("sin porcentaje o sin cuotas sigue explicando que se acumula por día", () => {
    const t = construirMoraTarjeta({ montoMora: "0", cuotasAtrasadas: 0 });
    expect(t.monto).toBe("Q 0.00");
    expect(t.cuotas).toBe(0);
    expect(t.explicacion).toContain("por día");
    expect(t.explicacion).not.toContain("×");
  });

  it("tolera null/undefined/basura sin romper la tarjeta", () => {
    const t = construirMoraTarjeta({
      montoMora: null,
      cuotasAtrasadas: undefined,
      porcentajeMora: "",
      incrementoDiarioMora: "no-es-un-número",
    });
    expect(t.monto).toBe("Q 0.00");
    expect(t.cuotas).toBe(0);
    expect(t.ritmo).toBeNull();
  });
});

describe("la tarjeta está cableada a construirMoraTarjeta", () => {
  // carteraFront no tiene DOM ni testing-library: el cableado se prueba sobre el
  // fuente, acotado a la región de MoraInfo y afirmando en POSITIVO lo que tiene
  // que estar (no solo la ausencia de lo viejo).
  const fuente = Bun.file(
    new URL(
      "../private/cartera/components/CreditsPaymentsData.tsx",
      import.meta.url,
    ).pathname,
  );

  const region = async () => {
    const texto = await fuente.text();
    const desde = texto.indexOf("function MoraInfo(");
    expect(desde).toBeGreaterThan(-1);
    const hasta = texto.indexOf("function IncobrableInfo(", desde);
    expect(hasta).toBeGreaterThan(desde);
    return texto.slice(desde, hasta);
  };

  it("MoraInfo pinta lo que decide la librería", async () => {
    const r = await region();
    expect(r).toContain("construirMoraTarjeta({");
    expect(r).toContain("montoMora: mora?.monto_mora");
    expect(r).toContain("cuotasAtrasadas: mora?.cuotas_atrasadas");
    expect(r).toContain("porcentajeMora: mora?.porcentaje_mora");
    expect(r).toContain("{tarjeta.monto}");
    expect(r).toContain("{tarjeta.rotuloMonto}");
    expect(r).toContain("{tarjeta.cuotas}");
    expect(r).toContain("{tarjeta.ritmo}");
    expect(r).toContain("{tarjeta.techo}");
    expect(r).toContain("{tarjeta.explicacion}");
  });

  it("ya no hay un recuadro suelto de '% Mora' al lado de las cuotas", async () => {
    const r = await region();
    expect(r).not.toContain("% Mora");
    expect(r).not.toContain("{mora?.porcentaje_mora}%");
  });

  it("recibe del endpoint los dos campos del incremento", async () => {
    const texto = await fuente.text();
    // En los DOS lugares donde se monta la tarjeta.
    expect(
      texto.match(/incrementoDiarioMora=\{item\.incrementoDiarioMora\}/g),
    ).toHaveLength(2);
    expect(
      texto.match(
        /incrementoMaximoMensualMora=\{\s*item\.incrementoMaximoMensualMora\s*\}/g,
      ),
    ).toHaveLength(2);
  });
});
