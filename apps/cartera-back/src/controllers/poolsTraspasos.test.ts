import { describe, expect, it } from "bun:test";
import { excluirTraspasosSinBorrar, poolsConTraspasoRechazado } from "./poolsTraspasos";

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

// ─────────────────────────────────────────────────────────────────────────────
// `/pools-raros` tiene DOS pasos que consumen la lista de pools, y el filtro de
// arriba sólo cubría el primero.
//
// El segundo es el de cuotas: recorre los pools y llama
// `marcarCuotasPagadasHastaNumero` y `updateInstallments` sobre el crédito
// PRINCIPAL, con el `numeroCuota` y la `cuota` del pool. Esos datos asumen que
// los traspasos entraron. Si uno se rechazó, ese paso marca cuotas del principal
// como pagadas y le sobrescribe el monto con una foto que no ocurrió — mientras
// el capital sigue en el crédito origen, que quedó vivo.
//
// Por eso se saltea el pool ENTERO si alguno de sus traspasos fue rechazado, y
// no sólo los que quedaron vacíos: la cuota del pool no es por traspaso, así que
// no hay forma de descontar "la parte" del rechazado. Conservador a propósito —
// no sobrescribir el plan de pagos del principal con datos que suponían capital
// que no se movió. El operador anula el rubro y vuelve a correr.
// ─────────────────────────────────────────────────────────────────────────────

describe("poolsConTraspasoRechazado", () => {
  it("nombra el pool cuyo traspaso fue rechazado", () => {
    const r = poolsConTraspasoRechazado(
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

    expect(r.has("POOL1")).toBe(true);
  });

  it("🔴 lo nombra aunque el pool NO quede vacío", () => {
    // Es la diferencia con el otro filtro: el pool sobrevive porque tiene
    // créditos propios, pero su cuota asumía el capital del traspaso rechazado.
    const r = poolsConTraspasoRechazado(
      [
        {
          numeroCredito: "POOL1",
          entradas: [
            { credito: credito("POOL1"), origenBase: null },
            { credito: credito("POOL1", "Beto"), origenBase: "MALO" },
            { credito: credito("POOL1", "Caro"), origenBase: "BUENO" },
          ],
        },
      ],
      [
        { numeroCredito: "MALO", status: "error" },
        { numeroCredito: "BUENO", status: "success" },
      ]
    );

    expect(r.has("POOL1")).toBe(true);
  });

  it("no nombra el pool cuyos traspasos SÍ se borraron", () => {
    const r = poolsConTraspasoRechazado(
      [
        {
          numeroCredito: "POOL1",
          entradas: [{ credito: credito("POOL1", "Beto"), origenBase: "ORIGEN9" }],
        },
      ],
      [{ numeroCredito: "ORIGEN9", status: "success" }]
    );

    expect(r.size).toBe(0);
  });

  it("`not_found` no cuenta como rechazo, igual que en el otro filtro", () => {
    const r = poolsConTraspasoRechazado(
      [
        {
          numeroCredito: "POOL1",
          entradas: [{ credito: credito("POOL1", "Beto"), origenBase: "ORIGEN9" }],
        },
      ],
      [{ numeroCredito: "ORIGEN9", status: "not_found" }]
    );

    expect(r.size).toBe(0);
  });

  it("un pool SIN traspasos nunca se saltea", () => {
    const r = poolsConTraspasoRechazado(
      [{ numeroCredito: "POOL1", entradas: [{ credito: credito("POOL1"), origenBase: null }] }],
      [{ numeroCredito: "POOL1", status: "error" }]
    );

    expect(r.size).toBe(0);
  });

  it("sin borrados no hay nada que saltear", () => {
    const r = poolsConTraspasoRechazado(
      [{ numeroCredito: "POOL1", entradas: [{ credito: credito("POOL1"), origenBase: "X" }] }],
      null
    );

    // Sin detalle no hay evidencia de que el borrado ocurriera, así que el
    // traspaso NO entra al recálculo — y el pool tampoco toca cuotas.
    expect(r.has("POOL1")).toBe(true);
  });

  it("separa pools: uno se saltea y el otro no", () => {
    const r = poolsConTraspasoRechazado(
      [
        { numeroCredito: "POOL1", entradas: [{ credito: credito("POOL1"), origenBase: "MALO" }] },
        { numeroCredito: "POOL2", entradas: [{ credito: credito("POOL2"), origenBase: "BUENO" }] },
      ],
      [
        { numeroCredito: "MALO", status: "error" },
        { numeroCredito: "BUENO", status: "success" },
      ]
    );

    expect([...r]).toEqual(["POOL1"]);
  });
});
