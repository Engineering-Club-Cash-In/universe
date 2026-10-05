/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Lo único que este servicio decide es LA FORMA DEL CUERPO, y esa decisión es
 * el control: si `correo_aprobado` no va, cartera vuelve a leer la fila y la
 * ventana entre lo aprobado y lo usado sigue abierta; si va vacío, cartera
 * contesta 400 y el botón se rompe para todos.
 *
 * Por qué se mockea `@/Provider/interceptor` y no se usa el axios real: el
 * cuerpo es lo que hay que ver, no la red. El mock se registra con el mismo
 * especificador con alias que usa `services.ts` —`mock.module` de bun casa por
 * especificador, no por ruta resuelta—, y por eso el `import("./services")` va
 * DENTRO del test: si el módulo se importara arriba, se cargaría con el axios
 * de verdad antes de que el mock exista.
 */
import { describe, expect, it, mock } from "bun:test";

const enviados: { url: string; body: any }[] = [];

mock.module("@/Provider/interceptor", () => ({
  default: {
    post: async (url: string, body: any) => {
      enviados.push({ url, body });
      return { data: { message: "ok", resultados: [] } };
    },
  },
}));
// `services.ts` también lo importa; sin esto el módulo no carga.
mock.module("@/lib/apiError", () => ({ esDetalleTecnicoCrudo: () => false }));

const llamar = async (
  ids: number[],
  correo?: string | null,
): Promise<any> => {
  const { otorgarAccesoPortalService } = await import("./services");
  enviados.length = 0;
  await otorgarAccesoPortalService(ids, correo);
  return enviados[0];
};

describe("otorgarAccesoPortalService — el correo aprobado en el cuerpo", () => {
  it("manda el correo aprobado TAL CUAL se lo dieron", async () => {
    // Sin recortar ni bajar a minúsculas: el contrato dice que cartera
    // normaliza LOS DOS LADOS con el mismo `normalizeEmail`. Hacerlo también
    // acá sería una segunda definición del normalizador, que es justo cómo
    // aparece una asimetría silenciosa que veta a alguien legítimo.
    const { url, body } = await llamar([7], "Ana@Example.COM");
    expect(url).toContain("/investor/portal-access");
    expect(body).toEqual({
      inversionista_ids: [7],
      correo_aprobado: "Ana@Example.COM",
    });
  });

  it("sin correo aprobado NO manda la llave (no la manda en null)", async () => {
    // Es el camino de la EMPRESA. `correo_aprobado: null` sería aceptado por
    // cartera, pero la llave ausente es lo que dice "no había nada que
    // aprobar"; mandarla explícita invita a que alguien la llene después.
    const { body } = await llamar([7]);
    expect(body).toEqual({ inversionista_ids: [7] });
    expect(Object.hasOwn(body, "correo_aprobado")).toBe(false);
  });

  it("`null` tampoco manda la llave", async () => {
    const { body } = await llamar([7], null);
    expect(Object.hasOwn(body, "correo_aprobado")).toBe(false);
  });

  it("la cadena vacía y los espacios NO viajan como llave vacía", async () => {
    // Cartera devuelve 400 (`correo_aprobado_invalido`) ante una llave vacía,
    // a propósito. Mandarla convertiría un correo que se quedó sin valor en un
    // botón roto en vez de en un envío sin aprobación.
    for (const vacio of ["", "   ", "\t\n"]) {
      const { body } = await llamar([7], vacio);
      expect(Object.hasOwn(body, "correo_aprobado")).toBe(false);
    }
  });

  it("con correo aprobado viaja UN solo id", async () => {
    // Cartera rechaza la combinación con varios
    // (`correo_aprobado_con_varios_inversionistas`), así que el llamador que
    // aprueba un correo manda un id. Esto ancla que el servicio no agrupa.
    const { body } = await llamar([7], "ana@example.com");
    expect(body.inversionista_ids).toHaveLength(1);
  });
});
