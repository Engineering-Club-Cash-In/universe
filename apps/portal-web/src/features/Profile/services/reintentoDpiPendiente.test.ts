import { describe, expect, it } from "bun:test";

import {
  accionDeReintento,
  dpiCompleto,
} from "./reintentoDpiPendiente";

describe("accionDeReintento", () => {
  // EL BUG: cuando el registro cae en "quedó sin DPI", el formulario se cierra
  // para siempre (`if (pendiente) return;`). El aviso sobrevive a la recarga y
  // la cuenta sigue sin DPI, así que se restaura y vuelve a bloquear. Pero lo
  // que se está esperando —que un asesor complete la ficha en el CRM— NO toca
  // `auth-google.users.dpi`: la única llamada capaz de copiar ese DPI a la
  // cuenta es justo la que quedó bloqueada. Nadie sale de ahí nunca.
  it("con el DPI a la mano, reenvía", () => {
    expect(accionDeReintento("1234567890123")).toBe("reenviar");
  });

  // Tras una recarga el aviso vuelve, pero lo que la persona escribió no: el
  // DPI vive en el estado del formulario. Reenviar así reventaría contra la
  // validación local ("El DPI debe tener 13 dígitos"), en rojo, echándole la
  // culpa por un campo que ella no ve.
  it("tras una recarga, sin DPI en el formulario, lo vuelve a pedir", () => {
    expect(accionDeReintento("")).toBe("pedir-dpi");
  });

  it("con el DPI a medias lo vuelve a pedir", () => {
    expect(accionDeReintento("123456789012")).toBe("pedir-dpi");
  });

  it("no cuenta los espacios como dígitos", () => {
    expect(accionDeReintento(" 123456789012")).toBe("pedir-dpi");
  });
});

describe("dpiCompleto", () => {
  // La misma regla que decide el reintento decide el envío y el estilo del
  // botón: si se separan, el botón deja mandar algo que el reintento considera
  // incompleto.
  it("exige 13 dígitos", () => {
    expect(dpiCompleto("1234567890123")).toBe(true);
    expect(dpiCompleto("123456789012")).toBe(false);
    expect(dpiCompleto("12345678901234")).toBe(false);
    expect(dpiCompleto("")).toBe(false);
  });
});
