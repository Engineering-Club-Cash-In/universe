import { describe, expect, it } from "bun:test";

import {
  mensajeDeDpiPendiente,
  mensajeDeWhatsAppPorDpiPendiente,
  registroQuedoSinDpi,
} from "./registroSinDpi";

describe("registroQuedoSinDpi", () => {
  // EL BUG: el CRM contesta 200 cuando reconoce un lead que ventas abrió sin
  // DPI, y el servidor a propósito NO escribe el DPI en la cuenta. La respuesta
  // vuelve con `identity.dpi` en null y el formulario la tiraba: llamaba a
  // `onSuccess()` igual, la página recargaba, `!user.dpi` seguía siendo cierto y
  // volvía a salir el mismo formulario. Bucle infinito y mudo.
  it("detecta que la cuenta se quedó sin DPI cuando el servidor lo dice", () => {
    expect(
      registroQuedoSinDpi({
        success: true,
        message: "ok",
        userType: "CLIENT",
        identity: { dpi: null, role: "CLIENT" },
      }),
    ).toBe(true);
  });

  it("trata un DPI en blanco igual que uno ausente", () => {
    for (const dpi of ["", "   "]) {
      expect(
        registroQuedoSinDpi({
          success: true,
          message: "ok",
          userType: "CLIENT",
          identity: { dpi, role: "CLIENT" },
        }),
      ).toBe(true);
    }
  });

  // El caso normal: el registro sí escribió el DPI. Sigue el camino de éxito.
  it("deja pasar el registro que sí dejó DPI en la cuenta", () => {
    expect(
      registroQuedoSinDpi({
        success: true,
        message: "ok",
        userType: "CLIENT",
        identity: { dpi: "1234567890123", role: "CLIENT" },
      }),
    ).toBe(false);
  });

  // LA TRAMPA que hay que no repetir del lado del cliente: mirar
  // `dpiRegistradoEnLead` en vez de `identity.dpi`. La bandera solo la emite el
  // camino de CLIENT contra el CRM; el de INVESTOR y las altas nuevas no dicen
  // nada (`undefined`), y un `dpiRegistradoEnLead !== true` mandaría a TODOS
  // ellos a la pantalla de callejón sin salida.
  it("no confunde 'nadie dijo nada' con 'no se registró el DPI'", () => {
    expect(
      registroQuedoSinDpi({
        success: true,
        message: "ok",
        userType: "INVESTOR",
        identity: { dpi: "1234567890123", role: "INVESTOR" },
      }),
    ).toBe(false);
  });

  // `identity.dpi` es el DPI VIGENTE en la cuenta, no solo el que escribió esta
  // llamada. Si un intento anterior ya lo dejó puesto, el registro está
  // completo aunque el CRM vuelva a decir que él no lo guardó.
  it("no marca pendiente si la cuenta ya traía DPI de un intento anterior", () => {
    expect(
      registroQuedoSinDpi({
        success: true,
        message: "ok",
        userType: "CLIENT",
        dpiRegistradoEnLead: false,
        identity: { dpi: "1234567890123", role: "CLIENT" },
      }),
    ).toBe(false);
  });

  // Desfase de despliegue: si portal-web sale antes que auth-google, la
  // respuesta no trae `identity`. Sin este fallback el formulario dejaría en
  // "pendiente" a TODO el mundo. Se comporta como antes.
  it("cae al comportamiento anterior si el servidor no manda la identidad", () => {
    expect(
      registroQuedoSinDpi({ success: true, message: "ok", userType: "CLIENT" }),
    ).toBe(false);
    expect(registroQuedoSinDpi(null)).toBe(false);
    expect(registroQuedoSinDpi(undefined)).toBe(false);
  });
});

describe("mensajeDeDpiPendiente", () => {
  // Reintentar es inútil por construcción: solo un humano del equipo puede
  // poner ese DPI en la ficha. El texto tiene que decirlo, nombrar el correo
  // con el que ubicarla, y no soltar jerga interna.
  it("dice que ya hay acceso, que no sirve reintentar y con qué correo ubicarla", () => {
    const mensaje = mensajeDeDpiPendiente("ana@example.com");

    expect(mensaje).toContain("ana@example.com");
    expect(mensaje.toLowerCase()).toContain("asesor");
    expect(mensaje.toLowerCase()).toContain("recarga");
  });

  it("no filtra jerga interna", () => {
    const mensaje = mensajeDeDpiPendiente("ana@example.com").toLowerCase();

    for (const jerga of ["crm", "lead", "dpiregistradoenlead", "identity", "null"]) {
      expect(mensaje).not.toContain(jerga);
    }
  });

  it("sigue diciendo algo útil sin correo", () => {
    expect(mensajeDeDpiPendiente("").toLowerCase()).toContain("asesor");
  });
});

describe("mensajeDeWhatsAppPorDpiPendiente", () => {
  it("prellena el correo para que soporte ubique la ficha", () => {
    expect(mensajeDeWhatsAppPorDpiPendiente("ana@example.com")).toContain(
      "ana@example.com",
    );
  });

  it("no queda vacío sin correo", () => {
    expect(mensajeDeWhatsAppPorDpiPendiente("").trim().length).toBeGreaterThan(0);
  });
});
