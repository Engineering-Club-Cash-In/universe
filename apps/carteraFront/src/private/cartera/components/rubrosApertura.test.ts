import { describe, expect, it } from "bun:test";
import { ajustarApertura, type SesionRubros } from "./rubrosApertura";

// ─────────────────────────────────────────────────────────────────────────────
// El modal de rubros NO se desmonta entre créditos: el llamador lo deja montado
// y sólo le mueve `open` y `creditoId`. Por eso, qué crédito pinta y cuándo
// vuelve a la lista NO se puede decidir en un `useEffect`: un efecto corre
// DESPUÉS de que la render ya se pintó, así que reabrirlo en el crédito B
// alcanzaba a mostrar un cuadro con el encabezado de B y los rubros de A —y,
// como el reinicio de vista también era efecto, incluso el formulario de EDITAR
// o el HISTORIAL del rubro anterior, cargado con datos del cliente equivocado y
// listo para enviarse—.
//
// `ajustarApertura` es esa decisión, pura y sin React, para poder fijarla acá:
// `carteraFront` no tiene testing-library (ver `rubrosTiposCache.test.ts`), así
// que lo que se prueba es la función que el componente llama EN LA RENDER.
// ─────────────────────────────────────────────────────────────────────────────

const sesion = (over: Partial<SesionRubros> = {}): SesionRubros => ({
  abierta: false,
  creditoId: null,
  ...over,
});

const CRED_A = 111;
const CRED_B = 222;

describe("ajustarApertura", () => {
  it("reabrir en otro crédito pinta el crédito nuevo en la PRIMERA render", () => {
    // El corazón del defecto: cerrado sobre A, el llamador lo reabre sobre B.
    const r = ajustarApertura(sesion({ abierta: false, creditoId: CRED_A }), {
      open: true,
      creditoId: CRED_B,
    });

    expect(r.creditoVisible).toBe(CRED_B);
  });

  it("reabrir en otro crédito pide el reinicio de vista en esa misma render", () => {
    // Sin esto, el encabezado ya dice B mientras la vista sigue siendo la de A
    // —editar o historial—, que es peor que mostrar la lista vieja.
    const r = ajustarApertura(sesion({ abierta: false, creditoId: CRED_A }), {
      open: true,
      creditoId: CRED_B,
    });

    expect(r.reiniciar).toBe(true);
    expect(r.sesion).toEqual({ abierta: true, creditoId: CRED_B });
  });

  it("reabrir el MISMO crédito también reinicia la vista", () => {
    // Cerrar en "editar" y volver a entrar tiene que caer en la lista, aunque
    // el crédito no haya cambiado.
    const r = ajustarApertura(sesion({ abierta: false, creditoId: CRED_A }), {
      open: true,
      creditoId: CRED_A,
    });

    expect(r.reiniciar).toBe(true);
    expect(r.creditoVisible).toBe(CRED_A);
  });

  it("cambiar de crédito con el diálogo ABIERTO reinicia y cambia lo que se pinta", () => {
    const r = ajustarApertura(sesion({ abierta: true, creditoId: CRED_A }), {
      open: true,
      creditoId: CRED_B,
    });

    expect(r.reiniciar).toBe(true);
    expect(r.creditoVisible).toBe(CRED_B);
  });

  it("mientras se cierra retiene el último crédito", () => {
    // Para lo que existe el id retenido: `open` y `creditoId` salen del mismo
    // estado del llamador, así que al cerrar los dos cambian en el mismo commit
    // y el diálogo todavía está corriendo su animación de salida. Sin retener,
    // esos ~200ms muestran el cartel de "no se pudo identificar el crédito".
    const r = ajustarApertura(sesion({ abierta: true, creditoId: CRED_A }), {
      open: false,
      creditoId: null,
    });

    expect(r.creditoVisible).toBe(CRED_A);
    expect(r.reiniciar).toBe(false);
    expect(r.sesion).toEqual({ abierta: false, creditoId: CRED_A });
  });

  it("abrir sin crédito no hereda el anterior", () => {
    // Retener es para la salida, no para la entrada: si el llamador abre sin
    // crédito, lo que corresponde es el cartel de "no se pudo identificar", no
    // los rubros del cliente de la vez pasada.
    const r = ajustarApertura(sesion({ abierta: false, creditoId: CRED_A }), {
      open: true,
      creditoId: null,
    });

    expect(r.creditoVisible).toBeNull();
    expect(r.reiniciar).toBe(true);
  });

  it("una render estable no reinicia ni cambia la sesión", () => {
    // El componente llama a esto EN LA RENDER y hace `setState` si la sesión
    // cambió: si la función devolviera un objeto nuevo cada vez, eso sería un
    // bucle de renders.
    const actual = sesion({ abierta: true, creditoId: CRED_A });
    const r = ajustarApertura(actual, { open: true, creditoId: CRED_A });

    expect(r.reiniciar).toBe(false);
    expect(r.sesion).toBe(actual);
    expect(r.creditoVisible).toBe(CRED_A);
  });

  it("cerrado y quieto tampoco cambia nada", () => {
    const actual = sesion({ abierta: false, creditoId: CRED_A });
    const r = ajustarApertura(actual, { open: false, creditoId: null });

    expect(r.sesion).toBe(actual);
    expect(r.reiniciar).toBe(false);
    expect(r.creditoVisible).toBe(CRED_A);
  });
});
