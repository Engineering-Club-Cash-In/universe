import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("../../config/env", () => ({
  env: { CARTERA_API_URL: "https://cartera.test" },
}));

mock.module("./carteraAuth.service", () => ({
  ensureCarteraAuth: () => Promise.resolve("token-de-servicio"),
}));

// El módulo se carga después de registrar los mocks, dentro de `beforeAll`
// para no usar un `await` de nivel superior (el tsconfig de la app no lo
// admite y `bun run build` lo marcaría).
type Servicio = typeof import("./investor.service");

let AmbiguousInvestorEmailError: Servicio["AmbiguousInvestorEmailError"];
let CarteraInvestorError: Servicio["CarteraInvestorError"];
let createInvestor: Servicio["createInvestor"];
let findInvestorByEmail: Servicio["findInvestorByEmail"];

beforeAll(async () => {
  const servicio = await import("./investor.service");

  AmbiguousInvestorEmailError = servicio.AmbiguousInvestorEmailError;
  CarteraInvestorError = servicio.CarteraInvestorError;
  createInvestor = servicio.createInvestor;
  findInvestorByEmail = servicio.findInvestorByEmail;
});

type Respuesta = { status: number; body: unknown };

let respuesta: Respuesta = { status: 200, body: {} };
let ultimaUrl = "";

const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  ultimaUrl = "";
  globalThis.fetch = ((entrada: string | URL | Request) => {
    ultimaUrl = String(entrada);
    // Un string se manda tal cual (un 502 de un proxy no es JSON); cualquier
    // otra cosa va serializada como la respuesta real de cartera.
    const cuerpo =
      typeof respuesta.body === "string"
        ? respuesta.body
        : JSON.stringify(respuesta.body);

    return Promise.resolve(
      new Response(cuerpo, {
        status: respuesta.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
});

const restaurarFetch = () => {
  globalThis.fetch = fetchOriginal;
};

describe("findInvestorByEmail", () => {
  it("devuelve el inversionista cuando el correo identifica a uno solo", async () => {
    respuesta = {
      status: 200,
      body: { inversionista_id: 89, nombre: "Autocash", coincidencias_email: 1 },
    };

    const investor = await findInvestorByEmail("richardkachler@sepresta.com");

    expect(investor?.inversionista_id).toBe(89);
    expect(ultimaUrl).toContain("email=richardkachler%40sepresta.com");
    restaurarFetch();
  });

  it("falla ruidosamente si el correo resuelve a más de un inversionista", async () => {
    // Caso real de producción: 89 (Autocash) y 97 (Blokfund) comparten correo.
    // Cuál de los dos devuelve cartera depende del plan de ejecución, así que
    // aquí no se elige ninguno.
    respuesta = {
      status: 200,
      body: { inversionista_id: 89, nombre: "Autocash", coincidencias_email: 2 },
    };

    await expect(
      findInvestorByEmail("richardkachler@sepresta.com"),
    ).rejects.toBeInstanceOf(AmbiguousInvestorEmailError);
    restaurarFetch();
  });

  it("devuelve null cuando no hay inversionista con ese correo", async () => {
    respuesta = { status: 404, body: { message: "no encontrado" } };

    expect(await findInvestorByEmail("nadie@example.com")).toBeNull();
    restaurarFetch();
  });

  it("trata como único un cartera que todavía no informa coincidencias", async () => {
    // Compatibilidad durante el despliegue: si cartera aún no manda el conteo,
    // se comporta como antes en vez de bloquear a todo el mundo.
    respuesta = { status: 200, body: { inversionista_id: 89 } };

    const investor = await findInvestorByEmail("uno@example.com");

    expect(investor?.inversionista_id).toBe(89);
    restaurarFetch();
  });
});

describe("createInvestor", () => {
  it("propaga el motivo con el que cartera rechazó la escritura", async () => {
    respuesta = {
      status: 400,
      body: {
        message: "Errores de validación",
        errores: ["Inversionista #1: banco con ID 999 no existe"],
      },
    };

    try {
      await createInvestor({ inversionista_id: 89, banco_id: 999 });
      throw new Error("debió lanzar");
    } catch (error) {
      expect(error).toBeInstanceOf(CarteraInvestorError);
      expect((error as InstanceType<typeof CarteraInvestorError>).status).toBe(
        400,
      );
      expect((error as Error).message).toBe(
        "Errores de validación: Inversionista #1: banco con ID 999 no existe",
      );
    }
    restaurarFetch();
  });

  it("cae a un motivo genérico si la respuesta no es JSON aprovechable", async () => {
    respuesta = { status: 500, body: "<html>502 Bad Gateway</html>" };

    try {
      await createInvestor({ inversionista_id: 89, numero_cuenta: "123456" });
      throw new Error("debió lanzar");
    } catch (error) {
      expect(error).toBeInstanceOf(CarteraInvestorError);
      expect((error as Error).message).toBe("Cartera rechazó la operación");
    }
    restaurarFetch();
  });

  it("devuelve el cuerpo de cartera cuando la escritura sale bien", async () => {
    respuesta = {
      status: 201,
      body: { message: "Procesados exitosamente 1 inversionista(s)", data: [] },
    };

    const result = await createInvestor({
      inversionista_id: 89,
      numero_cuenta: "5520029868",
    });

    expect(result.message).toContain("Procesados exitosamente");
    restaurarFetch();
  });
});
