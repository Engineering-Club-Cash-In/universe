import { describe, expect, it } from "bun:test";
import { escalonesQueConsumenLaBoleta, loQueElAbonoACapitalNoAplica } from "./escalonesQueConsumenLaBoleta";

// ─────────────────────────────────────────────────────────────────────────────
// Los dos avisos del modal de confirmación salen de esta lista: el de "cobro
// corto" (quién se llevó la plata que le faltó a la cuota) y el de "Abonar todo
// a Capital" (qué se deja de cobrar si el asesor elige esa opción). Fijarla acá
// es lo que impide que terminen diciendo cosas distintas.
// ─────────────────────────────────────────────────────────────────────────────

describe("escalonesQueConsumenLaBoleta", () => {
  it("nombra los escalones con plata y los suma", () => {
    const c = escalonesQueConsumenLaBoleta([
      { etiqueta: "otros", monto: 50 },
      { etiqueta: "mora", monto: 120.5 },
      { etiqueta: "rubros", monto: 300 },
    ]);

    expect(c.escalones.map((e) => e.etiqueta)).toEqual(["otros", "mora", "rubros"]);
    expect(c.total).toBe(470.5);
    expect(c.hayConsumo).toBe(true);
  });

  it("deja afuera los que no se llevaron nada", () => {
    const c = escalonesQueConsumenLaBoleta([
      { etiqueta: "otros", monto: 0 },
      { etiqueta: "rubros", monto: 300 },
    ]);

    expect(c.escalones.map((e) => e.etiqueta)).toEqual(["rubros"]);
    expect(c.total).toBe(300);
  });

  it("sin nada encima no hay aviso que dar", () => {
    const c = escalonesQueConsumenLaBoleta([
      { etiqueta: "otros", monto: 0 },
      { etiqueta: "mora", monto: 0 },
    ]);

    expect(c.hayConsumo).toBe(false);
    expect(c.total).toBe(0);
  });

  it("ignora las colas por debajo de medio centavo", () => {
    // Un residuo de redondeo no puede hacer que el modal anuncie que la cuota
    // quedó corta "porque Q0.001 se fueron a mora".
    const c = escalonesQueConsumenLaBoleta([{ etiqueta: "mora", monto: 0.004 }]);

    expect(c.hayConsumo).toBe(false);
  });

  it("medio centavo largo sí cuenta", () => {
    const c = escalonesQueConsumenLaBoleta([{ etiqueta: "mora", monto: 0.01 }]);

    expect(c.hayConsumo).toBe(true);
    expect(c.total).toBe(0.01);
  });

  it("conserva el orden de la cascada, no el de los montos", () => {
    // El asesor lee el desglose de arriba hacia abajo y el aviso se refiere a
    // esas mismas filas. Ordenar por monto lo obligaría a buscar cuál es cuál.
    const c = escalonesQueConsumenLaBoleta([
      { etiqueta: "mora", monto: 10 },
      { etiqueta: "rubros", monto: 9000 },
    ]);

    expect(c.escalones.map((e) => e.etiqueta)).toEqual(["mora", "rubros"]);
  });

  it("el total no arrastra la cola del punto flotante", () => {
    const c = escalonesQueConsumenLaBoleta([
      { etiqueta: "otros", monto: 0.1 },
      { etiqueta: "mora", monto: 0.2 },
    ]);

    expect(c.total).toBe(0.3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Son DOS PREGUNTAS, no una, y colapsarlas en una sola lista fue el error.
//
//   * "¿quién se comió la plata que le faltó a la cuota?" → **consume**.
//     El convenio queda AFUERA: se registra pero no descuenta de la boleta, así
//     que culparlo de un faltante es acusar a quien no se llevó nada.
//   * "¿qué NO va a pasar si aprieto Abonar todo a Capital?" → **se deja de
//     aplicar**. El convenio va ADENTRO: con la boleta entera a capital el
//     disponible queda en cero, `debeProcesarConvenio` exige `> 0` y no se
//     acredita nada en `convenios_pago`. Y el excedente también, porque el
//     bloque que lo manda a saldo a favor tampoco corre.
//
// El mismo predicado no puede contestar las dos: una pregunta mide quién
// consume, la otra qué se promete en pantalla y no ocurre.
// ─────────────────────────────────────────────────────────────────────────────

describe("loQueElAbonoACapitalNoAplica", () => {
  const sinNada = { mora: 0, rubros: 0, convenio: 0, excedente: 0, cuota: 0 };

  it("NOMBRA el convenio, que el otro predicado ni lista — pero no lo suma", () => {
    // La asimetría con `escalonesQueConsumenLaBoleta` sigue viva y ahora es más
    // fina: acá el convenio SÍ se nombra —el asesor tiene que saber que tampoco
    // va a pasar— pero NO entra al total, porque se registra sin consumir la
    // boleta. Sumarlo hacía que el aviso reclamara más plata de la que la boleta
    // trae.
    const a = loQueElAbonoACapitalNoAplica({ ...sinNada, convenio: 300 });

    expect(a.hayAviso).toBe(true);
    expect(a.etiquetas).toContain("Q300.00 al convenio");
    expect(a.total).toBe(0);
  });

  it("incluye el excedente prometido como saldo a favor", () => {
    const a = loQueElAbonoACapitalNoAplica({ ...sinNada, excedente: 4000 });

    expect(a.hayAviso).toBe(true);
    expect(a.etiquetas).toContain("Q4000.00 de excedente a saldo a favor");
  });

  it("🔴 avisa con SÓLO convenio, que es el caso que se escapaba", () => {
    // Con convenio activo y sin otros/mora/rubros, el aviso se gateaba por
    // `hayConsumo` y no salía — mientras el desglose de arriba mostraba la
    // contribución al convenio dos veces.
    const a = loQueElAbonoACapitalNoAplica({ ...sinNada, convenio: 300 });

    expect(a.hayAviso).toBe(true);
  });

  it("suma todo lo que sale del disponible, en orden de pantalla", () => {
    const a = loQueElAbonoACapitalNoAplica({
      mora: 100,
      rubros: 200,
      convenio: 300,
      cuota: 0,
      excedente: 500,
    });

        // El total ya NO suma el convenio: se registra sin consumir la boleta, así
    // que sumarlo informaba más plata de la que la boleta trae.
    expect(a.total).toBe(800);
    expect(a.etiquetas).toEqual([
      "Q100.00 a mora",
      "Q200.00 a rubros",
      "Q300.00 al convenio",
      "Q500.00 de excedente a saldo a favor",
    ]);
  });

  it("⚠️ NO nombra `otros`, porque el abono directo no lo anula", () => {
    // `otros` consume la boleta —se resta en `calcularMontoEfectivo`— pero es
    // una columna de la fila del pago y se guarda tal como vino, así que SÍ se
    // cobra. El aviso decía "no se cobra QX a otros", que era falso.
    // Con los cuatro montos encima: si alguna etiqueta dijera "otros", acá se
    // ve. Con sólo rubros no alcanzaba —el resto se filtra por estar en cero y
    // una etiqueta mal escrita pasaba igual—.
    const a = loQueElAbonoACapitalNoAplica({
      mora: 100,
      rubros: 200,
      convenio: 300,
      cuota: 0,
      excedente: 400,
    });

    expect(a.etiquetas.join(" ")).not.toContain("otros");
    // Y el total tampoco lo incluye: son los cuatro que salen del disponible.
        // El total ya NO suma el convenio: se registra sin consumir la boleta, así
    // que sumarlo informaba más plata de la que la boleta trae.
    expect(a.total).toBe(700);
  });

  it("🔴 avisa con SÓLO la cuota, que es el caso MÁS COMÚN", () => {
    // El que se escapó dos rondas: una boleta normal, sin mora, sin rubros, sin
    // convenio y sin excedente. Todos los términos en cero, el aviso no salía, y
    // el botón manda la cuota entera a capital dejándola sin abono.
    //
    // Y el texto del aviso YA decía "la cuota queda sin abono": nombraba la
    // consecuencia mientras el predicado que lo mostraba no la miraba.
    const a = loQueElAbonoACapitalNoAplica({ ...sinNada, cuota: 1000 });

    expect(a.hayAviso).toBe(true);
    expect(a.etiquetas).toContain("Q1000.00 a la cuota");
    expect(a.total).toBe(1000);
  });

  it("la cuota va ÚLTIMA, que es su lugar en la cascada", () => {
    const a = loQueElAbonoACapitalNoAplica({
      mora: 100,
      rubros: 200,
      convenio: 300,
      cuota: 1000,
      excedente: 400,
    });

    expect(a.etiquetas).toEqual([
      "Q100.00 a mora",
      "Q200.00 a rubros",
      "Q300.00 al convenio",
      "Q1000.00 a la cuota",
      "Q400.00 de excedente a saldo a favor",
    ]);
        // El total ya NO suma el convenio: se registra sin consumir la boleta, así
    // que sumarlo informaba más plata de la que la boleta trae.
    expect(a.total).toBe(1700);
  });

  it("sin nada prometido no hay aviso", () => {
    expect(loQueElAbonoACapitalNoAplica(sinNada).hayAviso).toBe(false);
  });

  it("ignora las colas por debajo de medio centavo", () => {
    const a = loQueElAbonoACapitalNoAplica({ ...sinNada, convenio: 0.004, excedente: 0.004 });

    expect(a.hayAviso).toBe(false);
  });
});

describe("el TOTAL del aviso no puede superar la boleta", () => {
  it("🔴 el convenio se LISTA pero no se SUMA: no sale de la boleta", () => {
    // Una boleta de Q1,000 que acredita Q300 al convenio y aplica Q1,000 a la
    // cuota informaba «Q1,300 en total» — más plata de la que la boleta trae.
    // El convenio se registra SIN consumir la boleta, que es justo la asimetría
    // que separa a este predicado de `escalonesQueConsumenLaBoleta`.
    const r = loQueElAbonoACapitalNoAplica({
      mora: 0, rubros: 0, convenio: 300, cuota: 1000, excedente: 0,
    });
    expect(r.total).toBe(1000);
    expect(r.etiquetas.join(" ")).toContain("convenio");
  });

  it("lo que SÍ sale de la boleta se suma completo", () => {
    const r = loQueElAbonoACapitalNoAplica({
      mora: 50, rubros: 100, convenio: 0, cuota: 800, excedente: 50,
    });
    expect(r.total).toBe(1000);
  });

  it("sólo convenio: se avisa, pero el total es cero", () => {
    const r = loQueElAbonoACapitalNoAplica({
      mora: 0, rubros: 0, convenio: 300, cuota: 0, excedente: 0,
    });
    expect(r.hayAviso).toBe(true);
    expect(r.total).toBe(0);
  });
});
