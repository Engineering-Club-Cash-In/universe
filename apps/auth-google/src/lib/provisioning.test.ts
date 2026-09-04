import { describe, expect, it } from "bun:test";
import {
  generarPasswordPortal,
  normalizarDpiParaBuscar,
  normalizarDpiParaGuardar,
  resolveRoleAfterRegistration,
} from "./provisioning";

describe("normalizarDpiParaBuscar (lectura: permisivo a propósito)", () => {
  it("encuentra los DPI sucios que YA están en producción", () => {
    // Las cuatro filas sucias reales de "auth-google".users. El normalizador de
    // lectura tiene que ser MÁS permisivo que el de escritura: si no encuentra
    // al usuario que ya existe, el alta intenta crearlo de nuevo y revienta
    // contra users_dpi_key en vez de reconocer que ya tenía cuenta.
    expect(normalizarDpiParaBuscar("1852752810101.")).toBe("1852752810101");
    expect(normalizarDpiParaBuscar("1573 66197 01")).toBe("15736619701");
    expect(normalizarDpiParaBuscar("2603 899 5101")).toBe("26038995101");
    expect(normalizarDpiParaBuscar("")).toBeNull();
  });

  it("compara sin ceros a la izquierda, como el lado de cartera", () => {
    expect(normalizarDpiParaBuscar("04036613")).toBe("4036613");
    expect(normalizarDpiParaBuscar("1234-5678-90101")).toBe("123456789 0101".replace(" ", ""));
  });

  it("no inventa: lo que no son dígitos es null", () => {
    expect(normalizarDpiParaBuscar("no-aplica")).toBeNull();
    expect(normalizarDpiParaBuscar(null)).toBeNull();
    expect(normalizarDpiParaBuscar("   ")).toBeNull();
    expect(normalizarDpiParaBuscar("000")).toBeNull();
  });
});

describe("normalizarDpiParaGuardar (escritura: estricto)", () => {
  it("solo acepta 13 dígitos exactos", () => {
    expect(normalizarDpiParaGuardar("1852752810101")).toBe("1852752810101");
    expect(normalizarDpiParaGuardar("1852 7528 10101")).toBe("1852752810101");
  });

  it("devuelve null antes que escribir basura en una columna UNIQUE", () => {
    // users.dpi es UNIQUE y la cadena vacía YA ocupa el slot
    // (direccion@grupowad.com): un segundo '' revienta con 23505.
    expect(normalizarDpiParaGuardar("")).toBeNull();
    expect(normalizarDpiParaGuardar("   ")).toBeNull();
    expect(normalizarDpiParaGuardar("15736619701")).toBeNull(); // 11 dígitos
    expect(normalizarDpiParaGuardar("4036613")).toBeNull(); // el 187: no es un DPI
    expect(normalizarDpiParaGuardar(null)).toBeNull();
  });

  it("no guarda con ceros a la izquierda si eso lo deja en 13", () => {
    expect(normalizarDpiParaGuardar("0185275281010")).toBe("0185275281010");
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
