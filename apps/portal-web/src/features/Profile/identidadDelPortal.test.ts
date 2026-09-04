import { describe, expect, it } from "bun:test";

import {
  rolFueEstablecido,
  tipoInicialDelFormulario,
} from "./identidadDelPortal";

describe("rolFueEstablecido", () => {
  it("no da por establecido un CLIENT sin DPI: es el rol por defecto", () => {
    // Este es el estado en el que queda una cuenta cuyo registro externo falló:
    // Better Auth la creó con el rol por defecto y nadie llegó a escribir nada.
    // Darlo por bueno esconde el selector de tipo y reinscribe como cliente a
    // quien pidió ser inversionista, sin forma de corregirlo desde la UI.
    expect(rolFueEstablecido({ role: "CLIENT" })).toBeFalse();
    expect(rolFueEstablecido({ role: "CLIENT", dpi: "" })).toBeFalse();
    expect(rolFueEstablecido({ role: "CLIENT", dpi: "   " })).toBeFalse();
  });

  it("da por establecido un CLIENT que sí completó su registro", () => {
    expect(
      rolFueEstablecido({ role: "CLIENT", dpi: "1234567890123" }),
    ).toBeTrue();
  });

  it("da por establecido INVESTOR: no es un rol que se asigne solo", () => {
    expect(rolFueEstablecido({ role: "INVESTOR" })).toBeTrue();
    expect(
      rolFueEstablecido({ role: "INVESTOR", dpi: "1234567890123" }),
    ).toBeTrue();
  });

  it("sin usuario no hay nada establecido", () => {
    expect(rolFueEstablecido(null)).toBeFalse();
    expect(rolFueEstablecido(undefined)).toBeFalse();
  });

  it("un rol ajeno al autoservicio se trata como antes", () => {
    expect(rolFueEstablecido({ role: "ADMIN" })).toBeFalse();
  });
});

describe("tipoInicialDelFormulario", () => {
  // El registro por Google lleva el tipo elegido en la URL del callback. Si el
  // registro externo muere con un 409 de DPI, la persona cae en el formulario
  // de recuperación: descartar ahí su elección la reinscribe como cliente
  // aunque hubiera pedido invertir.
  it("respeta el tipo pedido cuando el rol es solo el CLIENT por defecto", () => {
    expect(
      tipoInicialDelFormulario({
        tipoSolicitado: "INVESTOR",
        user: { role: "CLIENT" },
      }),
    ).toBe("INVESTOR");
  });

  it("un rol ya establecido manda sobre el tipo pedido", () => {
    expect(
      tipoInicialDelFormulario({
        tipoSolicitado: "CLIENT",
        user: { role: "INVESTOR" },
      }),
    ).toBe("INVESTOR");
  });

  it("sin tipo pedido se comporta como antes", () => {
    expect(
      tipoInicialDelFormulario({ tipoSolicitado: null, user: { role: "CLIENT" } }),
    ).toBe("CLIENT");
    expect(tipoInicialDelFormulario({ user: null })).toBe("CLIENT");
  });
});
