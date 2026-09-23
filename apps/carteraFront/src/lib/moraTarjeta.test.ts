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

  it("con el diario en 0 pero techo positivo NO dice que ya no sube", () => {
    // El backend mete en el máximo mensual las cuotas que VENCEN dentro de los
    // próximos 30 días; el diario mide solo mañana. Este crédito tiene sus
    // cuotas vencidas ya topadas y la siguiente por vencer: la mora sí va a
    // volver a subir, y la tarjeta no puede decir lo contrario.
    const t = construirMoraTarjeta({
      ...CASO,
      incrementoDiarioMora: "0.00",
      incrementoMaximoMensualMora: "112.00",
    });
    expect(t.ritmo).not.toContain("Ya no sube");
    expect(t.ritmo).toContain("Hoy no sube");
    expect(t.ritmo).toContain("próxima cuota");
    // Y anuncia el techo, que es el número que el usuario necesita: 37.33 + 112.
    expect(t.techo).not.toBeNull();
    expect(t.techo).toContain("Q 149.33");
    expect(t.techo).toContain("30 días");
  });

  // ------------------------------------------------------------------
  // EL DEFECTO: el texto se contradecía con su propio techo.
  //
  // `incrementoMaximoMensualMora` incluye a propósito las cuotas que VENCEN
  // dentro de los próximos 30 días, pero `cuotas` es el conteo de las YA
  // vencidas que viene de `moras_credito`. Con 1 cuota atrasada la explicación
  // anunciaba que el cargo completo de esa cuota es capital × % × 1, y el techo
  // prometía un número MAYOR, porque ya contaba una segunda cuota que todavía
  // no vencía. Quien sumaba encontraba exactamente la contradicción que esta
  // tarjeta existe para resolver.
  // ------------------------------------------------------------------

  // 1 cuota vencida ya topada (Q112 = su cargo completo) y otra que vence
  // dentro del mes: el máximo mensual trae los Q112 de ESA segunda cuota.
  const UNA_VENCIDA_Y_OTRA_POR_VENCER = {
    montoMora: "112.00",
    cuotasAtrasadas: 1,
    porcentajeMora: "1.12",
    incrementoDiarioMora: "0.00",
    incrementoMaximoMensualMora: "112.00",
  };

  it("con 1 cuota vencida y otra por vencer, el techo declara que la proyección la incluye", () => {
    const t = construirMoraTarjeta(UNA_VENCIDA_Y_OTRA_POR_VENCER);

    // El techo sigue siendo el número real: 112 + 112.
    expect(t.techo).toContain("Q 224.00");
    // …y ahora dice POR QUÉ pasa del cargo completo de la única cuota vencida.
    expect(t.techo).toContain("venzan dentro de esos 30 días");
    expect(t.techo).toContain("no solo las 1 ya vencidas");
  });

  it("el usuario que suma los números no encuentra una contradicción", () => {
    const t = construirMoraTarjeta(UNA_VENCIDA_Y_OTRA_POR_VENCER);

    // La explicación acota su techo a las cuotas YA VENCIDAS…
    expect(t.explicacion).toContain("capital × 1.12% × 1");
    expect(t.explicacion).toContain("YA VENCIDAS");
    expect(t.explicacion).toContain("no el de la proyección");
    // …y el techo acota el suyo a la ventana de 30 días. Los dos números
    // distintos quedan explicados: ninguno desmiente al otro.
    expect(t.techo).toContain("Q 224.00");
    expect(t.techo).toContain("venzan");
  });

  it("MUTACIÓN: con el texto anterior —el techo a secas— vuelve la contradicción", () => {
    const t = construirMoraTarjeta(UNA_VENCIDA_Y_OTRA_POR_VENCER);

    // El texto viejo era exactamente "Si no se paga, en 30 días llega a Q 224.00."
    // y nada más: un techo que pasa del cargo completo de la única cuota
    // vencida, sin decir que ya cuenta la siguiente. Si alguien vuelve a eso,
    // `techo` termina en el punto del monto y este assert falla.
    expect(t.techo).not.toBe("Si no se paga, en 30 días llega a Q 224.00.");
    expect(t.techo?.endsWith("llega a Q 224.00.")).toBe(false);
    // Y la explicación no puede volver a hablar del cargo completo sin acotarlo.
    expect(t.explicacion).not.toContain(
      "recién cuando cada una de las 1 cuotas cumple 30 días de atraso."
    );
  });

  it("sin cuotas vencidas el techo se explica sin hablar de \"las 0 ya vencidas\"", () => {
    // Borde del texto nuevo: la coletilla que nombra el conteo solo aparece
    // cuando hay algo que contar.
    const t = construirMoraTarjeta({
      montoMora: "0",
      cuotasAtrasadas: 0,
      incrementoDiarioMora: "0.00",
      incrementoMaximoMensualMora: "112.00",
    });
    expect(t.techo).toContain("venzan dentro de esos 30 días");
    expect(t.techo).not.toContain("ya vencidas");
    expect(t.techo).not.toContain("las 0");
  });

  it("MUTACIÓN: si el techo volviera a colgar de `diario > 0` se perdería el aviso", () => {
    // La mutación es calcular el techo solo dentro de la rama del diario
    // positivo, que es como estaba: con diario 0 el techo quedaba en null y el
    // usuario no veía a cuánto puede llegar.
    const topado = construirMoraTarjeta({
      ...CASO,
      incrementoDiarioMora: "0.00",
      incrementoMaximoMensualMora: "112.00",
    });
    const subiendo = construirMoraTarjeta({
      ...CASO,
      incrementoDiarioMora: "0.56",
      incrementoMaximoMensualMora: "112.00",
    });
    // MISMO techo con el mismo máximo, suba hoy o no: el techo no depende del
    // diario. Si alguien lo vuelve a atar, este par deja de coincidir.
    expect(topado.techo).toBe(subiendo.techo);
  });

  it("MUTACIÓN: con el máximo en 0 el mensaje tajante SÍ es el correcto", () => {
    // El espejo del caso anterior: arreglar el mensaje no puede costar el
    // "Ya no sube" de verdad, que es el único momento en que es cierto.
    const t = construirMoraTarjeta({
      ...CASO,
      incrementoDiarioMora: "0.00",
      incrementoMaximoMensualMora: "0.00",
    });
    expect(t.ritmo).toContain("Ya no sube");
    expect(t.ritmo).not.toContain("Hoy no sube");
    expect(t.ritmo).not.toContain("próxima cuota");
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

describe("la tarjeta con el `item` del LISTADO", () => {
  // Las tarjetas de escritorio y móvil reciben su `item` de
  // `getCreditosWithUserByMesAnio`, no del detalle. Mientras ese endpoint no
  // mandó los dos campos, este era exactamente el caso "sin los campos nuevos":
  // `ritmo` y `techo` en null y NINGÚN mensaje mostrado. Ahora el listado los
  // provee y la tarjeta dice lo mismo que en el detalle.
  const itemDelListado = {
    mora: { monto_mora: "37.33", cuotas_atrasadas: 1, porcentaje_mora: "1.12" },
    incrementoDiarioMora: "3.74",
    incrementoMaximoMensualMora: "74.67",
  };

  const desdeItem = (item: typeof itemDelListado) =>
    construirMoraTarjeta({
      montoMora: item.mora?.monto_mora,
      cuotasAtrasadas: item.mora?.cuotas_atrasadas,
      porcentajeMora: item.mora?.porcentaje_mora,
      incrementoDiarioMora: item.incrementoDiarioMora,
      incrementoMaximoMensualMora: item.incrementoMaximoMensualMora,
    });

  it("muestra el ritmo y el techo", () => {
    const t = desdeItem(itemDelListado);
    expect(t.ritmo).toContain("Q 3.74");
    expect(t.techo).toContain("Q 112.00");
  });

  it("MUTACIÓN: si el listado dejara de mandarlos, no se muestra NADA", () => {
    const t = desdeItem({
      ...itemDelListado,
      incrementoDiarioMora: undefined as never,
      incrementoMaximoMensualMora: undefined as never,
    });
    expect(t.ritmo).toBeNull();
    expect(t.techo).toBeNull();
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
