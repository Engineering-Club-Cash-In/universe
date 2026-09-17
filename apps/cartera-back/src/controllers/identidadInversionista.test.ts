import { beforeEach, describe, expect, it, mock } from "bun:test";

// Cada consulta consume la siguiente respuesta de la cola. Las dos cadenas que
// usa el controlador terminan en `.limit()`.
let selectResponses: unknown[][] = [];

mock.module("../database/index", () => {
  const cadena: any = {
    where: () => cadena,
    orderBy: () => cadena,
    limit: () => Promise.resolve(selectResponses.shift() ?? []),
  };
  return {
    client: {},
    lockPool: {},
    db: { select: () => ({ from: () => cadena }) },
  };
});

const { buscarIdentidad } = await import("./identidadInversionista");
const { correoCompartidoConSuGrupo } = await import("./investor");

const fila = (over: Record<string, unknown>) => ({
  inversionista_id: 0,
  nombre: "",
  dpi: null,
  email: null,
  dpi_rep_legal: null,
  moneda: "quetzales",
  status: "activo",
  ...over,
});

const richard = fila({
  inversionista_id: 76,
  nombre: "Richard Kachler",
  dpi: 1573661970101,
  email: "richardkachler93@gmail.com",
});
const cube = fila({
  inversionista_id: 86,
  nombre: "Cube Investments S.A.",
  dpi_rep_legal: "1573661970101",
  email: "richard9310@hotmail.com",
});

describe("buscarIdentidad", () => {
  beforeEach(() => {
    selectResponses = [];
  });

  it("devuelve null cuando el dato no es de nadie: es un alta corriente", async () => {
    selectResponses = [[]];

    expect(await buscarIdentidad("3010824990101", null)).toBeNull();
  });

  it("no consulta nada sin dpi ni correo", async () => {
    expect(await buscarIdentidad(null, null)).toBeNull();
  });

  it("identifica a la persona por su DPI", async () => {
    selectResponses = [[richard]];

    const identidad = await buscarIdentidad("1573661970101", null);

    expect(identidad).toMatchObject({
      inversionista_id: 76,
      nombre: "Richard Kachler",
      email: "richardkachler93@gmail.com",
      dpi: "1573661970101",
      via: "directo",
    });
  });

  it("identifica a la persona por su correo", async () => {
    selectResponses = [[richard]];

    const identidad = await buscarIdentidad(null, "  RichardKachler93@Gmail.com ");

    expect(identidad?.inversionista_id).toBe(76);
  });

  it("desde el correo de una sociedad salta a su representante", async () => {
    // Quien puede representar a otra empresa es el humano, no la sociedad.
    selectResponses = [[cube], [richard]];

    const identidad = await buscarIdentidad(null, "richard9310@hotmail.com");

    expect(identidad).toMatchObject({
      inversionista_id: 76,
      nombre: "Richard Kachler",
      via: "representante_de_la_sociedad",
      sociedad: "Cube Investments S.A.",
    });
  });

  it("no inventa identidad si la sociedad apunta a un representante inexistente", async () => {
    selectResponses = [[cube], []];

    expect(await buscarIdentidad(null, "richard9310@hotmail.com")).toBeNull();
  });

  it("normaliza el cero a la izquierda del representante", async () => {
    // El 187 se representa a sí mismo: dpi 4036613, dpi_rep_legal '04036613'.
    const kafie = fila({
      inversionista_id: 187,
      nombre: "Javier Camilo Kafie Guardado",
      dpi: 4036613,
      dpi_rep_legal: "04036613",
      email: "jckafie@gmail.com",
    });
    selectResponses = [[kafie]];

    const identidad = await buscarIdentidad("04036613", null);

    // No es una sociedad: es una persona con un DPI que empieza en cero.
    expect(identidad?.via).toBe("directo");
    expect(identidad?.dpi).toBe("4036613");
  });

  it("una fila sin DPI propio ni representante no identifica a nadie", async () => {
    selectResponses = [[fila({ inversionista_id: 97, nombre: "Blokfund S.A.", email: "x@y.com" })]];

    expect(await buscarIdentidad(null, "x@y.com")).toBeNull();
  });
});

describe("correoCompartidoConSuGrupo", () => {
  it("permite que la empresa reuse el correo de su representante", () => {
    const nueva = { dpi: null, dpi_rep_legal: "1573661970101" };

    expect(correoCompartidoConSuGrupo(nueva, richard as any)).toBe(true);
  });

  it("permite compartirlo con otra sociedad del mismo representante", () => {
    const nueva = { dpi: null, dpi_rep_legal: "1573661970101" };

    expect(correoCompartidoConSuGrupo(nueva, cube as any)).toBe(true);
  });

  it("tolera el cero a la izquierda al comparar", () => {
    // El representante se escribió con cero adelante; sigue siendo el mismo.
    const nueva = { dpi: null, dpi_rep_legal: "01573661970101" };

    expect(correoCompartidoConSuGrupo(nueva, richard as any)).toBe(true);
  });

  it("NO deja quedarse con el correo de un tercero", () => {
    // El representante declarado no es el dueño del correo que choca.
    const nueva = { dpi: null, dpi_rep_legal: "3942922510101" };

    expect(correoCompartidoConSuGrupo(nueva, richard as any)).toBe(false);
  });

  it("NO aplica a una persona: dos personas no comparten correo", () => {
    const nueva = { dpi: 3010824990101, dpi_rep_legal: "1573661970101" };

    expect(correoCompartidoConSuGrupo(nueva, richard as any)).toBe(false);
  });

  it("NO aplica sin representante declarado", () => {
    expect(correoCompartidoConSuGrupo({ dpi: null }, richard as any)).toBe(false);
  });
});
