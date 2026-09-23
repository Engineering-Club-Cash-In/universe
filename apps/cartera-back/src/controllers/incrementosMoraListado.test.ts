import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * El EXISTS que decide si una cuota ya tiene un pago APLICADO no
 * correlacionaba, y con eso el ritmo diario de la mora daba "0.00" siempre.
 *
 * Se prueba sobre el FUENTE porque el defecto vive en el SQL: cualquier doble
 * de `db` nunca ejecuta la consulta de verdad y daría verde con la condición
 * rota.
 */
describe("CONTRATO: el EXISTS del pago aplicado", () => {
  const fuente = readFileSync(
    new URL("./credits.ts", import.meta.url),
    "utf8",
  );

  it("el EXISTS del pago aplicado CALIFICA la columna de la cuota", () => {
    // `${cuotas_credito.cuota_id}` lo renderiza como `"cuota_id"` pelado, y
    // adentro del EXISTS gana el alcance interno: `pc.cuota_id = pc.cuota_id`,
    // siempre cierto. Con eso el EXISTS pasa a preguntar "¿hay ALGÚN pago
    // aplicado en toda la tabla?" —true para todas las cuotas—, ninguna cuota
    // queda elegible y el incremento da "0.00" siempre, en el listado Y en el
    // detalle.
    expect(fuente).not.toContain(
      "WHERE pc.cuota_id = ${cuotas_credito.cuota_id}",
    );
    expect(fuente).toContain(
      'WHERE pc.cuota_id = "cartera"."cuotas_credito"."cuota_id"',
    );
  });
});
