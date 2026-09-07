import { describe, expect, it } from "bun:test";
import { sigueConLaPasswordQueLeDimos } from "./passwordProvisionada";

describe("sigueConLaPasswordQueLeDimos", () => {
  it("reconoce la cuenta que todavía usa la contraseña que generamos", () => {
    expect(
      sigueConLaPasswordQueLeDimos({
        passwordProvisionadaAt: "2026-09-07T12:00:00.000Z",
      }),
    ).toBeTrue();
    expect(
      sigueConLaPasswordQueLeDimos({ passwordProvisionadaAt: new Date() }),
    ).toBeTrue();
  });

  it("deja en paz a las cuentas que ya existían", () => {
    // La columna nace NULL para todas las cuentas anteriores a la migración, y
    // a ninguna se le pide cambiar nada. Si esto devolviera `true`, el 403 de
    // `requireAuth` dejaría a TODO el portal fuera de cartera, CRM y perfil.
    expect(
      sigueConLaPasswordQueLeDimos({ passwordProvisionadaAt: null }),
    ).toBeFalse();
    expect(sigueConLaPasswordQueLeDimos({})).toBeFalse();
    expect(sigueConLaPasswordQueLeDimos(null)).toBeFalse();
    expect(sigueConLaPasswordQueLeDimos(undefined)).toBeFalse();
  });

  it("no deja a nadie fuera por un valor que no es una fecha", () => {
    expect(
      sigueConLaPasswordQueLeDimos({ passwordProvisionadaAt: "" }),
    ).toBeFalse();
    expect(
      sigueConLaPasswordQueLeDimos({ passwordProvisionadaAt: "   " }),
    ).toBeFalse();
    expect(
      sigueConLaPasswordQueLeDimos({ passwordProvisionadaAt: "ayer" }),
    ).toBeFalse();
    expect(
      sigueConLaPasswordQueLeDimos({
        passwordProvisionadaAt: new Date("no-es-fecha"),
      }),
    ).toBeFalse();
    expect(
      sigueConLaPasswordQueLeDimos({
        passwordProvisionadaAt: true as unknown as string,
      }),
    ).toBeFalse();
  });
});
