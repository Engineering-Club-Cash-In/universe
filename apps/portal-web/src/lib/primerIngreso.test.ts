import { describe, expect, it } from "bun:test";
import { debeElegirPassword } from "./primerIngreso";

describe("debeElegirPassword", () => {
  it("pide elegir contraseña cuando la marca tiene fecha", () => {
    expect(
      debeElegirPassword({ passwordProvisionadaAt: "2026-09-07T12:00:00.000Z" }),
    ).toBe(true);
    expect(debeElegirPassword({ passwordProvisionadaAt: new Date() })).toBe(true);
  });

  it("NO le pide nada a las cuentas que ya existían", () => {
    // El caso que define la feature: la columna nace en NULL para todas las
    // cuentas anteriores a la migración, y a ninguna se le toca la contraseña.
    expect(debeElegirPassword({ passwordProvisionadaAt: null })).toBe(false);
    expect(debeElegirPassword({})).toBe(false);
    expect(debeElegirPassword(undefined)).toBe(false);
    expect(debeElegirPassword(null)).toBe(false);
  });

  it("no encierra a nadie por un valor que no es una fecha", () => {
    // Si esto devolviera `true`, la persona quedaría atrapada en la pantalla de
    // primer ingreso sin forma de salir.
    expect(debeElegirPassword({ passwordProvisionadaAt: "" })).toBe(false);
    expect(debeElegirPassword({ passwordProvisionadaAt: "   " })).toBe(false);
    expect(debeElegirPassword({ passwordProvisionadaAt: "ayer" })).toBe(false);
    expect(
      debeElegirPassword({ passwordProvisionadaAt: new Date("no-es-fecha") }),
    ).toBe(false);
    expect(
      debeElegirPassword({ passwordProvisionadaAt: true as unknown as string }),
    ).toBe(false);
  });
});
