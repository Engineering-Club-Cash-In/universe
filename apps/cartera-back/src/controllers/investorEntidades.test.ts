import { beforeEach, describe, expect, it, mock } from "bun:test";

// Cada llamada a db.select()...where() consume la siguiente respuesta de la
// cola: la primera es el ancla (match por correo) y la segunda la expansión.
let selectResponses: unknown[][] = [];
const wheres: unknown[] = [];

mock.module("../database/index", () => ({
  client: {},
  lockPool: {},
  db: {
    select: () => ({
      from: () => ({
        where: (condicion: unknown) => {
          wheres.push(condicion);
          return Promise.resolve(selectResponses.shift() ?? []);
        },
      }),
    }),
  },
}));

const { getEntidadesPorCorreo } = await import("./investor");

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

const persona = fila({
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
const autocash = fila({
  inversionista_id: 89,
  nombre: "Autocash S.A.",
  dpi_rep_legal: "1573661970101",
  email: "richardkachler@sepresta.com",
});

describe("getEntidadesPorCorreo", () => {
  beforeEach(() => {
    selectResponses = [];
    wheres.length = 0;
  });

  it("devuelve vacío cuando el correo no corresponde a ningún inversionista", async () => {
    selectResponses = [[]];

    const entidades = await getEntidadesPorCorreo("nadie@example.com");

    expect(entidades).toEqual([]);
    // Sin ancla no tiene sentido expandir: una sola consulta.
    expect(wheres.length).toBe(1);
  });

  it("no consulta nada si el correo viene vacío", async () => {
    const entidades = await getEntidadesPorCorreo("   ");

    expect(entidades).toEqual([]);
    expect(wheres.length).toBe(0);
  });

  it("expande desde la persona a las sociedades que representa", async () => {
    selectResponses = [[persona], [persona, cube, autocash]];

    const entidades = await getEntidadesPorCorreo("richardkachler93@gmail.com");

    expect(entidades.map((e) => e.inversionista_id)).toEqual([76, 89, 86]);
    // La persona primero, las sociedades después ordenadas por nombre.
    expect(entidades[0].tipo).toBe("persona");
    expect(entidades[1].nombre).toBe("Autocash S.A.");
  });

  it("entra por el correo de una sociedad y alcanza al resto del grupo", async () => {
    // Se Presta comparte correo con Blokfund; Blokfund solo se sostiene por ahí.
    const sePresta = fila({
      inversionista_id: 99,
      nombre: "Se Presta S.A.",
      dpi_rep_legal: "1573661970101",
      email: "richard9310@icloud.com",
    });
    const blokfund = fila({
      inversionista_id: 97,
      nombre: "Blokfund S.A.",
      email: "richard9310@icloud.com",
    });
    selectResponses = [
      [blokfund, sePresta],
      [persona, cube, autocash, sePresta],
    ];

    const entidades = await getEntidadesPorCorreo("richard9310@icloud.com");

    expect(entidades.map((e) => e.inversionista_id).sort()).toEqual([
      76, 86, 89, 97, 99,
    ]);
    // Las que matchearon por correo quedan marcadas como puerta de entrada.
    const porId = new Map(entidades.map((e) => [e.inversionista_id, e]));
    expect(porId.get(97)!.es_ancla).toBe(true);
    expect(porId.get(86)!.es_ancla).toBe(false);
  });

  it("normaliza el DPI del representante con cero a la izquierda", async () => {
    // dpi_rep_legal es varchar y guarda "04036613"; el dpi de la fila personal
    // es el bigint 4036613. Sin normalizar, no casarían.
    const conCeroAdelante = fila({
      inversionista_id: 187,
      nombre: "Javier Camilo Kafie Guardado",
      dpi: 4036613,
      dpi_rep_legal: "04036613",
      email: "jckafie@gmail.com",
    });
    selectResponses = [[conCeroAdelante], [conCeroAdelante]];

    const entidades = await getEntidadesPorCorreo("jckafie@gmail.com");

    expect(entidades).toHaveLength(1);
    expect(entidades[0].dpi).toBe("4036613");
    expect(entidades[0].tipo).toBe("persona");
  });

  it("no duplica una fila que aparece en el ancla y en la expansión", async () => {
    selectResponses = [[persona], [persona]];

    const entidades = await getEntidadesPorCorreo("richardkachler93@gmail.com");

    expect(entidades).toHaveLength(1);
    expect(entidades[0].es_ancla).toBe(true);
  });

  it("ignora mayúsculas y espacios del correo", async () => {
    selectResponses = [[persona], [persona]];

    const entidades = await getEntidadesPorCorreo("  Richardkachler93@GMAIL.com ");

    expect(entidades).toHaveLength(1);
  });
});
