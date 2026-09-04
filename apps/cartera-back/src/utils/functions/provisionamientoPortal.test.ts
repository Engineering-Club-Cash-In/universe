import { describe, expect, it } from "bun:test";
import {
  decidirProvisionamiento,
  normalizarDpiParaComparar,
  pareceSociedad,
} from "./provisionamientoPortal";

const fila = (over: Partial<Parameters<typeof decidirProvisionamiento>[0]> = {}) => ({
  inversionista_id: 1,
  nombre: "Ana Pérez",
  email: "ana@example.com",
  dpi: 1234567890101 as number | string | null,
  dpi_rep_legal: null as string | null,
  ...over,
});

describe("normalizarDpiParaComparar", () => {
  it("quita ceros a la izquierda para poder comparar bigint contra varchar", () => {
    expect(normalizarDpiParaComparar("04036613")).toBe("4036613");
    expect(normalizarDpiParaComparar(4036613)).toBe("4036613");
  });

  it("descarta lo que no sea dígitos, en vez de convertir a número", () => {
    // dpi_rep_legal admite 20 dígitos y un bigint topa en 19: un BigInt()
    // podría desbordar con un valor mal capturado. Comparar texto no revienta.
    expect(normalizarDpiParaComparar("no-es-un-dpi")).toBeNull();
    expect(normalizarDpiParaComparar("")).toBeNull();
    expect(normalizarDpiParaComparar("   ")).toBeNull();
    expect(normalizarDpiParaComparar("0000")).toBeNull();
    expect(normalizarDpiParaComparar(null)).toBeNull();
    expect(normalizarDpiParaComparar("12345678901234567890")).toBe("12345678901234567890");
  });
});

describe("decidirProvisionamiento", () => {
  it("una persona con correo se provisiona", () => {
    expect(decidirProvisionamiento(fila())).toEqual({
      accion: "provisionar",
      inversionistaId: 1,
      inversionistaNombre: "Ana Pérez",
      nombre: "Ana Pérez",
      email: "ana@example.com",
      dpi: "1234567890101",
    });
  });

  it("normaliza el correo: el login del portal es case-insensitive", () => {
    const d = decidirProvisionamiento(fila({ email: "  Ana@Example.COM " }));
    expect(d).toMatchObject({ accion: "provisionar", email: "ana@example.com" });
  });

  it("una empresa NO recibe cuenta propia: avisa a su representante", () => {
    // Cube Investments S.A. (86): representada por Richard, que entra con su
    // propio correo y la ve en su lista. Él es quien recibe el aviso de
    // "ahora también representas a...", que es la regla 1 del pedido: si la
    // persona YA tiene usuario, se le asocia el inversionista nuevo y se le
    // manda ese correo en vez del de bienvenida.
    expect(
      decidirProvisionamiento(
        fila({
          inversionista_id: 86,
          nombre: "Cube Investments S.A.",
          dpi: null,
          dpi_rep_legal: "1573661970101",
        }),
      ),
    ).toEqual({
      accion: "notificar_representante",
      inversionistaId: 86,
      inversionistaNombre: "Cube Investments S.A.",
      dpiRepresentante: "1573661970101",
    });
  });

  it("la empresa avisa al representante aunque ELLA no tenga correo", () => {
    // MENFER (66) no tiene correo propio, pero su representante (Juan Carlos
    // Mendez, 50) sí: el aviso tiene a dónde llegar.
    expect(
      decidirProvisionamiento(
        fila({
          inversionista_id: 66,
          nombre: "MENFER",
          email: "",
          dpi: null,
          dpi_rep_legal: "1578569841301",
        }),
      ),
    ).toMatchObject({ accion: "notificar_representante", dpiRepresentante: "1578569841301" });
  });

  it("quien se representa a sí mismo SÍ recibe cuenta, aunque tenga rep legal", () => {
    // Javier Kafie (187) es el caso real: dpi=4036613, dpi_rep_legal='04036613'.
    // La comparación textual cruda lo dejaba fuera por el cero a la izquierda.
    expect(
      decidirProvisionamiento(
        fila({
          inversionista_id: 187,
          nombre: "Javier Camilo Kafie Guardado",
          email: "jckafie@gmail.com",
          dpi: 4036613,
          dpi_rep_legal: "04036613",
        }),
      ),
    ).toMatchObject({ accion: "provisionar", inversionistaId: 187 });
  });

  it("sin correo no se puede: sin correo no hay identidad en Better Auth", () => {
    expect(decidirProvisionamiento(fila({ email: null }))).toEqual({
      accion: "omitir",
      motivo: "sin_correo",
    });
    expect(decidirProvisionamiento(fila({ email: "   " }))).toEqual({
      accion: "omitir",
      motivo: "sin_correo",
    });
  });

  it("un rep legal vacío o basura deja a la fila como persona", () => {
    expect(decidirProvisionamiento(fila({ dpi_rep_legal: "" }))).toMatchObject({
      accion: "provisionar",
    });
    expect(decidirProvisionamiento(fila({ dpi_rep_legal: "   " }))).toMatchObject({
      accion: "provisionar",
    });
  });

  it("sin nombre no se provisiona: Better Auth exige un nombre", () => {
    expect(decidirProvisionamiento(fila({ nombre: "  " }))).toEqual({
      accion: "omitir",
      motivo: "sin_nombre",
    });
  });

  it("un dpi que no normaliza viaja como null, nunca como cadena vacía", () => {
    // users.dpi es UNIQUE y la cadena vacía YA ocupa el slot en producción.
    expect(decidirProvisionamiento(fila({ dpi: "" }))).toMatchObject({ dpi: null });
    expect(decidirProvisionamiento(fila({ dpi: null }))).toMatchObject({ dpi: null });
  });
});

describe("pareceSociedad", () => {
  it("marca las sociedades por nombre SOLO para reportarlas", () => {
    // Estas cuatro son sociedades por el nombre pero NO tienen dpi_rep_legal,
    // así que la regla las trata como persona. No se corrige por heurística:
    // es dato faltante, y adivinar sobre identidad es peor que reportarlo.
    expect(pareceSociedad("PLT LOPEZ SANCHEZ S.A.")).toBe(true);
    expect(pareceSociedad("INVERSIONES FIS, SOCIEDAD ANONIMA")).toBe(true);
    expect(pareceSociedad("Central de Carga S.A.")).toBe(true);
    expect(pareceSociedad("Ana Pérez")).toBe(false);
    expect(pareceSociedad(null)).toBe(false);
  });
});
