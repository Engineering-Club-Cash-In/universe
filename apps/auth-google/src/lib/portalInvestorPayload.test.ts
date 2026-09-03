import { describe, expect, it } from "bun:test";

import {
  PortalInvestorPayloadError,
  buildPortalInvestorUpdate,
} from "./portalInvestorPayload";

describe("buildPortalInvestorUpdate", () => {
  it("dirige la escritura por inversionista_id y no por lo que mande el cliente", () => {
    const payload = buildPortalInvestorUpdate(86, {
      inversionista_id: 76,
      dpi: 1573661970101,
      email: "otra@example.com",
      nombre: "Otro Inversionista",
      numero_cuenta: "1234567890",
    });

    expect(payload.inversionista_id).toBe(86);
    expect(payload).toEqual({
      inversionista_id: 86,
      numero_cuenta: "1234567890",
    });
  });

  it("descarta los campos que el titular no edita desde el portal", () => {
    const payload = buildPortalInvestorUpdate(12, {
      tipo_cuenta: "AHORRO",
      descuenta_impuestos: true,
      emite_factura: true,
      tipo_reinversion: "reinversion_capital",
      monto_reinversion: 999999,
      moneda: "dolares",
      operation: "CREATE",
      mode: "create",
    });

    expect(payload).toEqual({ inversionista_id: 12, tipo_cuenta: "AHORRO" });
  });

  it("acepta banco_id numérico o en string y lo normaliza a número", () => {
    expect(buildPortalInvestorUpdate(12, { banco_id: 7 }).banco_id).toBe(7);
    expect(buildPortalInvestorUpdate(12, { banco_id: "7" }).banco_id).toBe(7);
  });

  it("rechaza un banco_id que no es un entero positivo", () => {
    for (const banco_id of [0, -3, 1.5, "abc", "", null, true]) {
      expect(() => buildPortalInvestorUpdate(12, { banco_id })).toThrow(
        PortalInvestorPayloadError,
      );
    }
  });

  it("acota tipo_cuenta al catálogo y lo normaliza a mayúsculas", () => {
    expect(buildPortalInvestorUpdate(12, { tipo_cuenta: "monetaria" }).tipo_cuenta).toBe(
      "MONETARIA",
    );
    expect(() =>
      buildPortalInvestorUpdate(12, { tipo_cuenta: "PLAZO_FIJO" }),
    ).toThrow(PortalInvestorPayloadError);
  });

  it("limpia y valida el número de cuenta", () => {
    expect(
      buildPortalInvestorUpdate(12, { numero_cuenta: "  0012-345678  " })
        .numero_cuenta,
    ).toBe("0012-345678");

    for (const numero_cuenta of ["", "12", "12345678901234567890123456789012345", "12 34", 123]) {
      expect(() =>
        buildPortalInvestorUpdate(12, { numero_cuenta }),
      ).toThrow(PortalInvestorPayloadError);
    }
  });

  it("rechaza una petición sin ningún campo editable", () => {
    expect(() => buildPortalInvestorUpdate(12, {})).toThrow(
      PortalInvestorPayloadError,
    );
    expect(() => buildPortalInvestorUpdate(12, { dpi: 1234567890101 })).toThrow(
      PortalInvestorPayloadError,
    );
    expect(() => buildPortalInvestorUpdate(12, null)).toThrow(
      PortalInvestorPayloadError,
    );
  });

  it("exige un inversionista_id válido como destino", () => {
    expect(() =>
      buildPortalInvestorUpdate(0, { numero_cuenta: "1234567890" }),
    ).toThrow(PortalInvestorPayloadError);
  });
});
