import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * El envío masivo solo trae el detalle de cartera-back si la plantilla usa
 * alguna de las variables que salen de ese detalle. Las tres —{montoAdeudado},
 * {incrementoDiarioMora} y {incrementoMaximoMensualMora}— se ofrecen por
 * separado en el modal, así que el gate tiene que mirar las tres: con menos,
 * una plantilla editada que use nada más una de ellas se quedaría sin datos y
 * la cláusula desaparecería en silencio, sin error visible.
 *
 * Es un test de contrato sobre el fuente porque ese camino depende de la base y
 * del cliente HTTP de cartera-back, y no hay forma barata de ejercitarlo.
 */
const fuente = readFileSync(
  new URL("./cobros.ts", import.meta.url).pathname,
  "utf8",
);

/** La condición que decide si se carga el detalle, acotada a su `if`. */
function condicionDelGate(): string {
  const ancla = fuente.indexOf("const CONCURRENCIA_DETALLE");
  expect(ancla).toBeGreaterThan(-1);
  const abre = fuente.lastIndexOf("if (", ancla);
  expect(abre).toBeGreaterThan(-1);
  return fuente.slice(abre, ancla);
}

describe("envío masivo — el gate que carga el detalle de cartera-back", () => {
  test("se dispara con {montoAdeudado}", () => {
    expect(condicionDelGate()).toContain('cuerpoBase.includes("{montoAdeudado}")');
  });

  test("se dispara también con {incrementoDiarioMora} solo", () => {
    expect(condicionDelGate()).toContain(
      'cuerpoBase.includes("{incrementoDiarioMora}")',
    );
  });

  test("se dispara también con {incrementoMaximoMensualMora} solo", () => {
    expect(condicionDelGate()).toContain(
      'cuerpoBase.includes("{incrementoMaximoMensualMora}")',
    );
  });

  test("las condiciones son alternativas, no exigencias simultáneas", () => {
    expect(condicionDelGate()).toContain("||");
  });
});

/**
 * Traer el detalle no alcanza: si cartera no pudo calcular el aumento y la
 * plantilla lo menciona con un placeholder suelto, el mensaje sale con el
 * hueco ("El saldo aumenta Q diario"). El envío tiene que descartarse con
 * motivo, igual que con {montoAdeudado}.
 */
describe("envío masivo — el gate que descarta el aumento de mora sin dato", () => {
  /** El bloque del gate, desde la llamada. */
  function bloqueDelGate(largo: number): string {
    const inicio = fuente.indexOf(
      "const incremento = prepararIncrementoMoraParaEnvio(",
    );
    expect(inicio).toBeGreaterThan(-1);
    return fuente.slice(inicio, inicio + largo);
  }

  test("pasa las dos cifras del detalle de cartera", () => {
    expect(bloqueDelGate(400)).toContain("detalleCartera?.incrementoDiarioMora");
    expect(bloqueDelGate(400)).toContain(
      "detalleCartera?.incrementoMaximoMensualMora",
    );
  });

  test("si no se puede enviar, el crédito se descarta con su motivo", () => {
    const bloque = bloqueDelGate(700);
    expect(bloque).toContain("if (!incremento.enviar)");
    expect(bloque).toContain("motivo: incremento.motivo,");
    expect(bloque).toContain("continue;");
  });

  test("el mensaje usa las cifras que pasaron por el gate, no las crudas", () => {
    expect(fuente).toContain(
      "incrementoDiarioMora: incremento.incrementoDiarioMora,",
    );
    expect(fuente).toContain(
      "incrementoMaximoMensualMora: incremento.incrementoMaximoMensualMora,",
    );
  });
});
