import { describe, expect, it } from "bun:test";

import {
  CLAVE_DEL_AVISO,
  avisoDpiPendienteVigente,
  olvidarDpiPendiente,
  recordarDpiPendiente,
  recordarSiQuedoSinDpi,
} from "./avisoDpiPendiente";

const almacenFalso = (inicial: Record<string, string> = {}) => {
  const datos = new Map(Object.entries(inicial));

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

describe("avisoDpiPendienteVigente", () => {
  // EL BUG: el estado pendiente solo vivía en el estado de React. Una recarga
  // —o volver al perfil— lo borraba, y como la cuenta sigue siendo CLIENT y sin
  // DPI, `Profile.tsx` volvía a sacar el formulario en blanco, sin el aviso y
  // dejando reenviar el mismo DPI para nada.
  it("sobrevive a la recarga mientras la cuenta siga sin DPI", () => {
    const almacen = almacenFalso();

    recordarDpiPendiente(
      { correo: "ana@example.com", tipoSolicitado: "CLIENT" },
      almacen,
    );

    expect(
      avisoDpiPendienteVigente({
        usuario: { email: "ana@example.com", dpi: null },
        almacen,
      }),
    ).toEqual({ correo: "ana@example.com", tipoSolicitado: "CLIENT" });
  });

  // EL CICLO DE VIDA: un aviso que no se va cuando el problema se resolvió es
  // peor que no tenerlo. Quien lo apaga es el SERVIDOR —el DPI que el asesor
  // puso, que llega en la sesión—, no un botón ni un plazo.
  it("se apaga solo en cuanto la cuenta ya tiene DPI", () => {
    const almacen = almacenFalso();

    recordarDpiPendiente(
      { correo: "ana@example.com", tipoSolicitado: "CLIENT" },
      almacen,
    );

    expect(
      avisoDpiPendienteVigente({
        usuario: { email: "ana@example.com", dpi: "1234567890123" },
        almacen,
      }),
    ).toBeNull();
    // Y no queda pegado para la próxima visita.
    expect(almacen.tiene()).toBe(false);
  });

  it("no se le muestra a otra cuenta del mismo navegador", () => {
    const almacen = almacenFalso();

    recordarDpiPendiente(
      { correo: "ana@example.com", tipoSolicitado: "CLIENT" },
      almacen,
    );

    expect(
      avisoDpiPendienteVigente({
        usuario: { email: "beto@example.com", dpi: null },
        almacen,
      }),
    ).toBeNull();
    expect(almacen.tiene()).toBe(false);
  });

  it("compara el correo sin castigar mayúsculas ni espacios", () => {
    const almacen = almacenFalso();

    recordarDpiPendiente(
      { correo: "Ana@Example.com ", tipoSolicitado: "INVESTOR" },
      almacen,
    );

    expect(
      avisoDpiPendienteVigente({
        usuario: { email: "ana@example.com", dpi: "" },
        almacen,
      }),
    ).toEqual({ correo: "Ana@Example.com", tipoSolicitado: "INVESTOR" });
  });

  // La sesión tarda en resolverse: mientras no se sabe de quién es la pantalla,
  // el aviso no se muestra pero TAMPOCO se tira, o el primer render lo borraría
  // antes de que nadie lo vea.
  it("no borra el aviso mientras la sesión no se ha resuelto", () => {
    const almacen = almacenFalso();

    recordarDpiPendiente(
      { correo: "ana@example.com", tipoSolicitado: "CLIENT" },
      almacen,
    );

    expect(avisoDpiPendienteVigente({ usuario: null, almacen })).toBeNull();
    expect(almacen.tiene()).toBe(true);
  });

  it("no inventa un aviso donde nunca lo hubo", () => {
    const almacen = almacenFalso();

    expect(
      avisoDpiPendienteVigente({
        usuario: { email: "ana@example.com", dpi: null },
        almacen,
      }),
    ).toBeNull();
  });

  // Es una señal del cliente: la persona (o cualquier cosa) puede dejarla
  // rota. Basura no puede tumbar el perfil ni quedarse ahí.
  it("descarta una señal corrupta sin reventar", () => {
    const almacen = almacenFalso({ [CLAVE_DEL_AVISO]: "{no es json" });

    expect(
      avisoDpiPendienteVigente({
        usuario: { email: "ana@example.com", dpi: null },
        almacen,
      }),
    ).toBeNull();
    expect(almacen.tiene()).toBe(false);
  });

  it("olvidar deja limpio el almacén", () => {
    const almacen = almacenFalso();

    recordarDpiPendiente(
      { correo: "ana@example.com", tipoSolicitado: "CLIENT" },
      almacen,
    );
    olvidarDpiPendiente(almacen);

    expect(almacen.tiene()).toBe(false);
  });

  // Sin `window` (o con el almacenamiento bloqueado) el portal tiene que
  // seguir funcionando: el aviso se pierde, nada más.
  it("no revienta cuando no hay almacenamiento", () => {
    expect(() =>
      recordarDpiPendiente(
        { correo: "ana@example.com", tipoSolicitado: "CLIENT" },
        null,
      ),
    ).not.toThrow();
    expect(
      avisoDpiPendienteVigente({
        usuario: { email: "ana@example.com", dpi: null },
        almacen: null,
      }),
    ).toBeNull();
  });
});

describe("recordarSiQuedoSinDpi", () => {
  it("deja constancia del registro que salió 200 sin DPI", () => {
    const almacen = almacenFalso();

    const pendiente = recordarSiQuedoSinDpi({
      respuesta: {
        success: true,
        message: "ok",
        userType: "CLIENT",
        identity: { dpi: null, role: "CLIENT" },
      },
      correo: "ana@example.com",
      tipoSolicitado: "CLIENT",
      almacen,
    });

    expect(pendiente).toBe(true);
    expect(
      avisoDpiPendienteVigente({
        usuario: { email: "ana@example.com", dpi: null },
        almacen,
      }),
    ).toEqual({ correo: "ana@example.com", tipoSolicitado: "CLIENT" });
  });

  it("el registro que sí dejó DPI sigue de largo y borra el aviso viejo", () => {
    const almacen = almacenFalso();

    recordarDpiPendiente(
      { correo: "ana@example.com", tipoSolicitado: "CLIENT" },
      almacen,
    );

    const pendiente = recordarSiQuedoSinDpi({
      respuesta: {
        success: true,
        message: "ok",
        userType: "CLIENT",
        identity: { dpi: "1234567890123", role: "CLIENT" },
      },
      correo: "ana@example.com",
      tipoSolicitado: "CLIENT",
      almacen,
    });

    expect(pendiente).toBe(false);
    expect(almacen.tiene()).toBe(false);
  });

  // LA REGLA CRÍTICA, ahora también en el tercer camino (registro por correo):
  // el corte va contra `identity.dpi`, NUNCA contra `dpiRegistradoEnLead`.
  // "Nadie dijo nada" (undefined: alta nueva o camino INVESTOR) NO es "no se
  // registró el DPI"; tratarlo así mandaría a TODOS ellos al callejón sin
  // salida.
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

  // Desfase de despliegue: portal-web fuera antes que auth-google y la
  // respuesta sin `identity`. Se comporta como antes: sigue al perfil.
  it("sigue de largo si el servidor no manda la identidad", () => {
    const almacen = almacenFalso();

    expect(
      recordarSiQuedoSinDpi({
        respuesta: { success: true, message: "ok", userType: "CLIENT" },
        correo: "ana@example.com",
        tipoSolicitado: "CLIENT",
        almacen,
      }),
    ).toBe(false);
    expect(almacen.tiene()).toBe(false);
  });
});
