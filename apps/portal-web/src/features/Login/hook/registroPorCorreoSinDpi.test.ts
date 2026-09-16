/**
 * El tercer camino: registro por correo/contraseña (`useRegister`).
 *
 * Los otros dos —el callback de Google y el formulario de completar perfil— ya
 * tratan el 200 que no dejó DPI. Este lo descartaba: llamaba a
 * `register-external-auth`, tiraba el resultado y navegaba al perfil como si el
 * registro hubiera terminado. La persona aterrizaba en OTRO formulario de DPI
 * en blanco, sin la explicación ni la salida por soporte, y reenviaba el mismo
 * valor solo para descubrir que hace falta que intervenga un asesor.
 *
 * La decisión se toma con el MISMO módulo que los otros dos caminos
 * (`registroSinDpi` vía `recordarSiQuedoSinDpi`); estas pruebas fijan el
 * contrato desde el punto de vista de este camino, incluida la regla que no se
 * puede perder: el corte va contra `identity.dpi`, nunca contra
 * `dpiRegistradoEnLead`.
 */

import { describe, expect, it } from "bun:test";

import {
  CLAVE_DEL_AVISO,
  avisoDpiPendienteVigente,
  recordarSiQuedoSinDpi,
} from "../../Profile/services/avisoDpiPendiente";

const almacenFalso = () => {
  const datos = new Map<string, string>();

  return {
    getItem: (clave: string) => datos.get(clave) ?? null,
    setItem: (clave: string, valor: string) => {
      datos.set(clave, valor);
    },
    removeItem: (clave: string) => {
      datos.delete(clave);
    },
    tiene: () => datos.has(CLAVE_DEL_AVISO),
  };
};

/**
 * Lo que hace `useRegister` tras un `register-external-auth` que no lanzó:
 * dejar constancia si quedó sin DPI y navegar al perfil. Navega en los dos
 * casos a propósito —la cuenta existe y la persona ya tiene acceso—; lo que
 * cambia es que el perfil la reciba con el aviso en vez de con un formulario
 * mudo.
 */
const registroPorCorreo = (
  respuesta: Parameters<typeof recordarSiQuedoSinDpi>[0]["respuesta"],
  almacen: ReturnType<typeof almacenFalso>,
) =>
  recordarSiQuedoSinDpi({
    respuesta,
    correo: "ana@example.com",
    tipoSolicitado: "CLIENT",
    almacen,
  });

describe("registro por correo que quedó sin DPI", () => {
  it("el perfil recibe a la persona con la explicación, no con otro formulario en blanco", () => {
    const almacen = almacenFalso();

    expect(
      registroPorCorreo(
        {
          success: true,
          message: "ok",
          userType: "CLIENT",
          identity: { dpi: null, role: "CLIENT" },
        },
        almacen,
      ),
    ).toBe(true);

    expect(
      avisoDpiPendienteVigente({
        usuario: { email: "ana@example.com", dpi: null },
        almacen,
      }),
    ).toEqual({ correo: "ana@example.com", tipoSolicitado: "CLIENT" });
  });

  it("el registro completo no deja ningún aviso detrás", () => {
    const almacen = almacenFalso();

    expect(
      registroPorCorreo(
        {
          success: true,
          message: "ok",
          userType: "CLIENT",
          identity: { dpi: "1234567890123", role: "CLIENT" },
        },
        almacen,
      ),
    ).toBe(false);
    expect(almacen.tiene()).toBe(false);
  });

  // LA REGLA CRÍTICA en el tercer camino: "nadie dijo nada" (`undefined`: alta
  // nueva o camino INVESTOR, que no pasa por el CRM) NO es "no se registró el
  // DPI". Cortar por `dpiRegistradoEnLead !== true` mandaría a TODOS esos
  // registros —que sí quedaron completos— a una pantalla sin salida.
  it("no confunde 'nadie dijo nada' con 'no se registró el DPI'", () => {
    const almacen = almacenFalso();

    expect(
      recordarSiQuedoSinDpi({
        respuesta: {
          success: true,
          message: "ok",
          userType: "INVESTOR",
          identity: { dpi: "1234567890123", role: "INVESTOR" },
        },
        correo: "ana@example.com",
        tipoSolicitado: "INVESTOR",
        almacen,
      }),
    ).toBe(false);
    expect(almacen.tiene()).toBe(false);
  });

  // `dpiRegistradoEnLead: false` con un DPI ya puesto en la cuenta (lo dejó un
  // intento anterior) tampoco es pendiente: manda `identity.dpi`.
  it("no marca pendiente si la cuenta ya traía DPI de un intento anterior", () => {
    const almacen = almacenFalso();

    expect(
      registroPorCorreo(
        {
          success: true,
          message: "ok",
          userType: "CLIENT",
          dpiRegistradoEnLead: false,
          identity: { dpi: "1234567890123", role: "CLIENT" },
        },
        almacen,
      ),
    ).toBe(false);
  });

  it("un servidor viejo sin `identity` sigue de largo, como antes", () => {
    const almacen = almacenFalso();

    expect(
      registroPorCorreo(
        { success: true, message: "ok", userType: "CLIENT" },
        almacen,
      ),
    ).toBe(false);
    expect(almacen.tiene()).toBe(false);
  });
});
