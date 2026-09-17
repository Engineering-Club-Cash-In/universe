import { describe, expect, it } from "bun:test";
import { excluirTraspasosSinBorrar } from "./poolsTraspasos";

// ─────────────────────────────────────────────────────────────────────────────
// `/pools-raros` junta varios créditos en un pool: los que coinciden con el
// número del pool se quedan, y los que NO se BORRAN de la base mientras su
// inversionista y su capital se reasignan al crédito principal. Son dos pasos y
// el segundo depende del primero.
//
// El guard de rubros rompió ese supuesto: ahora el borrado puede RECHAZARSE
// —crédito con un cobro adicional con deuda viva—, y el rechazo se anotaba en el
// detalle y nada más. El recálculo seguía sumándole al principal las tenencias
// de un crédito que quedó en pie: el mismo capital contado DOS veces, con el
// inversionista cobrando interés y cuota por los dos lados. Reproducido.
//
// Por eso el traspaso se excluye. Abortar el pool entero castigaría a los
// traspasos sanos que sí se borraron; excluir sólo el rechazado deja el pool
// consistente y el rechazo visible en el detalle.
//
// ⚠️ `not_found` NO excluye, y la asimetría es el punto: si el crédito origen no
// existe en la base, no hay nada que pueda quedar duplicado — el traspaso tiene
// que entrar igual o el inversionista PERDERÍA su capital.
// ─────────────────────────────────────────────────────────────────────────────

type C = { numeroCredito: string; inversionista: string; capitalRestante: string };
const credito = (n: string, inv = "Ana"): C => ({
  numeroCredito: n,
  inversionista: inv,
  capitalRestante: "100000",
});

describe("excluirTraspasosSinBorrar", () => {
  it("excluye el traspaso cuyo borrado fue RECHAZADO", () => {
    const r = excluirTraspasosSinBorrar(
      [
        {
          numeroCredito: "POOL1",
          entradas: [
            { credito: credito("POOL1"), origenBase: null },
            { credito: credito("POOL1", "Beto"), origenBase: "ORIGEN9" },
          ],
        },
      ],
      [{ numeroCredito: "ORIGEN9", status: "error" }]
    );

    expect(r).toHaveLength(1);
    expect(r[0].creditos).toHaveLength(1);
    expect(r[0].creditos[0].inversionista).toBe("Ana");
  });

  it("deja pasar el traspaso que SÍ se borró", () => {
    const r = excluirTraspasosSinBorrar(
      [
        {
          numeroCredito: "POOL1",
          entradas: [
            { credito: credito("POOL1"), origenBase: null },
            { credito: credito("POOL1", "Beto"), origenBase: "ORIGEN9" },
          ],
        },
      ],
      [{ numeroCredito: "ORIGEN9", status: "success" }]
    );

    expect(r[0].creditos).toHaveLength(2);
  });

  it("🔴 `not_found` SÍ pasa: no hay nada que duplicar y excluirlo perdería capital", () => {
    const r = excluirTraspasosSinBorrar(
      [
        {
          numeroCredito: "POOL1",
          entradas: [{ credito: credito("POOL1", "Beto"), origenBase: "ORIGEN9" }],
        },
      ],
      [{ numeroCredito: "ORIGEN9", status: "not_found" }]
    );

    expect(r[0].creditos).toHaveLength(1);
  });

  it("nunca toca los créditos que ya eran del pool", () => {
    // Un crédito propio del pool no depende de ningún borrado.
    const r = excluirTraspasosSinBorrar(
      [
        {
          numeroCredito: "POOL1",
          entradas: [{ credito: credito("POOL1"), origenBase: null }],
        },
      ],
      [{ numeroCredito: "POOL1", status: "error" }]
    );

    expect(r[0].creditos).toHaveLength(1);
  });

  it("si el pool queda VACÍO se saca de la lista", () => {
    // Recalcular un pool sin ningún inversionista le pondría capital 0 al
    // crédito principal: es peor que no recalcularlo.
    const r = excluirTraspasosSinBorrar(
      [
        {
          numeroCredito: "POOL1",
          entradas: [{ credito: credito("POOL1", "Beto"), origenBase: "ORIGEN9" }],
        },
      ],
      [{ numeroCredito: "ORIGEN9", status: "error" }]
    );

    expect(r).toHaveLength(0);
  });

  it("sin borrados (detalles nulo) pasa todo tal cual", () => {
    // El pool donde todos los créditos coinciden con el número base: no hubo
    // nada que borrar y `eliminarCreditos` ni se llamó.
    const r = excluirTraspasosSinBorrar(
      [
        {
          numeroCredito: "POOL1",
          entradas: [{ credito: credito("POOL1"), origenBase: null }],
        },
      ],
      null
    );

    expect(r[0].creditos).toHaveLength(1);
  });

  it("un origen sin detalle NO se asume borrado", () => {
    // Si el número no aparece en el detalle, no hay evidencia de que el borrado
    // haya ocurrido. Se excluye: ante la duda, no duplicar.
    const r = excluirTraspasosSinBorrar(
      [
        {
          numeroCredito: "POOL1",
          entradas: [
            { credito: credito("POOL1"), origenBase: null },
            { credito: credito("POOL1", "Beto"), origenBase: "ORIGEN9" },
          ],
        },
      ],
      [{ numeroCredito: "OTRO", status: "success" }]
    );

    expect(r[0].creditos).toHaveLength(1);
  });

  it("varios pools se filtran independientemente", () => {
    const r = excluirTraspasosSinBorrar(
      [
        {
          numeroCredito: "POOL1",
          entradas: [{ credito: credito("POOL1", "Beto"), origenBase: "MALO" }],
        },
        {
          numeroCredito: "POOL2",
          entradas: [{ credito: credito("POOL2", "Caro"), origenBase: "BUENO" }],
        },
      ],
      [
        { numeroCredito: "MALO", status: "error" },
        { numeroCredito: "BUENO", status: "success" },
      ]
    );

    expect(r).toHaveLength(1);
    expect(r[0].numeroCredito).toBe("POOL2");
  });
});
