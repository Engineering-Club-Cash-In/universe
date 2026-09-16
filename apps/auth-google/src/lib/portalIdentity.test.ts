import { describe, expect, it } from "bun:test";

import {
  isPortalUserType,
  normalizeDpi,
  resolveRoleAfterRegistration,
} from "./portalIdentity";

describe("isPortalUserType", () => {
  it("acepta los dos tipos que el portal puede auto-asignar", () => {
    expect(isPortalUserType("CLIENT")).toBe(true);
    expect(isPortalUserType("INVESTOR")).toBe(true);
  });

  it("rechaza ADMIN y cualquier otro rol privilegiado", () => {
    expect(isPortalUserType("ADMIN")).toBe(false);
    expect(isPortalUserType("SELLER")).toBe(false);
    expect(isPortalUserType("DEBTOR")).toBe(false);
  });

  it("rechaza basura y variantes de mayúsculas", () => {
    expect(isPortalUserType("admin")).toBe(false);
    expect(isPortalUserType("client")).toBe(false);
    expect(isPortalUserType("")).toBe(false);
    expect(isPortalUserType(undefined)).toBe(false);
    expect(isPortalUserType(null)).toBe(false);
    expect(isPortalUserType(123)).toBe(false);
    expect(isPortalUserType({ toString: () => "ADMIN" })).toBe(false);
  });
});

describe("resolveRoleAfterRegistration", () => {
  it("asciende a INVESTOR una cuenta que estaba en el rol por defecto", () => {
    expect(resolveRoleAfterRegistration("CLIENT", "INVESTOR")).toBe("INVESTOR");
  });

  it("no cambia nada si ya tiene el rol solicitado", () => {
    expect(resolveRoleAfterRegistration("INVESTOR", "INVESTOR")).toBeNull();
    expect(resolveRoleAfterRegistration("CLIENT", "CLIENT")).toBeNull();
  });

  it("nunca degrada un INVESTOR a CLIENT", () => {
    expect(resolveRoleAfterRegistration("INVESTOR", "CLIENT")).toBeNull();
  });

  // Lo importante: un registro del portal no puede tocar un rol administrativo,
  // ni para subirlo ni para bajarlo.
  it("no toca roles que no son del portal", () => {
    expect(resolveRoleAfterRegistration("ADMIN", "INVESTOR")).toBeNull();
    expect(resolveRoleAfterRegistration("ADMIN", "CLIENT")).toBeNull();
    expect(resolveRoleAfterRegistration("SELLER", "INVESTOR")).toBeNull();
    expect(resolveRoleAfterRegistration("DEBTOR", "INVESTOR")).toBeNull();
  });

  it("nunca devuelve un rol fuera de los del portal", () => {
    // El tipo pedido no es del portal: no hay ascenso posible.
    expect(resolveRoleAfterRegistration("CLIENT", "ADMIN" as never)).toBeNull();
  });
});

describe("normalizeDpi", () => {
  it("quita espacios y guiones", () => {
    expect(normalizeDpi(" 1234 56789 0123 ")).toBe("1234567890123");
    expect(normalizeDpi("1234-56789-0123")).toBe("1234567890123");
  });

  it("devuelve null si no quedan exactamente 13 dígitos", () => {
    expect(normalizeDpi("123")).toBeNull();
    expect(normalizeDpi("12345678901234")).toBeNull();
    expect(normalizeDpi("")).toBeNull();
    expect(normalizeDpi(undefined)).toBeNull();
    expect(normalizeDpi("abcdefghijklm")).toBeNull();
    expect(normalizeDpi("123456789012a")).toBeNull();
  });
});
