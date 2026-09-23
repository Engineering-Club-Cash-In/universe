import { describe, expect, it } from "bun:test";

import { aplicarCambioDeDpi } from "./cambioDeDpi";

const DPI_VIEJO = "3460666380101";
const DPI_NUEVO = "1111111110101";

/** Registra en orden lo que se le fue pidiendo a cada servicio. */
const espia = () => {
  const pasos: string[] = [];
  return {
    pasos,
    fijar: (dpi: string) => {
      pasos.push(`cuenta:${dpi}`);
      return Promise.resolve(dpi);
    },
  };
};

describe("cambio de DPI: cuenta y lead son dos escrituras", () => {
  it("cuando el CRM acepta, la cuenta se escribe primero y nada se deshace", async () => {
    const { pasos, fijar } = espia();

    const resultado = await aplicarCambioDeDpi({
      dpiNuevo: DPI_NUEVO,
      dpiPrevioEnLaCuenta: DPI_VIEJO,
      fijarDpiDeLaCuenta: fijar,
      actualizarElLead: async () => {
        pasos.push("lead");
        return "ok";
      },
    });

    expect(resultado).toBe("ok");
    expect(pasos).toEqual([`cuenta:${DPI_NUEVO}`, "lead"]);
  });

  /**
   * 🔴 EL BUG: el CRM valida el DPI nuevo contra la mora de cartera y lo puede
   * rechazar. Antes, la cuenta ya había quedado con el DPI nuevo y el lead
   * seguía con el viejo — la misma persona con dos identidades, una por
   * servicio, y el usuario leyendo un error que decía que no cambió nada.
   */
  it("si el CRM rechaza, la cuenta vuelve al DPI anterior", async () => {
    const { pasos, fijar } = espia();
    const rechazo = new Error("El DPI corresponde a un cliente con mora");

    await expect(
      aplicarCambioDeDpi({
        dpiNuevo: DPI_NUEVO,
        dpiPrevioEnLaCuenta: DPI_VIEJO,
        fijarDpiDeLaCuenta: fijar,
        actualizarElLead: async () => {
          pasos.push("lead");
          throw rechazo;
        },
        avisar: () => {},
      })
    ).rejects.toBe(rechazo);

    expect(pasos).toEqual([
      `cuenta:${DPI_NUEVO}`,
      "lead",
      `cuenta:${DPI_VIEJO}`,
    ]);
  });

  it("el motivo que se relanza es el del CRM, aunque la reversa también falle", async () => {
    const rechazo = new Error("cartera no está disponible");
    const avisos: string[] = [];
    let intentos = 0;

    await expect(
      aplicarCambioDeDpi({
        dpiNuevo: DPI_NUEVO,
        dpiPrevioEnLaCuenta: DPI_VIEJO,
        fijarDpiDeLaCuenta: async () => {
          intentos += 1;
          if (intentos === 2) throw new Error("tampoco se pudo revertir");
          return DPI_NUEVO;
        },
        actualizarElLead: async () => {
          throw rechazo;
        },
        avisar: (mensaje) => avisos.push(mensaje),
      })
    ).rejects.toBe(rechazo);

    expect(intentos).toBe(2);
    expect(avisos).toHaveLength(1);
  });

  /**
   * La ruta de la cuenta exige un DPI válido: no admite borrarlo, así que no
   * hay a qué volver. Queda anotado en vez de desaparecer.
   */
  it("sin DPI previo no inventa una reversa, pero deja rastro", async () => {
    const { pasos, fijar } = espia();
    const rechazo = new Error("El DPI corresponde a un cliente con mora");
    const avisos: string[] = [];

    await expect(
      aplicarCambioDeDpi({
        dpiNuevo: DPI_NUEVO,
        dpiPrevioEnLaCuenta: "",
        fijarDpiDeLaCuenta: fijar,
        actualizarElLead: async () => {
          throw rechazo;
        },
        avisar: (mensaje) => avisos.push(mensaje),
      })
    ).rejects.toBe(rechazo);

    expect(pasos).toEqual([`cuenta:${DPI_NUEVO}`]);
    expect(avisos).toHaveLength(1);
  });

  it("si el DPI previo es el mismo que el nuevo, no hay nada que deshacer", async () => {
    const { pasos, fijar } = espia();
    const rechazo = new Error("cartera no está disponible");

    await expect(
      aplicarCambioDeDpi({
        dpiNuevo: DPI_NUEVO,
        dpiPrevioEnLaCuenta: DPI_NUEVO,
        fijarDpiDeLaCuenta: fijar,
        actualizarElLead: async () => {
          throw rechazo;
        },
        avisar: () => {},
      })
    ).rejects.toBe(rechazo);

    expect(pasos).toEqual([`cuenta:${DPI_NUEVO}`]);
  });
});
