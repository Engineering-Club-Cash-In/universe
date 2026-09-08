import { describe, expect, it } from "bun:test";
import { render } from "@react-email/components";
import * as React from "react";
import { LiquidationEmail } from "./LiquidationTemplate";

const renderar = (props: Partial<React.ComponentProps<typeof LiquidationEmail>> = {}) =>
  render(
    React.createElement(LiquidationEmail, {
      investorName: "CUBE, S.A.",
      amount: "1000.00",
      creditNumber: "Múltiples",
      date: "agosto 2026",
      ...props,
    }),
  );

describe("LiquidationEmail", () => {
  it("nombra la entidad aunque salude al representante", async () => {
    // Richard Kachler representa 4 sociedades: los 4 correos caen en su buzón
    // el mismo día. Si el cuerpo solo dice su nombre, no puede distinguirlos.
    const html = await renderar({ representativeName: "Richard Kachler" });

    expect(html).toContain("CUBE, S.A.");
    expect(html).toContain("Richard Kachler");
    expect(html).toContain("entidad que usted representa");
  });

  it("una persona sigue viendo el correo de siempre, en primera persona", async () => {
    const html = await renderar();

    expect(html).toContain("CUBE, S.A.");
    expect(html).toContain("liquidación de sus rendimientos");
    expect(html).not.toContain("entidad que usted representa");
  });

  it("el preview de la bandeja lleva la entidad y el período", async () => {
    const html = await renderar({ representativeName: "Richard Kachler" });

    expect(html).toContain("Confirmación de Liquidación CUBE, S.A. - agosto 2026");
  });
});
