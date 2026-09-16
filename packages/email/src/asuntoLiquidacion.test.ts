import { describe, expect, it } from "bun:test";
import { asuntoDeLiquidacion } from "./asuntoLiquidacion";

describe("asuntoDeLiquidacion", () => {
  it("a una persona le llega el asunto de siempre, sin su nombre", () => {
    expect(asuntoDeLiquidacion("Ana Pérez", "agosto 2026")).toBe(
      "Liquidación Procesada - agosto 2026",
    );
  });

  it("al representante le nombra la entidad para poder distinguir los correos", () => {
    // Richard Kachler representa 4 sociedades: los 4 asuntos caen el mismo día
    // en el mismo buzón.
    expect(asuntoDeLiquidacion("CUBE, S.A.", "agosto 2026", "Richard Kachler")).toBe(
      "Liquidación Procesada - CUBE, S.A. - agosto 2026",
    );
  });

  it("el autorrepresentado no lleva nombre de entidad: no se le manda representante", () => {
    // El inversionista 187 recibe su liquidación en su propio buzón y sin
    // `representativeName`, así que cae en el asunto personal.
    expect(asuntoDeLiquidacion("Javier Camilo Kafie", "agosto 2026", undefined)).toBe(
      "Liquidación Procesada - agosto 2026",
    );
  });
});
