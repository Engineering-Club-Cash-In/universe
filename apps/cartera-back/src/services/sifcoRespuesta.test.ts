import { describe, expect, it } from "bun:test";
import { exigirRespuestaExitosa } from "./sifcoRespuesta";

/**
 * El guard que evita que una caída de la pasarela se lea como "este cliente no
 * tiene nada" — y con eso, como "no tiene mora".
 *
 * ⚠️ Es defensa en profundidad: hoy la pasarela responde 400 ante un fallo
 * (`clientes.routes.ts` usa `status: result.success ? 200 : 400`) y axios ya
 * lanza por el status antes de llegar acá. Se prueba igual porque es lo único
 * que protege el día que alguna ruta devuelva 200 con `success: false`, y
 * porque sin test nada impide borrarlo.
 */
describe("exigirRespuestaExitosa", () => {
  it("lanza cuando la pasarela contesta success: false, con el contexto y el error", () => {
    expect(() =>
      exigirRespuestaExitosa(
        { success: false, error: "cliente inexistente", statusCode: 200 },
        "SIFCO no pudo listar los préstamos del cliente 8782",
      ),
    ).toThrow(
      "SIFCO no pudo listar los préstamos del cliente 8782: cliente inexistente",
    );
  });

  it("lanza con un texto legible aunque la pasarela no explique el fallo", () => {
    expect(() =>
      exigirRespuestaExitosa(
        { success: false, statusCode: 200 },
        "SIFCO no pudo resolver la identificación",
      ),
    ).toThrow("SIFCO no pudo resolver la identificación: respuesta sin éxito");
  });

  it("🔴 lanza aunque el cuerpo traiga una lista vacía: vacío ≠ fallo", () => {
    // El caso exacto del fail-open: `success: false` con `data: []` se leería
    // como "sin préstamos" si solo se mirara `data`.
    expect(() =>
      exigirRespuestaExitosa(
        { success: false, data: [], statusCode: 200 },
        "SIFCO no pudo listar los préstamos del cliente 1",
      ),
    ).toThrow();
  });

  it("deja pasar el dato cuando la consulta salió bien", () => {
    expect(
      exigirRespuestaExitosa({ success: true, data: [1, 2], statusCode: 200 }, "x"),
    ).toEqual([1, 2]);
  });

  it("un éxito sin datos devuelve undefined en vez de lanzar", () => {
    // Un cliente que de verdad no tiene préstamos: es una respuesta válida y
    // NO debe confundirse con un fallo.
    expect(exigirRespuestaExitosa({ success: true, statusCode: 200 }, "x")).toBeUndefined();
  });
});
