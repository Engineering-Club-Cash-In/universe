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
