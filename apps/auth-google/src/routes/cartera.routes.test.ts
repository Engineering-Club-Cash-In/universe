/**
 * Un login del portal puede operar varias entidades: la propia y la de cada
 * sociedad que representa. Ese conjunto lo resuelve cartera por el correo de la
 * sesión y aquí se cachea un minuto, porque el CRM da de alta sociedades en
 * caliente.
 *
 * Estas pruebas fijan hasta dónde llega ese caché: sirve para LEER, pero la
 * pertenencia de una ESCRITURA se vuelve a resolver. Si no, quitarle a alguien
 * la representación legal no surte efecto hasta que venza el TTL, y en esa
 * ventana el ex-representante todavía puede cambiarle los datos bancarios a una
 * entidad que ya no es suya.
 */

import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

let sessionActual: { user: { id: string; email?: string } } | null = null;

mock.module("../lib/auth", () => ({
  auth: {
    api: {
      getSession: () => Promise.resolve(sessionActual),
    },
  },
}));

/** Entidades que cartera dice que el correo de la sesión puede operar. */
let entidadesEnCartera: {
  inversionista_id: number;
  nombre: string;
  es_ancla?: boolean;
}[] = [];

/** Cuántas veces se preguntó realmente a cartera. */
let llamadasAEntidades = 0;

/** Payloads con los que se llamó a `createInvestor`. */
let escrituras: unknown[] = [];

class CarteraInvestorErrorFake extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// OJO: `mock.module` es global y sobrevive a este archivo. Correr este archivo
// solo (`bun test src/routes/cartera.routes.test.ts`), no la suite entera.
mock.module("../services/cartera", () => ({
  CarteraInvestorError: CarteraInvestorErrorFake,
  getEntidades: () => {
    llamadasAEntidades += 1;
    return Promise.resolve(entidadesEnCartera);
  },
  createInvestor: (payload: unknown) => {
    escrituras.push(payload);
    return Promise.resolve({ ok: true });
  },
  getInvestorProfileById: (id: number) => Promise.resolve({ inversionista_id: id }),
  getInvestorDocumentsById: () => Promise.resolve([]),
  getBancos: () => Promise.resolve([]),
  getLiquidaciones: () => Promise.resolve({ data: [] }),
  getInvestmentsStats: () => Promise.resolve({}),
  getAsesorById: () => Promise.resolve({}),
}));

let app: Hono;

beforeAll(async () => {
  const { default: carteraRoutes } = await import("./cartera.routes");

  app = new Hono();
  app.route("/api/cartera", carteraRoutes);
});

const pedir = (path: string, init?: RequestInit) =>
  app.request(`http://localhost/api/cartera${path}`, init);

const escribirBanco = (inversionistaId: number) =>
  pedir("/investor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inversionista_id: inversionistaId,
      banco_id: 1,
      tipo_cuenta: "MONETARIA",
      numero_cuenta: "123456",
    }),
  });

const SOCIEDAD = 77;
const PROPIA = 42;

describe("cartera: el caché de entidades no autoriza escrituras", () => {
  beforeEach(() => {
    llamadasAEntidades = 0;
    escrituras = [];
    // Correo distinto en cada test: el caché es de módulo y sobrevive entre
    // pruebas, así que compartir correo las acoplaría.
    sessionActual = {
      user: { id: "u", email: `${crypto.randomUUID()}@example.com` },
    };
    entidadesEnCartera = [
      { inversionista_id: PROPIA, nombre: "Persona" },
      { inversionista_id: SOCIEDAD, nombre: "Sociedad" },
    ];
  });

  // El portal anterior al selector no manda `inversionista_id`, y ese camino
  // tiene que seguir resolviendo lo de siempre: la fila cuyo correo es el de la
  // sesión. La lista viene con la persona primero, así que tomar la primera le
  // aplicaba a la fila PERSONAL una edición pensada para la sociedad.
  it("sin id, atiende la entidad que cuelga del correo de la sesión", async () => {
    entidadesEnCartera = [
      { inversionista_id: PROPIA, nombre: "Persona", es_ancla: false },
      { inversionista_id: SOCIEDAD, nombre: "Sociedad", es_ancla: true },
    ];

    await pedir("/investor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero_cuenta: "123" }),
    });

    expect(escrituras[0]).toMatchObject({ inversionista_id: SOCIEDAD });
  });

  it("sin ancla y sin id, cae a la primera de la lista", async () => {
    entidadesEnCartera = [
      { inversionista_id: PROPIA, nombre: "Persona" },
      { inversionista_id: SOCIEDAD, nombre: "Sociedad" },
    ];

    await pedir("/investor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero_cuenta: "123" }),
    });

    expect(escrituras[0]).toMatchObject({ inversionista_id: PROPIA });
  });

  it("las lecturas sí aprovechan el caché", async () => {
    await pedir("/entidades");
    await pedir(`/investor?inversionista_id=${SOCIEDAD}`);

    expect(llamadasAEntidades).toBe(1);
  });

  it("una escritura vuelve a preguntarle a cartera de quién es la entidad", async () => {
    // La sesión ya pobló el caché mirando su portal.
    await pedir("/entidades");
    expect(llamadasAEntidades).toBe(1);

    // El staff le quita la representación legal de la sociedad. Dentro del TTL.
    entidadesEnCartera = [{ inversionista_id: PROPIA, nombre: "Persona" }];

    const res = await escribirBanco(SOCIEDAD);

    expect(llamadasAEntidades).toBe(2);
    expect(res.status).toBe(403);
    expect(escrituras).toHaveLength(0);
  });

  it("la escritura sobre una entidad que sigue siendo suya pasa", async () => {
    await pedir("/entidades");

    const res = await escribirBanco(PROPIA);

    expect(res.status).toBe(200);
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0]).toMatchObject({ inversionista_id: PROPIA });
  });

  it("una entidad recién dada de alta se puede escribir sin esperar al TTL", async () => {
    await pedir("/entidades");

    entidadesEnCartera = [
      ...entidadesEnCartera,
      { inversionista_id: 99, nombre: "Sociedad nueva" },
    ];

    const res = await escribirBanco(99);

    expect(res.status).toBe(200);
    expect(escrituras).toHaveLength(1);
  });
});
