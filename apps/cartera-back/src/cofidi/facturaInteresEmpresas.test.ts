import { describe, expect, it } from "bun:test";
import {
  interesEmpresaApagado,
  interruptorPrendido,
  NITS_INTERES_SIN_FACTURA,
} from "./facturaInteresEmpresas";
import { INVERSIONISTAS_FACTURADORES } from "../utils/functions/const";

describe("interesEmpresaApagado", () => {
  it("env {} → false para AMJK INVERSIONES", () => {
    expect(interesEmpresaApagado("AMJK INVERSIONES", {})).toBe(false);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"false"} → false para AMJK INVERSIONES', () => {
    expect(
      interesEmpresaApagado("AMJK INVERSIONES", {
        NO_FACTURAR_INTERES_EMPRESAS: "false",
      })
    ).toBe(false);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"TRUE"} → true para AMJK INVERSIONES, S.A. (no distingue mayúsculas)', () => {
    expect(
      interesEmpresaApagado("AMJK INVERSIONES, S.A.", {
        NO_FACTURAR_INTERES_EMPRESAS: "TRUE",
      })
    ).toBe(true);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"1"} → false para AMJK INVERSIONES', () => {
    expect(
      interesEmpresaApagado("AMJK INVERSIONES", {
        NO_FACTURAR_INTERES_EMPRESAS: "1",
      })
    ).toBe(false);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:" true "} → true para AMJK INVERSIONES, S.A. (ignora espacios)', () => {
    expect(
      interesEmpresaApagado("AMJK INVERSIONES, S.A.", {
        NO_FACTURAR_INTERES_EMPRESAS: " true ",
      })
    ).toBe(true);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"True"} → true para Autocash S.A.', () => {
    expect(
      interesEmpresaApagado("Autocash S.A.", {
        NO_FACTURAR_INTERES_EMPRESAS: "True",
      })
    ).toBe(true);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"yes"} → false para AMJK INVERSIONES, S.A.', () => {
    expect(
      interesEmpresaApagado("AMJK INVERSIONES, S.A.", {
        NO_FACTURAR_INTERES_EMPRESAS: "yes",
      })
    ).toBe(false);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:""} → false para AMJK INVERSIONES', () => {
    expect(
      interesEmpresaApagado("AMJK INVERSIONES", {
        NO_FACTURAR_INTERES_EMPRESAS: "",
      })
    ).toBe(false);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"true"} → true para AMJK INVERSIONES, S.A.', () => {
    expect(
      interesEmpresaApagado("AMJK INVERSIONES, S.A.", {
        NO_FACTURAR_INTERES_EMPRESAS: "true",
      })
    ).toBe(true);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"true"} → true para Autocash S.A.', () => {
    expect(
      interesEmpresaApagado("Autocash S.A.", {
        NO_FACTURAR_INTERES_EMPRESAS: "true",
      })
    ).toBe(true);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"true"} → true para "  autocash s.a.  " (espacios/minúsculas)', () => {
    expect(
      interesEmpresaApagado("  autocash s.a.  ", {
        NO_FACTURAR_INTERES_EMPRESAS: "true",
      })
    ).toBe(true);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"true"} → false para SE PRESTA S.A. (no está en NITS_INTERES_SIN_FACTURA)', () => {
    expect(
      interesEmpresaApagado("SE PRESTA S.A.", {
        NO_FACTURAR_INTERES_EMPRESAS: "true",
      })
    ).toBe(false);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"true"} → false para CREACION E IMAGEN S.A. (no está en NITS_INTERES_SIN_FACTURA)', () => {
    expect(
      interesEmpresaApagado("CREACION E IMAGEN S.A.", {
        NO_FACTURAR_INTERES_EMPRESAS: "true",
      })
    ).toBe(false);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"true"} → false para GRUPO BATRO S.A. (no está en NITS_INTERES_SIN_FACTURA)', () => {
    expect(
      interesEmpresaApagado("GRUPO BATRO S.A.", {
        NO_FACTURAR_INTERES_EMPRESAS: "true",
      })
    ).toBe(false);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"true"} → true para minúsculas/espacios: "  amjk inversiones "', () => {
    expect(
      interesEmpresaApagado("  amjk inversiones ", {
        NO_FACTURAR_INTERES_EMPRESAS: "true",
      })
    ).toBe(true);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"true"} → false para CUBE INVESTMENTS, S.A.', () => {
    expect(
      interesEmpresaApagado("CUBE INVESTMENTS, S.A.", {
        NO_FACTURAR_INTERES_EMPRESAS: "true",
      })
    ).toBe(false);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"true"} → false para BLOKFUND S.A.', () => {
    expect(
      interesEmpresaApagado("BLOKFUND S.A.", {
        NO_FACTURAR_INTERES_EMPRESAS: "true",
      })
    ).toBe(false);
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"true"} → false para Juan Pérez', () => {
    expect(
      interesEmpresaApagado("Juan Pérez", {
        NO_FACTURAR_INTERES_EMPRESAS: "true",
      })
    ).toBe(false);
  });

  it("INVERSIONISTAS_FACTURADORES: solo AMJK y Autocash devuelven true con env true", () => {
    const env = { NO_FACTURAR_INTERES_EMPRESAS: "true" };
    const nitsConTrue = new Set<string>();

    for (const inversionista of INVERSIONISTAS_FACTURADORES) {
      const nombrePrueba = inversionista.keywords[0];
      if (interesEmpresaApagado(nombrePrueba, env)) {
        nitsConTrue.add(inversionista.satConfig.nit);
      }
    }

    const nitsConTrueArray = Array.from(nitsConTrue).sort();
    const nitsExpectados = ["100691455", "96896035"];
    expect(nitsConTrueArray).toEqual(nitsExpectados);
  });
});

describe("interruptorPrendido", () => {
  it('env {NO_FACTURAR_INTERES_EMPRESAS:"true"} → true', () => {
    expect(interruptorPrendido({ NO_FACTURAR_INTERES_EMPRESAS: "true" })).toBe(
      true
    );
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:" TRUE "} → true (mayúsculas y espacios)', () => {
    expect(interruptorPrendido({ NO_FACTURAR_INTERES_EMPRESAS: " TRUE " })).toBe(
      true
    );
  });

  it('env {NO_FACTURAR_INTERES_EMPRESAS:"1"} → false', () => {
    expect(interruptorPrendido({ NO_FACTURAR_INTERES_EMPRESAS: "1" })).toBe(
      false
    );
  });

  it("env {} (undefined) → false", () => {
    expect(interruptorPrendido({})).toBe(false);
  });
});
