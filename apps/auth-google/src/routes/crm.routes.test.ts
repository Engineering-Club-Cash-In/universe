/**
 * Las rutas del CRM exponen la ficha completa de un cliente, sus documentos
 * escaneados y sus créditos. Antes elegían a QUIÉN devolver esos datos con el
 * `email`/`dpi` del query string y con el `email` del cuerpo, así que cualquier
 * cuenta del portal —el registro es abierto— podía pedir los de otra persona.
 *
 * Estas pruebas fijan la única garantía que importa: el destinatario sale de la
 * SESIÓN. Lo que manda el navegador se ignora.
 */

import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

// Sesión que devuelve el mock de Better Auth. `null` = petición sin sesión.
let sessionActual: { user: { id: string; email?: string; dpi?: string } } | null =
  null;

mock.module("../lib/auth", () => ({
  auth: {
    api: {
      getSession: () => Promise.resolve(sessionActual),
    },
  },
}));

/** Argumentos con los que la ruta llamó a cada servicio del CRM. */
let llamadas: { fn: string; args: unknown[] }[] = [];

const espia =
  (fn: string, devuelve: (args: unknown[]) => unknown) =>
  (...args: unknown[]) => {
    llamadas.push({ fn, args });
    return Promise.resolve(devuelve(args));
  };

// Números SIFCO que el CRM reconoce como del lead de la sesión.
let sifcoDelLead: string[] = [];

// OJO: `mock.module` es global y sobrevive a este archivo. Correr este archivo
// solo (`bun test src/routes/crm.routes.test.ts`), no la suite entera.
mock.module("../services/crm", () => ({
  getProfile: espia("getProfile", () => ({ email: "quien-sea" })),
  updateLead: espia("updateLead", () => ({ data: { id: "lead-1" } })),
  getNumbersSifco: espia("getNumbersSifco", () =>
    sifcoDelLead.map((numeroSifco) => ({ numeroSifco })),
  ),
  getPersonalDocuments: espia("getPersonalDocuments", () => []),
  getContracts: espia("getContracts", () => []),
  getCredits: espia("getCredits", () => []),
  getCreditByNumeroSifco: espia("getCreditByNumeroSifco", () => ({
    credito: { numero_credito_sifco: "propio" },
  })),
}));

let app: Hono;

beforeAll(async () => {
  const { default: crmRoutes } = await import("./crm.routes");

  app = new Hono();
  app.route("/api/crm", crmRoutes);
});

const pedir = (path: string, init?: RequestInit) =>
  app.request(`http://localhost/api/crm${path}`, init);

const postJson = (path: string, body: unknown) =>
  pedir(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** Devuelve los argumentos de la única llamada que hizo la ruta. */
const argsDe = (fn: string) => llamadas.find((l) => l.fn === fn)?.args;

// La cuenta del atacante y la víctima a la que apunta con los parámetros.
const ATACANTE = "atacante@example.com";
const VICTIMA = "victima@example.com";
const DPI_VICTIMA = "1234567890123";
const DPI_ATACANTE = "9876543210987";

describe("rutas del CRM: el destinatario sale de la sesión", () => {
  beforeEach(() => {
    llamadas = [];
    sifcoDelLead = [];
    sessionActual = {
      user: { id: "user-atacante", email: ATACANTE, dpi: DPI_ATACANTE },
    };
  });

  it("rechaza sin sesión", async () => {
    sessionActual = null;

    const res = await pedir(
      `/profile?email=${VICTIMA}&dpi=${DPI_VICTIMA}`,
    );

    expect(res.status).toBe(401);
    expect(llamadas).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // LECTURA
  // ------------------------------------------------------------------

  const rutasDeLectura = [
    { path: "/profile", servicio: "getProfile" },
    { path: "/sifco", servicio: "getNumbersSifco" },
    { path: "/documents", servicio: "getPersonalDocuments" },
    { path: "/contracts", servicio: "getContracts" },
  ];

  for (const { path, servicio } of rutasDeLectura) {
    it(`${path} ignora el email y el dpi del query y usa el correo de la sesión`, async () => {
      const res = await pedir(`${path}?email=${VICTIMA}&dpi=${DPI_VICTIMA}`);

      expect(res.status).toBe(200);
      expect(argsDe(servicio)?.[0]).toBe(ATACANTE);
    });

    it(`${path} responde igual sin email ni dpi en el query`, async () => {
      // El front puede dejar de mandarlos sin que la ruta se caiga: ya no son
      // parte de la decisión.
      const res = await pedir(path);

      expect(res.status).toBe(200);
      expect(argsDe(servicio)?.[0]).toBe(ATACANTE);
    });

    // El DPI de la sesión lo autodeclara el usuario (POST /api/profile/me/dpi)
    // y el CRM busca el lead con OR(email, dpi). Reenviarlo dejaría que quien
    // reclame el DPI de otro —basta que esa persona no tenga cuenta— caiga en
    // el lead ajeno por la rama del DPI. Por eso NO viaja como llave.
    it(`${path} no manda el DPI de la sesión como llave de búsqueda`, async () => {
      sessionActual = {
        user: { id: "user-atacante", email: ATACANTE, dpi: DPI_VICTIMA },
      };

      await pedir(path);

      expect(argsDe(servicio)?.[1]).toBe("");
    });
  }

  // ------------------------------------------------------------------
  // ESCRITURA
  // ------------------------------------------------------------------

  it("/profile/update escribe sobre el lead de la sesión, no sobre el del cuerpo", async () => {
    const res = await postJson("/profile/update", {
      email: VICTIMA,
      phone: "55555555",
      address: "una dirección",
    });

    expect(res.status).toBe(200);
    expect(argsDe("updateLead")?.[0]).toMatchObject({
      email: ATACANTE,
      phone: "55555555",
      address: "una dirección",
    });
  });

  it("/profile/update nunca reenvía el DPI del cuerpo", async () => {
    await postJson("/profile/update", { email: VICTIMA, dpi: DPI_VICTIMA });

    expect(argsDe("updateLead")?.[0]).toMatchObject({
      email: ATACANTE,
      dpi: DPI_ATACANTE,
    });
  });

  it("/profile/update no inventa campos que el cuerpo no trajo", async () => {
    await postJson("/profile/update", { phone: "55555555" });

    const payload = argsDe("updateLead")?.[0] as Record<string, unknown>;
    expect(payload).toEqual({ email: ATACANTE, phone: "55555555" });
  });

  // ------------------------------------------------------------------
  // CRÉDITOS
  // ------------------------------------------------------------------

  it("/credits solo pide los créditos del lead de la sesión", async () => {
    sifcoDelLead = ["propio-1", "propio-2"];

    const res = await pedir("/credits?numerosSifco=ajeno-1,ajeno-2");

    expect(res.status).toBe(200);
    expect(argsDe("getCredits")?.[0]).toEqual(["propio-1", "propio-2"]);
  });

  it("/credit rechaza un número SIFCO que no es del lead de la sesión", async () => {
    sifcoDelLead = ["propio-1"];

    const res = await pedir("/credit?numeroSifco=ajeno-1");

    expect(res.status).toBe(403);
    expect(argsDe("getCreditByNumeroSifco")).toBeUndefined();
  });

  it("/credit devuelve el crédito cuando el número sí es del lead de la sesión", async () => {
    sifcoDelLead = ["propio-1"];

    const res = await pedir("/credit?numeroSifco=propio-1");

    expect(res.status).toBe(200);
    expect(argsDe("getCreditByNumeroSifco")?.[0]).toBe("propio-1");
  });
});
