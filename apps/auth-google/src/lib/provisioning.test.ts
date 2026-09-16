import { describe, expect, it } from "bun:test";
import {
  generarPasswordPortal,
  normalizarDpiPortal,
  resolveRoleAfterRegistration,
} from "./provisioning";

describe("normalizarDpiPortal (UNA sola forma: lo que se busca es lo que se guarda)", () => {
  it("limpia la basura de captura que ya existe en producción", () => {
    expect(normalizarDpiPortal("1852752810101.")).toBe("1852752810101");
    expect(normalizarDpiPortal("1573 66197 01")).toBe("15736619701");
    expect(normalizarDpiPortal("2603 899 5101")).toBe("26038995101");
  });

  it("quita los ceros a la izquierda, como el bigint de cartera", () => {
    expect(normalizarDpiPortal("04036613")).toBe("4036613");
    expect(normalizarDpiPortal("0185275281010")).toBe("185275281010");
  });

  it("acepta las cédulas cortas: son personas reales, no basura", () => {
    // El inversionista 187 tiene dpi=4036613. Exigirle 13 dígitos lo dejaba sin
    // identidad, y sin identidad la corrida siguiente le crea otra cuenta.
    expect(normalizarDpiPortal("4036613")).toBe("4036613");
    expect(normalizarDpiPortal("15736619701")).toBe("15736619701");
  });

  it("lo que no son dígitos es null, y NUNCA cadena vacía", () => {
    // El slot del '' en users.dpi (UNIQUE) ya está ocupado en producción.
    expect(normalizarDpiPortal("")).toBeNull();
    expect(normalizarDpiPortal("   ")).toBeNull();
    expect(normalizarDpiPortal("no-aplica")).toBeNull();
    expect(normalizarDpiPortal(null)).toBeNull();
    expect(normalizarDpiPortal(undefined)).toBeNull();
    expect(normalizarDpiPortal("000")).toBeNull();
  });

  it("es idempotente: normalizar lo ya normalizado no lo cambia", () => {
    // Es la propiedad que hace que guardar y volver a buscar se encuentren.
    for (const crudo of ["04036613", "1852752810101.", "1573 66197 01", "4036613"]) {
      const unaVez = normalizarDpiPortal(crudo);
      expect(normalizarDpiPortal(unaVez)).toBe(unaVez);
    }
  });
});


describe("resolveRoleAfterRegistration", () => {
  it("asciende CLIENT a INVESTOR: el rol por defecto es el único que sube", () => {
    expect(resolveRoleAfterRegistration("CLIENT", "INVESTOR")).toBe("INVESTOR");
  });

  it("no toca un rol administrativo: provisionar no puede degradar a nadie", () => {
    expect(resolveRoleAfterRegistration("ADMIN", "INVESTOR")).toBeNull();
    expect(resolveRoleAfterRegistration("SELLER", "INVESTOR")).toBeNull();
    expect(resolveRoleAfterRegistration("DEBTOR", "INVESTOR")).toBeNull();
  });

  it("no reescribe a quien ya es INVESTOR", () => {
    expect(resolveRoleAfterRegistration("INVESTOR", "INVESTOR")).toBeNull();
  });

  it("un rol desconocido o ausente se respeta tal cual", () => {
    expect(resolveRoleAfterRegistration(null, "INVESTOR")).toBeNull();
    expect(resolveRoleAfterRegistration(undefined, "INVESTOR")).toBeNull();
    expect(resolveRoleAfterRegistration("LO_QUE_SEA", "INVESTOR")).toBeNull();
  });

  it("un requestedType que no es del portal no escribe nada", () => {
    // El tipo lo impide, pero el valor llega de un JSON por la red.
    expect(resolveRoleAfterRegistration("CLIENT", "ADMIN" as any)).toBeNull();
    expect(resolveRoleAfterRegistration("CLIENT", "" as any)).toBeNull();
    expect(resolveRoleAfterRegistration("CLIENT", undefined as any)).toBeNull();
  });

  // La función tiene DOS guardas que se cubren la una a la otra: el
  // `!isPortalUserType(currentRole)` y el `currentRole === "CLIENT"`. Quitar
  // cualquiera de las dos por separado deja el comportamiento intacto, así que
  // ningún caso suelto las prueba individualmente. Es redundancia DELIBERADA
  // —esta función decide roles a partir de datos de la red— y no se debe
  // "simplificar" quitando una.
  //
  // Lo que sí se puede sellar es la propiedad completa: de todo el espacio de
  // entradas, el ÚNICO par que escribe algo es (CLIENT, INVESTOR). Cualquier
  // reescritura que se salte una de las dos guardas y cambie el resultado tiene
  // que fallar aquí.
  it("de todo el espacio de entradas, solo (CLIENT, INVESTOR) escribe", () => {
    const rolesActuales = [
      "CLIENT", "INVESTOR", "ADMIN", "SELLER", "DEBTOR", "client", "Investor",
      "LO_QUE_SEA", "", " CLIENT", "CLIENT ", null, undefined,
    ];
    const pedidos = ["CLIENT", "INVESTOR", "ADMIN", "SELLER", "", null, undefined];

    const escriben: string[] = [];
    for (const actual of rolesActuales) {
      for (const pedido of pedidos) {
        if (resolveRoleAfterRegistration(actual as any, pedido as any) !== null) {
          escriben.push(`${String(actual)}->${String(pedido)}`);
        }
      }
    }

    expect(escriben).toEqual(["CLIENT->INVESTOR"]);
  });
});

describe("generarPasswordPortal", () => {
  it("cumple el mínimo de Better Auth (8) con margen", () => {
    expect(generarPasswordPortal().length).toBeGreaterThanOrEqual(8);
  });

  it("es URL-safe: viaja en un correo y se copia y pega a mano", () => {
    expect(generarPasswordPortal()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("no se repite entre altas", () => {
    const muestras = new Set(Array.from({ length: 50 }, () => generarPasswordPortal()));
    expect(muestras.size).toBe(50);
  });
});
