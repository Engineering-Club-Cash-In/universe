import { describe, expect, it } from "bun:test";
import { asuntoCompraCarteraAceptada } from "./asuntoCompraCartera";

describe("asuntoCompraCarteraAceptada", () => {
  it("lleva el inversionista, el monto y la fecha y hora de Guatemala", () => {
    expect(
      asuntoCompraCarteraAceptada({
        etiqueta: "Boca-Terra Group, Sociedad Anónima",
        monto: "15000.00",
        // 18:15 UTC = 12:15 en Guatemala (UTC-6).
        aceptadaEn: new Date("2026-10-14T18:15:28Z"),
      }),
    ).toBe(
      "Compra de Cartera aceptada - Boca-Terra Group, Sociedad Anónima - Q15,000.00 - 14/10/2026 12:15",
    );
  });

  it("dos compras del mismo inversionista el mismo día no comparten asunto", () => {
    // Boca-Terra, 14-oct-2026: las dos caían en la misma conversación de Gmail.
    const etiqueta = "Boca-Terra Group, Sociedad Anónima";
    const primera = asuntoCompraCarteraAceptada({
      etiqueta,
      monto: "130000.00",
      aceptadaEn: new Date("2026-10-14T16:02:00Z"),
    });
    const segunda = asuntoCompraCarteraAceptada({
      etiqueta,
      monto: "15000.00",
      aceptadaEn: new Date("2026-10-14T18:15:28Z"),
    });
    expect(primera).not.toBe(segunda);
  });

  it("sin monto queda la fecha y hora, que sigue distinguiendo la compra", () => {
    expect(
      asuntoCompraCarteraAceptada({
        etiqueta: "3 créditos",
        aceptadaEn: new Date("2026-10-15T00:26:34Z"),
      }),
    ).toBe("Compra de Cartera aceptada - 3 créditos - 14/10/2026 18:26");
  });

  it("un monto que no es número no se imprime", () => {
    expect(
      asuntoCompraCarteraAceptada({
        etiqueta: "Ana Pérez",
        monto: "",
        aceptadaEn: new Date("2026-10-14T18:15:00Z"),
      }),
    ).toBe("Compra de Cartera aceptada - Ana Pérez - 14/10/2026 12:15");
  });
});
