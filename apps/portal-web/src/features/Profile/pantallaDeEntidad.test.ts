import { describe, expect, it } from "bun:test";

import { pantallaDeEntidad } from "./pantallaDeEntidad";

describe("pantallaDeEntidad", () => {
  // EL BUG: `/api/cartera/entidades` puede responder 200 con `[]` (un usuario
  // INVESTOR que todavía no está atado a ninguna ficha). Ahí no hay carga ni
  // error, así que el perfil se pintaba entero: "Perfil Incompleto" en blanco y
  // los botones de editar banco. Cada uno de esos botones reventaba con "No se
  // pudo identificar la entidad a actualizar"
  // (MyProfile/ModalConfirmChange.tsx:60), porque no hay entidad que actualizar.
  it("con la lista vacía manda a la pantalla de 'sin entidades', no al contenido", () => {
    expect(
      pantallaDeEntidad({
        cargando: false,
        hayError: false,
        sinEntidades: true,
      }),
    ).toBe("sin-entidades");
  });

  it("sin entidades y con la consulta caída gana el error", () => {
    // "No pudimos cargar esto" y "tu usuario no está vinculado" son afirmaciones
    // distintas: la segunda manda a la persona a llamar a su asesor por algo que
    // puede ser una caída de red.
    expect(
      pantallaDeEntidad({
        cargando: false,
        hayError: true,
        sinEntidades: true,
      }),
    ).toBe("error");
  });

  it("mientras carga no afirma nada todavía", () => {
    expect(
      pantallaDeEntidad({
        cargando: true,
        hayError: true,
        sinEntidades: true,
      }),
    ).toBe("cargando");
  });

  it("con error y sin entidades resueltas muestra el error", () => {
    expect(
      pantallaDeEntidad({
        cargando: false,
        hayError: true,
        sinEntidades: false,
      }),
    ).toBe("error");
  });

  it("con entidades muestra el contenido", () => {
    expect(
      pantallaDeEntidad({
        cargando: false,
        hayError: false,
        sinEntidades: false,
      }),
    ).toBe("contenido");
  });
});
