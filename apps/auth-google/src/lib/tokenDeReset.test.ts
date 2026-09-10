import { describe, expect, it } from "bun:test";
import { tokenDeResetVigente } from "./tokenDeReset";

const AHORA = new Date("2026-09-07T12:00:00.000Z");

describe("tokenDeResetVigente", () => {
  it("acepta el enlace que todavía no vence", () => {
    expect(
      tokenDeResetVigente(
        { value: "usr_1", expiresAt: new Date("2026-09-08T12:00:00.000Z") },
        AHORA,
      ),
    ).toBeTrue();
    expect(
      tokenDeResetVigente(
        { value: "usr_1", expiresAt: "2026-09-08T12:00:00.000Z" },
        AHORA,
      ),
    ).toBeTrue();
  });

  // El caso que importa: con la fila vencida dada por buena, mandar un enlace
  // viejo mataba el enlace NUEVO que esa persona acababa de pedir.
  it("rechaza el enlace vencido aunque su fila siga existiendo", () => {
    expect(
      tokenDeResetVigente(
        { value: "usr_1", expiresAt: new Date("2026-09-07T11:59:59.000Z") },
        AHORA,
      ),
    ).toBeFalse();
  });

  it("rechaza lo que no es una fila utilizable", () => {
    expect(tokenDeResetVigente(null, AHORA)).toBeFalse();
    expect(tokenDeResetVigente(undefined, AHORA)).toBeFalse();
    expect(tokenDeResetVigente({ value: "", expiresAt: new Date() }, AHORA)).toBeFalse();
    expect(tokenDeResetVigente({ value: "usr_1" }, AHORA)).toBeFalse();
    expect(
      tokenDeResetVigente({ value: "usr_1", expiresAt: "cualquier cosa" }, AHORA),
    ).toBeFalse();
  });
});
