import { describe, expect, it } from "bun:test";
import { APIError } from "better-auth/api";
import {
  exigirPasswordDistintaALaActual,
  type ContextoDePassword,
  type CuentaConPassword,
} from "./passwordDistinta";

const HASH = "hash-de-la-actual";
const ACTUAL = "la-que-tiene-puesta";

/**
 * Un `ctx` de Better Auth reducido a lo único que la regla toca: las cuentas
 * de la persona y el verificador de contraseñas. `verify` es el de verdad en
 * miniatura: dice que sí solo cuando el hash es el de la cuenta y el texto es
 * la contraseña que está puesta.
 */
const contextoCon = (
  cuentas: CuentaConPassword[],
): ContextoDePassword & { verificaciones: string[] } => {
  const verificaciones: string[] = [];

  return {
    verificaciones,
    context: {
      internalAdapter: {
        findAccounts: async () => cuentas,
      },
      password: {
        verify: async ({ hash, password }) => {
          verificaciones.push(password);
          return hash === HASH && password === ACTUAL;
        },
      },
    },
  };
};

const conCredencial = () =>
  contextoCon([{ providerId: "credential", password: HASH }]);

describe("exigirPasswordDistintaALaActual — camino del enlace", () => {
  it("rechaza repetir la contraseña que ya está puesta", async () => {
    const ctx = conCredencial();

    await expect(
      exigirPasswordDistintaALaActual(ctx, "usr_1", ACTUAL, { via: "enlace" }),
    ).rejects.toBeInstanceOf(APIError);
  });

  it("deja pasar una contraseña nueva de verdad", async () => {
    const ctx = conCredencial();

    await exigirPasswordDistintaALaActual(ctx, "usr_1", "otra-distinta", {
      via: "enlace",
    });
  });

  it("no le exige nada a quien entra por Google y todavía no tiene contraseña", async () => {
    const ctx = contextoCon([{ providerId: "google" }]);

    await exigirPasswordDistintaALaActual(ctx, "usr_1", ACTUAL, {
      via: "enlace",
    });
    expect(ctx.verificaciones).toEqual([]);
  });
});

describe("exigirPasswordDistintaALaActual — camino de la sesión", () => {
  it("rechaza repetir la contraseña cuando quien pide SÍ sabe la actual", async () => {
    const ctx = conCredencial();

    await expect(
      exigirPasswordDistintaALaActual(ctx, "usr_1", ACTUAL, {
        via: "sesion",
        actual: ACTUAL,
      }),
    ).rejects.toBeInstanceOf(APIError);
  });

  it("no delata la contraseña a quien solo tiene la cookie de sesión", async () => {
    // El oráculo. Con una sesión robada —y el registro es abierto y el correo
    // no se verifica, así que conseguir una es gratis— alguien que NO sabe la
    // contraseña la va probando en `newPassword`. Si esta regla contesta
    // "tiene que ser distinta" cuando acierta, ese error es la respuesta:
    // acertó, sin haber sabido nunca la actual. Callar aquí deja que conteste
    // Better Auth, y contesta lo mismo —contraseña actual incorrecta— haya
    // acertado o no.
    const ctx = conCredencial();

    await exigirPasswordDistintaALaActual(ctx, "usr_1", ACTUAL, {
      via: "sesion",
      actual: "no-es-la-suya",
    });

    // Y no llega ni a compararla: la nueva no se verifica contra el hash.
    expect(ctx.verificaciones).not.toContain(ACTUAL);
  });

  it("calla también cuando no viene contraseña actual", async () => {
    const ctx = conCredencial();

    await exigirPasswordDistintaALaActual(ctx, "usr_1", ACTUAL, {
      via: "sesion",
      actual: undefined,
    });
    await exigirPasswordDistintaALaActual(ctx, "usr_1", ACTUAL, {
      via: "sesion",
      actual: "",
    });
    await exigirPasswordDistintaALaActual(ctx, "usr_1", ACTUAL, {
      via: "sesion",
      actual: 42,
    });

    expect(ctx.verificaciones).not.toContain(ACTUAL);
  });
});
