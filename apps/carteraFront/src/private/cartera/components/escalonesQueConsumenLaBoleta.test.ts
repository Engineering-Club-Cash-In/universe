import { describe, expect, it } from "bun:test";
import { escalonesQueConsumenLaBoleta } from "./escalonesQueConsumenLaBoleta";

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
