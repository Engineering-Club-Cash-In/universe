import { describe, expect, it } from "bun:test";
import {
  decidirProvisionamiento,
  esEmpresaRepresentada,
  type FilaInversionista,
  normalizarDpiParaComparar,
  pareceSociedad,
  solicitaProvisionamiento,
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

// `esEmpresaRepresentada` documenta la regla (incluida la excepción del
// autorrepresentado 187) y `decidirProvisionamiento` la aplica. Estaban
// escritas dos veces, y la copia documentada era justamente la que NO se
// ejecutaba. Ahora hay una sola; este test es el que se da cuenta si vuelven a
// separarse.
describe("la regla de empresa vive en un solo sitio", () => {
  const casos: FilaInversionista[] = [
    { inversionista_id: 1, nombre: "Ana", email: "a@b.com", dpi: 1234567890101, dpi_rep_legal: null },
    // El 187: se representa a sí mismo, con cero a la izquierda en rep_legal.
    { inversionista_id: 187, nombre: "Javier Kafie", email: "j@k.com", dpi: 4036613, dpi_rep_legal: "04036613" },
    { inversionista_id: 86, nombre: "Cube S.A.", email: "c@b.com", dpi: 999, dpi_rep_legal: "1573661970101" },
    { inversionista_id: 66, nombre: "Menfer", email: null, dpi: null, dpi_rep_legal: "1852752810101" },
    { inversionista_id: 5, nombre: "Sin nada", email: "s@b.com", dpi: null, dpi_rep_legal: null },
    { inversionista_id: 6, nombre: "Rep basura", email: "r@b.com", dpi: 7, dpi_rep_legal: "  " },
    { inversionista_id: 7, nombre: "Rep en cero", email: "r7@b.com", dpi: 7, dpi_rep_legal: "000" },
  ];

  it("decidirProvisionamiento notifica al representante EXACTAMENTE cuando la regla dice empresa", () => {
    for (const fila of casos) {
      const decision = decidirProvisionamiento(fila);
      expect({
        id: fila.inversionista_id,
        notifica: decision.accion === "notificar_representante",
      }).toEqual({
        id: fila.inversionista_id,
        notifica: esEmpresaRepresentada(fila),
      });
    }
  });
});

describe("solicitaProvisionamiento", () => {
  it("solo provisiona cuando el body lo PIDE explícitamente", () => {
    expect(solicitaProvisionamiento({ provisionar_portal: true })).toBe(true);
    // Los clientes que mandan formularios serializan el booleano como texto.
    expect(solicitaProvisionamiento({ provisionar_portal: "true" })).toBe(true);
  });

  it("un body que no trae la llave NO provisiona", () => {
    // Este es el guard: la ruta pública /api/unified/register-external arma un
    // objeto FIJO con {nombre, dpi, email} (registerExternal.service.ts:62-68).
    // Nadie de afuera puede colar la llave, así que un alta anónima no puede
    // fabricar una cuenta del portal ni mandarle la contraseña a su propio
    // correo.
    expect(solicitaProvisionamiento({ nombre: "Ana", dpi: 1, email: "a@b.com" })).toBe(false);
    expect(solicitaProvisionamiento({})).toBe(false);
    expect(solicitaProvisionamiento(null)).toBe(false);
    expect(solicitaProvisionamiento(undefined)).toBe(false);
  });

  it("mandarla en falso es decir que no, no un descuido", () => {
    expect(solicitaProvisionamiento({ provisionar_portal: false })).toBe(false);
    expect(solicitaProvisionamiento({ provisionar_portal: "false" })).toBe(false);
    expect(solicitaProvisionamiento({ provisionar_portal: 1 })).toBe(false);
  });
});
