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

  // ── El correo de una persona tiene que quedar EXACTAMENTE como antes del PR.
  // Solo 11 de 193 inversionistas tienen representante legal: si el encabezado,
  // el preview o el asunto cambian sin condición, cambian para los otros 182.
  it("a una persona no le duplica el nombre bajo el encabezado", async () => {
    const html = await renderar();

    // Una sola vez: en el saludo. La línea de entidad bajo el encabezado existe
    // para que el representante sepa de qué sociedad es el correo; a quien se
    // saluda por su propio nombre le sobra.
    const veces = html.split("CUBE, S.A.").length - 1;
    expect(veces).toBe(1);
  });

  it("a una persona le conserva el preview de siempre", async () => {
    const html = await renderar();

    expect(html).toContain("Confirmación de Liquidación - CashIn");
    expect(html).not.toContain("Confirmación de Liquidación CUBE, S.A.");
  });

  it("al representante sí le pone la entidad bajo el encabezado", async () => {
    const html = await renderar({ representativeName: "Richard Kachler" });

    // Tres veces: el preview de la bandeja, la línea de entidad bajo el
    // encabezado y el cuerpo. El saludo lleva el nombre de él, no el de la
    // sociedad.
    const veces = html.split("CUBE, S.A.").length - 1;
    expect(veces).toBe(3);
  });
});
