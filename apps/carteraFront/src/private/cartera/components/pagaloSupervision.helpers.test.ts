import { describe, expect, it } from "bun:test";
import {
  alternarEstado,
  antiguedad,
  normalizarNombreCliente,
  siguienteOrden,
} from "./pagaloSupervision.helpers";

describe("siguienteOrden", () => {
  it("al cambiar de columna empieza en desc", () => {
    expect(siguienteOrden({ columna: "createdAt", direccion: "asc" }, "totalAmount")).toEqual({
      columna: "totalAmount",
      direccion: "desc",
    });
  });

  it("invierte desc -> asc en la misma columna", () => {
    expect(siguienteOrden({ columna: "totalAmount", direccion: "desc" }, "totalAmount")).toEqual({
      columna: "totalAmount",
      direccion: "asc",
    });
  });

  it("invierte asc -> desc en la misma columna", () => {
    expect(siguienteOrden({ columna: "createdAt", direccion: "asc" }, "createdAt")).toEqual({
      columna: "createdAt",
      direccion: "desc",
    });
  });
});

describe("alternarEstado", () => {
  it("agrega un estado que no estaba", () => {
    expect(alternarEstado(["COMPLETED"], "REVIEW_REQUIRED")).toEqual([
      "COMPLETED",
      "REVIEW_REQUIRED",
    ]);
  });

  it("quita un estado ya seleccionado", () => {
    expect(alternarEstado(["COMPLETED", "REVIEW_REQUIRED"], "COMPLETED")).toEqual([
      "REVIEW_REQUIRED",
    ]);
  });
});

describe("normalizarNombreCliente", () => {
  it("pasa a capitalizado un nombre todo en mayúsculas", () => {
    expect(normalizarNombreCliente("GERARDO FERMÍN LÓPEZ")).toBe("Gerardo Fermín López");
  });

  it("deja intacto un nombre que ya mezcla casos", () => {
    expect(normalizarNombreCliente("Ana de la Cruz")).toBe("Ana de la Cruz");
  });

  it("propaga null", () => {
    expect(normalizarNombreCliente(null)).toBeNull();
  });
});

describe("antiguedad", () => {
  it("marca alerta a partir de 7 días", () => {
    const hace8dias = new Date(Date.now() - 8 * 86_400_000).toISOString();
    expect(antiguedad(hace8dias).alerta).toBe(true);
  });

  it("no marca alerta para algo reciente", () => {
    const hace2dias = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const resultado = antiguedad(hace2dias);
    expect(resultado.alerta).toBe(false);
    expect(resultado.etiqueta).toBe("2 días");
  });

  it("usa singular para un día", () => {
    const ayer = new Date(Date.now() - 1.2 * 86_400_000).toISOString();
    expect(antiguedad(ayer).etiqueta).toBe("1 día");
  });
});
